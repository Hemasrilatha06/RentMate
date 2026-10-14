import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return mismatch === 0
}

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const razorpayKeyId = Deno.env.get('RAZORPAY_KEY_ID')
  const razorpaySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
  if (!supabaseUrl || !anonKey || !serviceKey || !razorpayKeyId || !razorpaySecret) {
    return json({ error: 'Payment service is not configured.' }, 503)
  }

  const authorization = request.headers.get('Authorization')
  if (!authorization) return json({ error: 'Sign in to continue.' }, 401)
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return json({ error: 'Your session is invalid. Please sign in again.' }, 401)

  let payload: Record<string, string>
  try { payload = await request.json() } catch { return json({ error: 'Invalid request.' }, 400) }
  const bookingId = payload.booking_id
  if (!bookingId || !/^[0-9a-f-]{36}$/i.test(bookingId)) return json({ error: 'A valid booking ID is required.' }, 400)
  if (payload.action === 'create_order') {
    const { error: expiryError } = await userClient.rpc('expire_pending_bookings')
    if (expiryError) return json({ error: 'We could not refresh the payment hold. Please reload My Bookings and try again.' }, 503)
  }

  const { data: booking, error: bookingError } = await userClient.from('bookings')
    .select('id, renter_id, status, total_price, razorpay_order_id, items(title)')
    .eq('id', bookingId)
    .maybeSingle()
  if (bookingError || !booking || booking.renter_id !== authData.user.id) return json({ error: 'This booking is not available to your account.' }, 404)
  if (booking.status !== 'pending_payment') return json({ error: 'This booking is no longer awaiting payment.' }, 409)

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const expectedAmount = Math.round(Number(booking.total_price) * 100)
  if (!Number.isSafeInteger(expectedAmount) || expectedAmount <= 0) return json({ error: 'The booking amount is invalid.' }, 400)

  if (payload.action === 'create_order') {
    const receipt = booking.id.replaceAll('-', '')
    if (booking.razorpay_order_id) {
      const existingResponse = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(booking.razorpay_order_id)}`, {
        headers: { Authorization: `Basic ${btoa(`${razorpayKeyId}:${razorpaySecret}`)}` },
      })
      const existing = existingResponse.ok ? await existingResponse.json() : null
      if (existing?.receipt === receipt && existing?.amount === expectedAmount && existing?.currency === 'INR'
          && existing?.notes?.booking_id === booking.id && existing?.status !== 'paid') {
        return json({ order_id: existing.id, amount: existing.amount, currency: existing.currency })
      }
      return json({ error: 'This booking already has a payment order being processed. Refresh My Bookings and check its status.' }, 409)
    }
    const razorpayResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${razorpayKeyId}:${razorpaySecret}`)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: expectedAmount,
        currency: 'INR',
        receipt,
        notes: { booking_id: booking.id, renter_id: booking.renter_id },
      }),
    })
    const order = await razorpayResponse.json()
    if (!razorpayResponse.ok) return json({ error: 'Razorpay could not create checkout. Your booking is still pending payment.' }, 502)
    const { data: savedOrder, error: saveOrderError } = await admin.from('bookings')
      .update({ razorpay_order_id: order.id })
      .eq('id', booking.id).eq('status', 'pending_payment').is('razorpay_order_id', null)
      .select('razorpay_order_id').maybeSingle()
    if (saveOrderError) return json({ error: 'The order was created but could not be attached to this booking. Please contact support before retrying.' }, 502)
    if (savedOrder?.razorpay_order_id) return json({ order_id: savedOrder.razorpay_order_id, amount: order.amount, currency: order.currency })
    const { data: concurrentBooking } = await admin.from('bookings').select('razorpay_order_id').eq('id', booking.id).maybeSingle()
    if (concurrentBooking?.razorpay_order_id) {
      const winnerResponse = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(concurrentBooking.razorpay_order_id)}`, {
        headers: { Authorization: `Basic ${btoa(`${razorpayKeyId}:${razorpaySecret}`)}` },
      })
      if (winnerResponse.ok) {
        const winner = await winnerResponse.json()
        return json({ order_id: winner.id, amount: winner.amount, currency: winner.currency })
      }
    }
    return json({ error: 'We could not attach the payment order to this booking. Please try again.' }, 409)
  }

  if (payload.action !== 'verify_payment') return json({ error: 'Unsupported payment action.' }, 400)
  const { order_id: orderId, payment_id: paymentId, signature } = payload
  if (!orderId || !paymentId || !signature) return json({ error: 'Payment verification details are incomplete.' }, 400)
  const expectedSignature = await hmacHex(razorpaySecret, `${orderId}|${paymentId}`)
  if (!constantTimeEqual(expectedSignature, signature)) return json({ error: 'Razorpay payment signature is invalid.' }, 400)

  const credentials = `Basic ${btoa(`${razorpayKeyId}:${razorpaySecret}`)}`
  const [orderResponse, paymentResponse] = await Promise.all([
    fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`, { headers: { Authorization: credentials } }),
    fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: credentials } }),
  ])
  if (!orderResponse.ok || !paymentResponse.ok) return json({ error: 'Razorpay could not verify this payment yet. Your booking remains pending payment.' }, 502)
  const [order, payment] = await Promise.all([orderResponse.json(), paymentResponse.json()])
  let verifiedPayment = payment
  if (payment.status === 'authorized' && payment.order_id === orderId && payment.amount === expectedAmount && payment.currency === 'INR') {
    const captureResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/capture`, {
      method: 'POST',
      headers: { Authorization: credentials, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: expectedAmount, currency: 'INR' }),
    })
    if (!captureResponse.ok) return json({ error: 'Payment is authorized but could not be captured yet. Your booking remains pending payment.' }, 502)
    verifiedPayment = await captureResponse.json()
  }
  if (order.id !== orderId || order.receipt !== booking.id.replaceAll('-', '') || booking.razorpay_order_id !== orderId || order.amount !== expectedAmount || order.currency !== 'INR'
      || order.notes?.booking_id !== booking.id || verifiedPayment.order_id !== orderId || verifiedPayment.amount !== expectedAmount
      || verifiedPayment.currency !== 'INR' || verifiedPayment.status !== 'captured') {
    return json({ error: 'Payment details do not match this booking or are not captured yet.' }, 400)
  }

  const { data: finalized, error: finalizeError } = await admin.rpc('finalize_booking_payment', {
    p_booking_id: booking.id,
    p_order_id: orderId,
    p_payment_id: verifiedPayment.id,
  })
  if (finalizeError || !finalized) return json({ error: 'Payment was received but booking confirmation failed. Contact support with your payment ID.' }, 502)
  return json({ confirmed: true, payment_id: verifiedPayment.id, paid_at: new Date().toISOString() })
})
