import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ArrowRight } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import ItemReviews from '../components/ItemReviews'
import ItemPhoto from '../components/ItemPhoto'
import { beginBookingPayment } from '../lib/payments'
import AvailabilityCalendar from '../components/AvailabilityCalendar'
import MapView from '../components/MapView'
import AddressSearch from '../components/AddressSearch'
import { distanceBetweenCoordinates } from '../lib/location'

function formatDate(value) {
  if (!value) return 'Not specified'
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

function formatPrice(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value) || 0)
}

function formatBookingPrice(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value) || 0)
}

function localDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatBookingDate(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

function dateRangeOverlaps(start, end, ranges) {
  return ranges.some((range) => start <= range.end_date && end >= range.start_date)
}

const timeOptions = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`)

function bookingErrorMessage(error) {
  if (error?.code === '23P01') return 'Sorry, those dates were just booked by someone else. Please pick different dates.'
  if (error?.code === '42P01' || error?.code === '42883') return 'Bookings are not set up yet. Run bookings_setup.sql in your Supabase SQL Editor, then try again.'
  if (error?.code === '42703') return 'Pickup, return, and meeting details are not set up yet. Run location_timing_setup.sql in your Supabase SQL Editor, then try again.'
  if (error?.code === '42501') return 'Your account could not create this booking. Please check the booking access policies in Supabase.'
  if (error?.code === '22023') return error.message || 'Those booking details are no longer valid. Please check the dates and try again.'
  return error?.message ? `We could not create this booking: ${error.message}` : 'We could not create this booking. Please try again.'
}

function defaultLocationErrorMessage(error) {
  const message = error?.message || 'Please try again.'
  if (error?.code === 'PGRST202' || /schema cache/i.test(message)) {
    return 'Your default location could not be saved, so the booking was not submitted. Run supabase/fix_save_my_location.sql in the Supabase SQL Editor, then retry.'
  }
  return `Your default location could not be saved, so the booking was not submitted. ${message}`
}

export function BookingPanel({ item, renterLocation, setRenterLocation }) {
  const { user } = useAuth()
  const today = localDateString()
  const minDate = item.available_from > today ? item.available_from : today
  const availableWindow = minDate <= item.available_to
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [pickupTime, setPickupTime] = useState('10:00')
  const [returnTime, setReturnTime] = useState('18:00')
  const [meetingSpot, setMeetingSpot] = useState('')
  const [meetingLatitude, setMeetingLatitude] = useState(null)
  const [meetingLongitude, setMeetingLongitude] = useState(null)
  const { address: renterAddress, latitude: renterLatitude, longitude: renterLongitude } = renterLocation
  const [saveDefaultLocation, setSaveDefaultLocation] = useState(false)
  const [bookedRanges, setBookedRanges] = useState([])
  const [rangesLoading, setRangesLoading] = useState(true)
  const [rangesError, setRangesError] = useState('')
  const [selectionError, setSelectionError] = useState('')
  const [bookingError, setBookingError] = useState('')
  const [defaultLocationError, setDefaultLocationError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [success, setSuccess] = useState(null)
  const [pendingPayment, setPendingPayment] = useState(null)
  const [paymentMessage, setPaymentMessage] = useState('')
  const [paying, setPaying] = useState(false)

  useEffect(() => {
    let active = true
    if (!user?.id || !supabase) return () => { active = false }
    supabase.rpc('get_my_saved_location').then(({ data, error }) => {
      if (active && !error && data?.[0]) {
        setRenterLocation({ address: data[0].address || '', latitude: data[0].latitude ?? null, longitude: data[0].longitude ?? null })
      }
    }).catch(() => {})
    return () => { active = false }
  }, [user?.id, setRenterLocation])

  const refreshBookedRanges = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const { data, error } = await supabase.rpc('get_booked_ranges', { p_item_id: item.id })
    if (error) throw error
    setBookedRanges(data || [])
    setRangesError('')
    return data || []
  }, [item.id])

  useEffect(() => {
    let cancelled = false
    setRangesLoading(true)
    setRangesError('')
    const loadAvailability = async () => {
      if (!supabase) throw new Error('Supabase is not configured.')
      if (user?.id) {
        const { error } = await supabase.rpc('expire_pending_bookings')
        if (error) throw error
      }
      await refreshBookedRanges()
    }
    loadAvailability()
      .catch((error) => { if (!cancelled) setRangesError(error?.message || 'We could not check the booked dates.') })
      .finally(() => { if (!cancelled) setRangesLoading(false) })
    return () => { cancelled = true }
  }, [refreshBookedRanges, user?.id])

  async function payForBooking(booking) {
    if (paying || !booking) return
    setPaying(true)
    setPaymentMessage('')
    try {
      await beginBookingPayment({
        bookingId: booking.id,
        itemTitle: item.title,
        user,
        onSuccess: (payment) => setSuccess({ ...booking, paymentId: payment.payment_id }),
        onDismiss: () => setPaymentMessage('Checkout was closed. Your dates are held for up to 15 minutes. You can pay from My Bookings or cancel the hold.'),
        onError: (error) => setPaymentMessage(error?.message || 'Payment could not be verified. Your booking is still pending payment.'),
      })
    } catch (error) {
      setPaymentMessage(error?.message || 'Checkout could not be opened. Your booking is still pending payment.')
    } finally {
      setPaying(false)
    }
  }

  const days = startDate && endDate
    ? Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1
    : 0
  const total = days > 0 ? days * Number(item.price_per_day) : 0
  const sameDayTimeInvalid = Boolean(startDate && endDate && startDate === endDate && pickupTime && returnTime && returnTime <= pickupTime)

  function chooseStart(value) {
    setSelectionError('')
    setBookingError('')
    setDefaultLocationError('')
    if (value && (value < minDate || value > item.available_to || dateRangeOverlaps(value, value, bookedRanges))) {
      setSelectionError(dateRangeOverlaps(value, value, bookedRanges) ? 'That date is already booked. Choose another start date.' : 'Choose a date within the available window.')
      return
    }
    setStartDate(value)
    setEndDate('')
  }

  function chooseEnd(value) {
    setSelectionError('')
    setBookingError('')
    if (!value) {
      setEndDate('')
      return
    }
    if (!startDate) {
      setSelectionError('Choose a start date first.')
      return
    }
    if (value < startDate || value > item.available_to || value < minDate) {
      setSelectionError('Choose an end date on or after the start date and within the available window.')
      return
    }
    if (dateRangeOverlaps(startDate, value, bookedRanges)) {
      setSelectionError('That range includes dates already booked. Choose a different date range.')
      return
    }
    setEndDate(value)
  }

  async function submitBooking(event) {
    event.preventDefault()
    if (submittingRef.current) return
    setSelectionError('')
    setBookingError('')
    if (!startDate || !endDate || !pickupTime || !returnTime) {
      setSelectionError('Choose both dates and pickup and return times.')
      return
    }
    if (!renterAddress.trim() || renterLatitude == null || renterLongitude == null) {
      setSelectionError('Add your address or nearby landmark and set your location pin.')
      return
    }
    if (sameDayTimeInvalid) {
      setSelectionError('For a same-day rental, return time must be after pickup time.')
      return
    }
    if (dateRangeOverlaps(startDate, endDate, bookedRanges)) {
      setBookingError('Those dates overlap an existing booking. Please choose different dates.')
      return
    }
    if (!supabase || !user?.id) {
      setBookingError('Your session is unavailable. Please sign in again and retry.')
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    try {
      let distanceKm
      let driveMinutes = null
      try {
        const token = import.meta.env.VITE_MAPBOX_TOKEN
        if (!token || item.latitude == null || item.longitude == null) throw new Error('Directions are unavailable.')
        const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${item.longitude},${item.latitude};${renterLongitude},${renterLatitude}?overview=full&geometries=geojson&access_token=${encodeURIComponent(token)}`)
        if (!response.ok) throw new Error('Directions request failed.')
        const route = (await response.json()).routes?.[0]
        if (!route) throw new Error('No driving route found.')
        distanceKm = route.distance / 1000
        driveMinutes = Math.max(1, Math.round(route.duration / 60))
      } catch {
        distanceKm = item.latitude != null && item.longitude != null
          ? distanceBetweenCoordinates({ latitude: item.latitude, longitude: item.longitude }, { latitude: renterLatitude, longitude: renterLongitude })
          : null
      }
      if (saveDefaultLocation) {
        try {
          const { error: profileError } = await supabase.rpc('save_my_location', { p_address: renterAddress.trim(), p_latitude: renterLatitude, p_longitude: renterLongitude })
          if (profileError) throw profileError
        } catch (profileError) {
          setDefaultLocationError(defaultLocationErrorMessage(profileError))
          return
        }
      }
      const { data: createdBooking, error } = await supabase.from('bookings').insert({
        item_id: item.id,
        status: 'pending_payment',
        start_date: startDate,
        end_date: endDate,
        pickup_time: pickupTime,
        return_time: returnTime,
        meeting_spot: meetingSpot.trim() || null,
        meeting_lat: meetingLatitude,
        meeting_lng: meetingLongitude,
        renter_address: renterAddress.trim(),
        renter_lat: renterLatitude,
        renter_lng: renterLongitude,
        distance_km: distanceKm == null ? null : Number(distanceKm.toFixed(3)),
        drive_minutes: driveMinutes,
      }).select('id, total_price, created_at').single()
      if (error) {
        if (error.code === '23P01') {
          setBookingError(bookingErrorMessage(error))
          try {
            await refreshBookedRanges()
          } catch (refreshError) {
            setRangesError(refreshError?.message || 'We could not refresh the booked dates.')
          }
          return
        }
        throw error
      }
      const hold = { id: createdBooking.id, total: Number(createdBooking.total_price), startDate, endDate, pickupTime, returnTime, days }
      setPendingPayment(hold)
      setPaymentMessage('Your dates are held for 15 minutes while payment is pending.')
      await payForBooking(hold)
    } catch (error) {
      setBookingError(bookingErrorMessage(error))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  if (!user) {
    return <section className="booking-panel guest-booking-panel" aria-labelledby="booking-heading">
      <span className="details-section-kicker">READY WHEN YOU ARE</span><h2 id="booking-heading">Book this item</h2>
      <p>Sign in to choose dates, coordinate pickup, and book securely.</p>
      <Link to="/login" state={{ from: { pathname: window.location.pathname } }} className="booking-submit-button guest-booking-link">Log in to book <ArrowRight size={16} /></Link>
      <p className="guest-booking-signup">New to RentMate? <Link to="/register">Create an account</Link></p>
    </section>
  }

  if (success) {
    return <section className="booking-panel booking-success-panel" aria-labelledby="booking-success-heading" role="status">
      <span className="booking-success-mark" aria-hidden="true">✓</span><span className="details-section-kicker">ALL SET</span><h2 id="booking-success-heading">Your booking is confirmed.</h2>
      <p className="booking-success-dates">{formatBookingDate(success.startDate)} {success.pickupTime} – {formatBookingDate(success.endDate)} {success.returnTime} · {success.days} {success.days === 1 ? 'day' : 'days'}</p>
      <div className="booking-success-total"><span>Total paid</span><strong>{formatBookingPrice(success.total)}</strong></div>
      <p className="booking-payment-id">Payment ID: {success.paymentId}</p>
      <Link to={`/bookings/${success.id}`} className="booking-submit-button booking-my-bookings-link">View booking details <span aria-hidden="true">↗</span></Link>
    </section>
  }

  if (pendingPayment) {
    return <section className="booking-panel booking-success-panel" aria-labelledby="booking-pending-heading">
      <span className="details-section-kicker">PAYMENT PENDING</span><h2 id="booking-pending-heading">Your dates are on hold.</h2>
      <p className="booking-success-dates">{formatBookingDate(pendingPayment.startDate)} {pendingPayment.pickupTime} – {formatBookingDate(pendingPayment.endDate)} {pendingPayment.returnTime} · {pendingPayment.days} {pendingPayment.days === 1 ? 'day' : 'days'}</p>
      <div className="booking-success-total"><span>Total to pay</span><strong>{formatBookingPrice(pendingPayment.total)}</strong></div>
      <p className="booking-payment-test-note">Test mode: no real money is charged.</p>
      {paymentMessage && <p className="booking-message" role="status">{paymentMessage}</p>}
      <button type="button" className="booking-submit-button" onClick={() => payForBooking(pendingPayment)} disabled={paying}>{paying ? 'Opening checkout…' : 'Pay now'}</button>
      <Link to="/bookings" className="booking-my-bookings-link">Go to My Bookings to pay later or cancel</Link>
    </section>
  }

  return <section className="booking-panel" aria-labelledby="booking-heading">
    <span className="details-section-kicker">MAKE IT YOURS</span><h2 id="booking-heading">Book this item</h2>
    <p className="booking-intro">Choose your dates and we’ll take care of the rest.</p>
    <form className="booking-form" onSubmit={submitBooking}>
      <div className="booking-date-fields">
        <div className="booking-date-field"><span className="booking-date-label">Start date</span><div className="booking-date-value" aria-live="polite">{startDate ? formatBookingDate(startDate) : 'Choose on the calendar'}</div></div>
        <div className="booking-date-field"><span className="booking-date-label">End date</span><div className="booking-date-value" aria-live="polite">{endDate ? formatBookingDate(endDate) : 'Choose on the calendar'}</div></div>
      </div>
      <AvailabilityCalendar item={item} bookedRanges={bookedRanges} mode="select" startDate={startDate} endDate={endDate} disabled={rangesLoading || Boolean(rangesError) || !availableWindow} disabledMessage={rangesLoading ? 'Checking availability' : rangesError ? 'Availability could not be checked' : 'No upcoming availability'} onSelect={(value) => { if (!startDate || endDate) chooseStart(value); else chooseEnd(value) }} />
      <div className="booking-date-fields booking-time-fields">
        <div className="booking-date-field"><label htmlFor="booking-pickup-time">Pickup time</label><select id="booking-pickup-time" value={pickupTime} onChange={(event) => setPickupTime(event.target.value)} disabled={!startDate}><option value="">Choose a time</option>{timeOptions.map((time) => <option key={time} value={time}>{time}</option>)}</select></div>
        <div className="booking-date-field"><label htmlFor="booking-return-time">Return time</label><select id="booking-return-time" value={returnTime} onChange={(event) => setReturnTime(event.target.value)} disabled={!endDate}><option value="">Choose a time</option>{timeOptions.map((time) => <option key={time} value={time}>{time}</option>)}</select></div>
      </div>
      {sameDayTimeInvalid && <p className="booking-message booking-error" role="alert">For a same-day rental, return time must be after pickup time.</p>}
      <div className="booking-location-fields"><AddressSearch label="Your location" value={renterAddress} onChange={(address) => setRenterLocation((current) => ({ ...current, address, latitude: null, longitude: null }))} onSelect={(value) => setRenterLocation({ address: value.address, latitude: value.latitude, longitude: value.longitude })} /><label className="booking-save-default"><input type="checkbox" checked={saveDefaultLocation} onChange={(event) => setSaveDefaultLocation(event.target.checked)} /> Save as my default location</label><AddressSearch label="Meeting spot (optional)" value={meetingSpot} placeholder="Search a meeting point or landmark" onChange={(address) => { setMeetingSpot(address); setMeetingLatitude(null); setMeetingLongitude(null) }} onSelect={(value) => { setMeetingSpot(value.address); setMeetingLatitude(value.latitude); setMeetingLongitude(value.longitude) }} /></div>
      {defaultLocationError && <p className="booking-message booking-error" role="alert">{defaultLocationError}</p>}
      <p className="booking-date-help" id="booking-date-help">Available {formatBookingDate(item.available_from)} – {formatBookingDate(item.available_to)}. Booked dates cannot be selected.</p>
      {rangesLoading && <p className="booking-inline-status" role="status">Checking available dates…</p>}
      {rangesError && <p className="booking-message booking-error" role="alert">We could not check availability. {rangesError}</p>}
      {!availableWindow && <p className="booking-message booking-error" role="status">This item has no future dates available.</p>}
      {!rangesLoading && !rangesError && bookedRanges.length > 0 && <div className="booking-taken-ranges"><span>Already booked</span>{bookedRanges.map((range) => <span key={`${range.start_date}-${range.end_date}`}>{formatBookingDate(range.start_date)} – {formatBookingDate(range.end_date)}</span>)}</div>}
      {selectionError && <p className="booking-message booking-error" role="alert">{selectionError}</p>}
      <div className="booking-price-summary" aria-live="polite">
        <div><span>Price per day</span><strong>{formatBookingPrice(item.price_per_day)}</strong></div>
        {days > 0 && <div><span>{days} {days === 1 ? 'day' : 'days'}</span><strong>{formatBookingPrice(total)}</strong></div>}
        <div className="booking-total-row"><span>Total</span><strong>{days > 0 ? formatBookingPrice(total) : '—'}</strong></div>
      </div>
      {bookingError && <p className="booking-message booking-error" role="alert">{bookingError}</p>}
      <button type="submit" className="booking-submit-button" disabled={!startDate || !endDate || !pickupTime || !returnTime || !renterAddress.trim() || renterLatitude == null || renterLongitude == null || sameDayTimeInvalid || rangesLoading || Boolean(rangesError) || !availableWindow || submitting}>
        {submitting ? <><span className="booking-spinner" aria-hidden="true" /> Booking…</> : <>Book now <span aria-hidden="true">↗</span></>}
      </button>
      <p className="booking-secure-note"><span aria-hidden="true">✓</span> Dates are held for up to 15 minutes while you complete payment.</p>
    </form>
  </section>
}

function DetailsSkeleton() {
  return <main className="item-details-page" role="status" aria-label="Loading item details"><div className="item-details-container"><div className="details-skeleton-bar" /><div className="details-skeleton-grid"><div className="details-skeleton-photo" /><div className="details-skeleton-copy"><i /><i /><i /><i /><i /></div></div></div></main>
}

export default function ItemDetailsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [item, setItem] = useState(null)
  const [privateItemLocation, setPrivateItemLocation] = useState(null)
  const [renterLocation, setRenterLocation] = useState({ address: '', latitude: null, longitude: null })
  const [routeCoordinates, setRouteCoordinates] = useState(null)
  const [routeDistanceKm, setRouteDistanceKm] = useState(null)
  const [routeDriveMinutes, setRouteDriveMinutes] = useState(null)
  const [roadRouteAvailable, setRoadRouteAvailable] = useState(null)
  const [ownerName, setOwnerName] = useState('RentMate member')
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState('')
  const [reviews, setReviews] = useState([])
  const [ratingSummary, setRatingSummary] = useState(null)
  const [reviewsLoading, setReviewsLoading] = useState(true)
  const [reviewsError, setReviewsError] = useState('')
  const [startingConversation, setStartingConversation] = useState(false)
  const [conversationError, setConversationError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function loadItem() {
      setLoading(true)
      setNotFound(false)
      setError('')
      if (!supabase) {
        setError('Supabase is not configured. Check your project URL and public API key in .env.')
        setLoading(false)
        return
      }
      try {
        const { data, error: itemError } = await supabase.from('items').select('id, owner_id, title, description, category, price_per_day, location, image_url, available_from, available_to').eq('id', id).maybeSingle()
        if (itemError) throw itemError
        if (!data) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (cancelled) return
        let approximateLocation = {}
        try {
          const { data: locationRows, error: locationError } = await supabase.rpc('get_item_approximate_locations', { p_item_ids: [data.id] })
          if (!locationError && locationRows?.[0]) approximateLocation = locationRows[0]
        } catch {
          // The listing details remain available if the optional location RPC is unavailable.
        }
        if (cancelled) return
        setItem({ ...data, ...approximateLocation })
        const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', data.owner_id).maybeSingle()
        if (!cancelled && profile?.full_name?.trim()) setOwnerName(profile.full_name.trim())
      } catch (loadError) {
        if (!cancelled) setError(loadError?.message || 'We could not load this item. Please try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadItem()
    return () => { cancelled = true }
  }, [id])

  useEffect(() => {
    let active = true
    if (!user?.id || !item?.id || !supabase) { setPrivateItemLocation(null); return () => { active = false } }
    supabase.rpc('get_item_private_address', { p_item_id: item.id }).then(({ data, error: locationError }) => {
      if (active && !locationError) setPrivateItemLocation(data?.[0] || null)
    }).catch(() => { if (active) setPrivateItemLocation(null) })
    return () => { active = false }
  }, [item?.id, user?.id])

  useEffect(() => {
    let active = true
    const pickupLatitude = privateItemLocation?.latitude ?? item?.latitude
    const pickupLongitude = privateItemLocation?.longitude ?? item?.longitude
    const { latitude: renterLatitude, longitude: renterLongitude } = renterLocation
    if (pickupLatitude == null || pickupLongitude == null || renterLatitude == null || renterLongitude == null) {
      setRouteCoordinates(null)
      setRouteDistanceKm(null)
      setRouteDriveMinutes(null)
      setRoadRouteAvailable(false)
      return () => { active = false }
    }

    setRoadRouteAvailable(null)
    async function loadDrivingRoute() {
      try {
        const token = import.meta.env.VITE_MAPBOX_TOKEN
        if (!token) throw new Error('Mapbox Directions are not configured.')
        const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${pickupLongitude},${pickupLatitude};${renterLongitude},${renterLatitude}?overview=full&geometries=geojson&access_token=${encodeURIComponent(token)}`)
        if (!response.ok) throw new Error('Directions request failed.')
        const route = (await response.json()).routes?.[0]
        if (!route?.geometry?.coordinates?.length) throw new Error('No driving route was returned.')
        if (active) {
          setRouteCoordinates(route.geometry.coordinates)
          setRouteDistanceKm(route.distance / 1000)
          setRouteDriveMinutes(Math.max(1, Math.round(route.duration / 60)))
          setRoadRouteAvailable(true)
        }
      } catch {
        if (active) {
          setRouteCoordinates(null)
          setRouteDistanceKm(null)
          setRouteDriveMinutes(null)
          setRoadRouteAvailable(false)
        }
      }
    }
    loadDrivingRoute()
    return () => { active = false }
  }, [item?.latitude, item?.longitude, privateItemLocation?.latitude, privateItemLocation?.longitude, renterLocation.latitude, renterLocation.longitude])

  async function messageOwner() {
    if (!item || !user?.id || user.id === item.owner_id || startingConversation || !supabase) return
    setStartingConversation(true)
    setConversationError('')
    try {
      const { data, error: conversationStartError } = await supabase.rpc('start_conversation', { p_item_id: item.id })
      if (conversationStartError) throw conversationStartError
      const conversationId = Array.isArray(data) ? data[0] : data
      if (!conversationId) throw new Error('We could not open this conversation. Please try again.')
      navigate(`/messages?conversation=${encodeURIComponent(conversationId)}`)
    } catch (startError) {
      setConversationError(['42883', 'PGRST202'].includes(startError?.code)
        ? 'Chat is not set up yet. Run chat_setup.sql in your Supabase SQL Editor.'
        : startError?.message || 'We could not start a conversation. Please try again.')
    } finally {
      setStartingConversation(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function loadReviews() {
      setReviewsLoading(true)
      setReviewsError('')
      if (!supabase) {
        setReviewsError('Reviews are unavailable because Supabase is not configured.')
        setReviewsLoading(false)
        return
      }
      if (!user?.id) {
        setReviewsError('Sign in to view community reviews.')
        setReviewsLoading(false)
        return
      }
      try {
        const [{ data: reviewRows, error: reviewError }, { data: summary, error: summaryError }] = await Promise.all([
          supabase.from('reviews').select('id, reviewer_id, rating, comment, created_at').eq('item_id', id).order('created_at', { ascending: false }),
          supabase.from('item_rating_summary').select('item_id, average_rating, review_count').eq('item_id', id).maybeSingle(),
        ])
        if (reviewError) throw reviewError
        if (summaryError) throw summaryError
        const rows = reviewRows || []
        const reviewerIds = [...new Set(rows.map((review) => review.reviewer_id))]
        let profilesById = {}
        if (reviewerIds.length) {
          const { data: profiles, error: profileError } = await supabase.from('profiles').select('id, full_name').in('id', reviewerIds)
          if (profileError) throw profileError
          profilesById = Object.fromEntries((profiles || []).map((profile) => [profile.id, profile.full_name]))
        }
        if (!cancelled) {
          setReviews(rows.map((review) => ({ ...review, reviewer_name: profilesById[review.reviewer_id] || 'RentMate member' })))
          setRatingSummary(summary || null)
        }
      } catch {
        if (!cancelled) setReviewsError('Could not load reviews. Check that the ratings and reviews database setup has been applied.')
      } finally {
        if (!cancelled) setReviewsLoading(false)
      }
    }
    loadReviews()
    return () => { cancelled = true }
  }, [id, user?.id])

  if (loading) return <DetailsSkeleton />

  const pickupLatitude = privateItemLocation?.latitude ?? item?.latitude
  const pickupLongitude = privateItemLocation?.longitude ?? item?.longitude
  const canSetRenterPin = Boolean(user?.id && user.id !== item?.owner_id)
  const mapMarkers = [
    ...(pickupLatitude != null && pickupLongitude != null ? [{ latitude: pickupLatitude, longitude: pickupLongitude, label: 'Owner pickup' }] : []),
    ...(renterLocation.latitude != null && renterLocation.longitude != null ? [{
      latitude: renterLocation.latitude,
      longitude: renterLocation.longitude,
      label: 'Renter location',
      color: '#7C3AED',
      draggable: canSetRenterPin,
      onChange: (coordinates) => setRenterLocation((current) => ({
        ...current,
        address: `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}`,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      })),
    }] : []),
  ]

  return <main className="item-details-page"><div className="item-details-container">
    <Link to="/browse" className="details-back-link"><span aria-hidden="true">←</span> Back to Browse</Link>
    {error ? <section className="details-empty-state" role="alert"><span className="details-section-kicker">ITEM DETAILS</span><h1>We couldn’t load this item.</h1><p>{error}</p><Link to="/browse" className="details-primary-link">Back to Browse</Link></section>
      : notFound ? <section className="details-empty-state"><span className="details-section-kicker">NO LISTING HERE</span><h1>Item not found.</h1><p>This listing may have been removed or the link may have changed.</p><Link to="/browse" className="details-primary-link">Explore Browse</Link></section>
        : item && <>
          <header className="details-heading"><span className="details-section-kicker">A CLOSER LOOK</span><h1>{item.title}</h1></header>
          <div className="details-layout">
            <div className="details-main-column">
              <div className="details-photo-frame"><ItemPhoto item={item} /></div>
              <section className="details-description" aria-labelledby="description-heading"><span className="details-section-kicker">THE DETAILS</span><h2 id="description-heading">A little more about it</h2><p>{item.description?.trim() || 'No description has been added yet. Reach out to the owner to learn more about this item.'}</p></section>
              <section className="details-location-map-card" aria-label="Pickup and renter locations">
                <span className="details-section-kicker">PICKUP AND YOUR LOCATION</span>
                <p>{canSetRenterPin ? 'Use your current location above, search for an address, or click and drag the renter pin. The pickup pin is approximate until its exact location is authorized.' : 'The pickup pin shows the approximate area; the owner’s exact location stays private.'}</p>
                <MapView routeMap height={550} readOnly={!canSetRenterPin} label="Owner pickup and renter locations" markers={mapMarkers} onChange={canSetRenterPin ? (coordinates) => setRenterLocation((current) => ({ ...current, address: `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}`, latitude: coordinates.latitude, longitude: coordinates.longitude })) : undefined} routeCoordinates={routeCoordinates} roadRouteAvailable={roadRouteAvailable} distanceKm={routeDistanceKm} driveMinutes={routeDriveMinutes} />
              </section>
              <ItemReviews reviews={reviews} summary={ratingSummary} loading={reviewsLoading} error={reviewsError} />
              <section className="details-owner-card" aria-label="Item owner"><div className="details-owner-initial" aria-hidden="true">{ownerName.charAt(0).toLocaleUpperCase('en-IN')}</div><div><span className="details-section-kicker">SHARED BY</span><h2>{ownerName}</h2><p>Owner</p>{user && user.id !== item.owner_id && <><button type="button" className="message-owner-button" onClick={messageOwner} disabled={startingConversation}>{startingConversation ? 'Opening chat…' : 'Message owner'}</button>{conversationError && <p className="message-owner-error" role="alert">{conversationError}</p>}</>}</div><span className="owner-card-mark" aria-hidden="true">r.</span></section>
            </div>
            <aside className="details-side-column" aria-label="Item information and booking">
              <section className="details-info-card"><div className="details-card-top"><span className="details-category">{item.category}</span><span className="details-location"><span aria-hidden="true">⌖</span>{item.location || 'Location not specified'}</span></div>
                <div className="details-price">{formatPrice(item.price_per_day)}<span> / day</span></div><p className="details-price-caption">A clear daily rate, with no surprises.</p>
                {privateItemLocation?.address && <div className="details-exact-pickup"><span className="details-section-kicker">PICKUP ADDRESS</span><p>{privateItemLocation.address}</p></div>}
                <div className="details-availability"><span className="details-section-kicker">AVAILABLE</span><p>{formatDate(item.available_from)} <span aria-hidden="true">—</span><br />{formatDate(item.available_to)}</p></div>
              </section>
              {user?.id === item.owner_id ? <section className="own-item-notice" role="status"><span className="own-item-check" aria-hidden="true">✓</span><div><h2>This is your item</h2><p>You’re viewing your own listing.</p></div></section> : <BookingPanel item={item} renterLocation={renterLocation} setRenterLocation={setRenterLocation} />}
            </aside>
          </div>
        </>}
  </div></main>
}
