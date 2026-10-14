import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../components/ui/Button'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import StarRating from '../components/StarRating'
import ReviewModal from '../components/ReviewModal'
import { beginBookingPayment } from '../lib/payments'
import './MyBookingsReviews.css'
import DistanceBadge from '../components/DistanceBadge'

const tabs = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
  { id: 'cancelled', label: 'Cancelled' },
]

function todayString() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function formatDate(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

function formatTime(value) {
  return value ? value.slice(0, 5) : 'Not set'
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })

// Distance columns were added by the optional Mapbox migration. Keep the
// booking itself renderable on deployments where that migration is pending,
// while still surfacing unrelated query errors.
function isMissingDistanceColumn(error) {
  return ['42703', 'PGRST204'].includes(error?.code)
    && /distance_km|drive_minutes/i.test(error?.message || '')
}

async function fetchRenterBookings(renterId) {
  const selectBookings = (includeDistance) => supabase
    .from('bookings')
    .select(`id, item_id, renter_id, start_date, end_date, total_price, status, pickup_time, return_time, meeting_spot, meeting_lat, meeting_lng, ${includeDistance ? 'distance_km, drive_minutes, ' : ''}created_at, items(title, image_url, location, price_per_day)`)
    .eq('renter_id', renterId)
    .order('created_at', { ascending: false })

  let result = await selectBookings(true)
  if (isMissingDistanceColumn(result.error)) result = await selectBookings(false)
  return result
}

function statusLabel(status) {
  return status.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function ItemPhoto({ item }) {
  if (item?.image_url) return <img className="my-booking-photo" src={item.image_url} alt={item.title || 'Booked item'} />
  return <div className="my-booking-photo-placeholder" aria-label="No item photo available"><span aria-hidden="true">r.</span></div>
}

function BookingSkeleton() {
  return <div className="my-bookings-skeleton-list" role="status" aria-label="Loading your bookings">{Array.from({ length: 3 }, (_, index) => <div className="my-booking-skeleton" key={index}><span /><div><i /><i /><i /></div></div>)}</div>
}

export default function MyBookingsPage() {
  const { user } = useAuth()
  const [bookings, setBookings] = useState([])
  const [activeTab, setActiveTab] = useState('upcoming')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryCount, setRetryCount] = useState(0)
  const [cancellingId, setCancellingId] = useState(null)
  const [transitioningId, setTransitioningId] = useState(null)
  const [cancelError, setCancelError] = useState('')
  const [reviewingBooking, setReviewingBooking] = useState(null)
  const [submittingReview, setSubmittingReview] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [payingId, setPayingId] = useState(null)
  const [paymentMessage, setPaymentMessage] = useState('')

  const loadBookings = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured. Check the project URL and public API key in your .env file.')
    const { error: expiryError } = await supabase.rpc('expire_pending_bookings')
    if (expiryError) throw expiryError
    const { data, error: queryError } = await fetchRenterBookings(user.id)
    if (queryError) throw queryError
    const bookingRows = data || []
    if (!bookingRows.length) return []
    const { data: reviews, error: reviewsError } = await supabase
      .from('reviews')
      .select('id, booking_id, rating, comment, created_at')
      .in('booking_id', bookingRows.map((booking) => booking.id))
    if (reviewsError) throw reviewsError
    const reviewsByBooking = Object.fromEntries((reviews || []).map((review) => [review.booking_id, review]))
    return bookingRows.map((booking) => ({ ...booking, review: reviewsByBooking[booking.id] || null }))
  }, [user?.id])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    loadBookings()
      .then((data) => { if (!cancelled) setBookings(data) })
      .catch((queryError) => { if (!cancelled) setError(queryError?.message || 'We could not load your bookings. Please try again.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [loadBookings, retryCount])

  const groups = useMemo(() => {
    const today = todayString()
    return {
      upcoming: bookings.filter((booking) => ['pending_payment', 'confirmed', 'picked_up', 'return_requested'].includes(booking.status) && booking.end_date >= today),
      past: bookings.filter((booking) => booking.status === 'returned' || (['confirmed', 'picked_up', 'return_requested'].includes(booking.status) && booking.end_date < today)),
      cancelled: bookings.filter((booking) => booking.status === 'cancelled'),
    }
  }, [bookings])
  const visibleBookings = groups[activeTab]

  async function cancelBooking(booking) {
    if (cancellingId || !user?.id) return
    const today = todayString()
    const pendingHold = booking.status === 'pending_payment'
    if (booking.renter_id !== user.id || (!pendingHold && (booking.status !== 'confirmed' || booking.start_date <= today))) {
      setCancelError('Only your pending payment or confirmed future bookings can be cancelled.')
      return
    }
    const title = booking.items?.title || 'this item'
    if (!window.confirm(`Cancel your ${pendingHold ? 'pending payment ' : ''}booking for ${title}? The dates will become available again.`)) return
    if (!supabase) {
      setCancelError('Bookings are temporarily unavailable. Please try again later.')
      return
    }
    setCancelError('')
    setCancellingId(booking.id)
    try {
      const { data, error: updateError } = await supabase
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', booking.id)
        .eq('renter_id', user.id)
        .eq('status', booking.status)
        .select('id')
        .maybeSingle()
      if (updateError) throw updateError
      if (!data) throw new Error('This booking could not be cancelled. It may have started or its status may have changed. Refresh and try again.')
      setBookings((current) => current.map((entry) => entry.id === booking.id ? { ...entry, status: 'cancelled' } : entry))
      setActiveTab('cancelled')
      try {
        const refreshedBookings = await loadBookings()
        setBookings(refreshedBookings)
      } catch {
        setCancelError('Your booking was cancelled, but we could not refresh the list. Refresh the page to see the latest bookings.')
      }
    } catch (updateError) {
      const code = updateError?.code
      const message = code === '42501'
        ? 'Your account does not have permission to cancel this booking. Please contact support.'
        : code === '23514' || code === '22023'
          ? 'This booking can no longer be cancelled because its dates or status changed.'
          : 'We could not cancel this booking right now. Please refresh and try again.'
      setCancelError(message)
    } finally {
      setCancellingId(null)
    }
  }

  async function payBooking(booking) {
    if (payingId || booking.renter_id !== user?.id || booking.status !== 'pending_payment') return
    setPayingId(booking.id)
    setPaymentMessage('')
    try {
      await beginBookingPayment({
        bookingId: booking.id,
        itemTitle: booking.items?.title || 'RentMate booking',
        user,
        onSuccess: (payment) => {
          setBookings((current) => current.map((entry) => entry.id === booking.id
            ? { ...entry, status: 'confirmed', payment_id: payment.payment_id, paid_at: payment.paid_at }
            : entry))
        },
        onDismiss: () => setPaymentMessage('Checkout was closed. This booking remains pending for up to 15 minutes. You can try Pay now again or cancel it.'),
        onError: (error) => setPaymentMessage(error?.message || 'Payment could not be verified. This booking remains pending payment.'),
      })
    } catch (error) {
      setPaymentMessage(error?.message || 'Checkout could not be opened. This booking remains pending payment.')
    } finally {
      setPayingId(null)
    }
  }

  async function requestReturn(booking) {
    if (transitioningId || booking.renter_id !== user?.id || booking.status !== 'picked_up') return
    const title = booking.items?.title || 'this item'
    if (!window.confirm(`Have you returned ${title} to its owner? This will ask them to confirm the return.`)) return
    if (!supabase) {
      setCancelError('Bookings are temporarily unavailable. Please try again later.')
      return
    }
    setCancelError('')
    setTransitioningId(booking.id)
    try {
      const { data, error: updateError } = await supabase.from('bookings')
        .update({ status: 'return_requested' })
        .eq('id', booking.id).eq('renter_id', user.id).eq('status', 'picked_up')
        .select('id').maybeSingle()
      if (updateError) throw updateError
      if (!data) throw new Error('This booking is no longer waiting for your return request. Refresh and try again.')
      setBookings((current) => current.map((entry) => entry.id === booking.id ? { ...entry, status: 'return_requested' } : entry))
    } catch (updateError) {
      setCancelError(updateError?.code === '42501'
        ? 'Only the renter can request a return confirmation.'
        : updateError?.message || 'We could not send the return request. Please try again.')
    } finally {
      setTransitioningId(null)
    }
  }

  async function submitReview({ rating, comment }) {
    if (!reviewingBooking || reviewingBooking.status !== 'returned' || reviewingBooking.renter_id !== user?.id || !supabase) {
      setReviewError('Only you can review your own returned booking.')
      return
    }
    setSubmittingReview(true)
    setReviewError('')
    try {
      const { data, error: insertError } = await supabase.from('reviews').insert({
        booking_id: reviewingBooking.id,
        item_id: reviewingBooking.item_id,
        reviewer_id: user.id,
        rating,
        comment: comment || null,
      }).select('id, booking_id, rating, comment, created_at').single()
      if (insertError) throw insertError
      setBookings((current) => current.map((booking) => booking.id === reviewingBooking.id ? { ...booking, review: data } : booking))
      setReviewingBooking(null)
    } catch (insertError) {
      setReviewError(insertError?.code === '23505'
        ? 'This booking already has a review. Refresh your bookings to see it.'
        : insertError?.code === '42501'
          ? 'Only the renter can review a returned booking.'
          : 'We could not submit your review. Please try again.')
    } finally {
      setSubmittingReview(false)
    }
  }

  return <main className="my-bookings-page">
    <div className="my-bookings-container">
      <header className="my-bookings-heading"><span className="details-section-kicker">YOUR RENTMATE JOURNEY</span><h1>My bookings<span>.</span></h1><p>Everything you’ve reserved, in one place.</p></header>
      <div className="my-bookings-tabs" role="tablist" aria-label="Filter bookings">
        {tabs.map((tab) => <button key={tab.id} type="button" role="tab" id={`booking-tab-${tab.id}`} aria-selected={activeTab === tab.id} aria-controls="booking-tab-panel" className={`my-bookings-tab${activeTab === tab.id ? ' is-active' : ''}`} onClick={() => { setActiveTab(tab.id); setCancelError('') }}>
          {tab.label}<span>{groups[tab.id].length}</span>
        </button>)}
      </div>
      {cancelError && <p className="my-bookings-error" role="alert">{cancelError}</p>}
      {paymentMessage && <p className="my-bookings-error" role="status">{paymentMessage}</p>}
      <section id="booking-tab-panel" role="tabpanel" aria-labelledby={`booking-tab-${activeTab}`} className="my-bookings-results" aria-live="polite">
        {error ? <div className="my-bookings-state my-bookings-error-state" role="alert"><span className="details-section-kicker">A LITTLE PAUSE</span><h2>We couldn’t load your bookings.</h2><p>{error}</p><Button type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again</Button></div>
          : loading ? <BookingSkeleton />
            : visibleBookings.length === 0 ? <div className="my-bookings-state"><span className="my-bookings-empty-mark" aria-hidden="true">r.</span><span className="details-section-kicker">NOTHING HERE JUST YET</span><h2>{activeTab === 'upcoming' ? 'Your next good find is waiting.' : activeTab === 'past' ? 'Your rental story starts here.' : 'No cancelled bookings.'}</h2><p>{activeTab === 'upcoming' ? 'When you book something useful, it will show up here.' : activeTab === 'past' ? 'Completed and returned rentals will appear here.' : 'Bookings you cancel will be kept here for reference.'}</p><Link to="/" className="details-primary-link">Browse items</Link></div>
              : <div className="my-bookings-list">{visibleBookings.map((booking) => {
                const canCancel = booking.renter_id === user?.id && (booking.status === 'pending_payment' || (booking.status === 'confirmed' && booking.start_date > todayString()))
                const canPay = booking.renter_id === user?.id && booking.status === 'pending_payment'
                const canRequestReturn = booking.renter_id === user?.id && booking.status === 'picked_up'
                const title = booking.items?.title || 'Item listing'
                return <article className="my-booking-card" key={booking.id}>
                  <Link to={`/items/${booking.item_id}`} className="my-booking-card-link" aria-label={`${title}, ${formatDate(booking.start_date)} to ${formatDate(booking.end_date)}`}>
                    <div className="my-booking-image"><ItemPhoto item={booking.items} /></div>
                    <div className="my-booking-content"><div className="my-booking-title-row"><div><span className="details-section-kicker">RENTAL</span><h2>{title}</h2></div><span className={`my-booking-status status-${booking.status}`}>{statusLabel(booking.status)}</span></div>
                      <p className="my-booking-location"><span aria-hidden="true">⌖</span>{booking.items?.location || 'Location not specified'}</p>
                      <DistanceBadge distanceKm={booking.distance_km} driveMinutes={booking.drive_minutes} />
                      <div className="my-booking-meta"><div><span className="details-section-kicker">DATES</span><p>{formatDate(booking.start_date)} <span aria-hidden="true">–</span> {formatDate(booking.end_date)}</p><p>{formatTime(booking.pickup_time)} pickup · {formatTime(booking.return_time)} return</p></div><div className="my-booking-total"><span className="details-section-kicker">TOTAL</span><p>{inr.format(Number(booking.total_price))}</p></div></div>
                    </div>
                  </Link>
                  <Link className="my-booking-detail-link" to={`/bookings/${booking.id}`}>Timing & meeting spot</Link>
                  {(canPay || canCancel || canRequestReturn) && <div className="my-booking-actions">
                    {canPay && <><p className="booking-payment-test-note">Test mode: no real money is charged.</p><button type="button" className="my-booking-return-request" onClick={() => payBooking(booking)} disabled={payingId !== null || cancellingId !== null || transitioningId !== null}>{payingId === booking.id ? 'Opening checkout…' : 'Pay now'}</button></>}
                    {canCancel && <button type="button" className="my-booking-cancel" onClick={() => cancelBooking(booking)} disabled={cancellingId !== null || transitioningId !== null || payingId !== null} aria-label={`Cancel booking for ${title}`}>
                      {cancellingId === booking.id ? <><span className="booking-spinner" aria-hidden="true" /> Cancelling...</> : 'Cancel booking'}
                    </button>}
                    {canRequestReturn && <button type="button" className="my-booking-return-request" onClick={() => requestReturn(booking)} disabled={transitioningId !== null || cancellingId !== null}>
                      {transitioningId === booking.id ? 'Sending...' : 'I returned it'}
                    </button>}
                  </div>}
                  {booking.status === 'returned' && <div className="booking-review-area">{booking.review
                    ? <div className="booking-review-saved"><StarRating rating={booking.review.rating} size="small" /><p>{booking.review.comment || 'Thanks for sharing your rating.'}</p><span className="details-section-kicker">YOUR REVIEW</span></div>
                    : <button type="button" className="booking-review-button" onClick={() => { setReviewingBooking(booking); setReviewError('') }}>Leave a review</button>}</div>}
                </article>
              })}</div>}
      </section>
    </div>
    {reviewingBooking && <ReviewModal itemTitle={reviewingBooking.items?.title || 'Your rental'} onClose={() => { if (!submittingReview) setReviewingBooking(null) }} onSubmit={submitReview} submitting={submittingReview} error={reviewError} />}
  </main>
}
