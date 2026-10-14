import { supabase } from './supabaseClient'

const razorpayKeyId = import.meta.env.VITE_RAZORPAY_KEY_ID
let checkoutScriptPromise

function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve()
  if (!checkoutScriptPromise) {
    checkoutScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://checkout.razorpay.com/v1/checkout.js'
      script.async = true
      script.onload = () => window.Razorpay ? resolve() : reject(new Error('Razorpay Checkout did not load.'))
      script.onerror = () => reject(new Error('Could not load Razorpay Checkout. Check your connection and try again.'))
      document.head.appendChild(script)
    }).catch((error) => {
      checkoutScriptPromise = null
      throw error
    })
  }
  return checkoutScriptPromise
}

export async function beginBookingPayment({ bookingId, itemTitle, user, onSuccess, onDismiss, onError }) {
  if (!supabase) throw new Error('Payments are unavailable because Supabase is not configured.')
  if (!razorpayKeyId) throw new Error('Add VITE_RAZORPAY_KEY_ID to your .env file to enable test payments.')
  const { error: expiryError } = await supabase.rpc('expire_pending_bookings')
  if (expiryError) throw new Error('We could not refresh the payment hold. Reload My Bookings and try again.')
  const { data: order, error: orderError } = await supabase.functions.invoke('razorpay-payments', {
    body: { action: 'create_order', booking_id: bookingId },
  })
  if (orderError) throw new Error(orderError.message || 'We could not prepare checkout. Your booking is still pending payment.')
  if (!order?.order_id || !order?.amount) throw new Error('Checkout could not be prepared. Your booking is still pending payment.')

  await loadRazorpayCheckout()
  let handled = false
  const checkout = new window.Razorpay({
    key: razorpayKeyId,
    order_id: order.order_id,
    amount: order.amount,
    currency: 'INR',
    name: 'RentMate',
    description: itemTitle,
    prefill: { name: user?.user_metadata?.full_name || '', email: user?.email || '' },
    notes: { booking_id: bookingId },
    theme: { color: '#174b3e' },
    handler: async (response) => {
      if (handled) return
      handled = true
      try {
        const { data, error } = await supabase.functions.invoke('razorpay-payments', {
          body: {
            action: 'verify_payment',
            booking_id: bookingId,
            order_id: response.razorpay_order_id,
            payment_id: response.razorpay_payment_id,
            signature: response.razorpay_signature,
          },
        })
        if (error) throw new Error(error.message || 'Payment verification failed. Your booking remains pending payment.')
        if (!data?.confirmed) throw new Error('Payment could not be verified. Your booking remains pending payment.')
        onSuccess(data)
      } catch (error) {
        onError(error)
      }
    },
    modal: { ondismiss: () => { if (!handled) onDismiss() } },
  })
  checkout.on('payment.failed', (response) => {
    if (handled) return
    handled = true
    onError(new Error(response?.error?.description || 'Payment was not completed. Your booking is still pending payment.'))
  })
  checkout.open()
}
