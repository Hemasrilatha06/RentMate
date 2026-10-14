import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import MapView from '../components/MapView'
import AddressSearch from '../components/AddressSearch'
import DistanceBadge from '../components/DistanceBadge'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import './BookingDetailsPage.css'

const timeOptions = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`)
const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })

function formatDate(value) {
  if (!value) return 'Not specified'
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

function formatTime(value) {
  return value ? value.slice(0, 5) : 'Not set'
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function bookingLoadError(error) {
  if (error?.code === '42883' || error?.code === 'PGRST202') return 'Private location details are not set up yet. Run mapbox_location_setup.sql in your Supabase SQL Editor, then reload this page.'
  if (error?.code === '42P01' || error?.code === '42703') return 'Booking timing fields are not set up yet. Run location_timing_setup.sql in Supabase, then reload this page.'
  if (error?.code === '42501') return 'You do not have permission to view this booking.'
  return error?.message || 'We could not load this booking. Please try again.'
}

export default function BookingDetailsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [booking, setBooking] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notAllowed, setNotAllowed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [transitionError, setTransitionError] = useState('')
  const [transitionSuccess, setTransitionSuccess] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatError, setChatError] = useState('')
  const [form, setForm] = useState({ pickupTime: '', returnTime: '', meetingSpot: '', meetingLatitude: null, meetingLongitude: null })
  const [privateLocations, setPrivateLocations] = useState(null)
  const [routeCoordinates, setRouteCoordinates] = useState(null)
  const [routeDistanceKm, setRouteDistanceKm] = useState(null)
  const [routeDriveMinutes, setRouteDriveMinutes] = useState(null)
  const [roadRouteAvailable, setRoadRouteAvailable] = useState(null)
  const [agreementError, setAgreementError] = useState('')
  const [agreeing, setAgreeing] = useState(false)

  const loadBooking = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const { data, error: queryError } = await supabase.from('bookings')
      .select('id, item_id, renter_id, start_date, end_date, total_price, status, payment_id, paid_at, pickup_time, return_time, meeting_spot, meeting_lat, meeting_lng, meeting_spot_proposed_by, meeting_spot_confirmed, renter_address, renter_lat, renter_lng, distance_km, drive_minutes, items(id, title, owner_id, location)')
      .eq('id', id)
      .maybeSingle()
    if (queryError) throw queryError
    if (data?.items) {
      const { data: locations } = await supabase.rpc('get_item_approximate_locations', { p_item_ids: [data.item_id] })
      if (locations?.[0]) data.items = { ...data.items, ...locations[0] }
    }
    if (data) {
      const { data: privateRows, error: privateError } = await supabase.rpc('get_booking_private_locations', { p_booking_id: data.id })
      if (privateError) throw privateError
      data.privateLocations = privateRows?.[0] || null
    }
    return data
  }, [id])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setNotAllowed(false)
    loadBooking().then((data) => {
      if (!active) return
      if (!data || (data.renter_id !== user?.id && data.items?.owner_id !== user?.id)) {
        setNotAllowed(true)
        return
      }
      setBooking(data)
      setPrivateLocations(data.privateLocations)
      setForm({
        pickupTime: formatTime(data.pickup_time) === 'Not set' ? '' : formatTime(data.pickup_time),
        returnTime: formatTime(data.return_time) === 'Not set' ? '' : formatTime(data.return_time),
        meetingSpot: data.meeting_spot || '',
        meetingLatitude: data.meeting_lat ?? data.privateLocations?.item_lat ?? data.items?.latitude ?? null,
        meetingLongitude: data.meeting_lng ?? data.privateLocations?.item_lng ?? data.items?.longitude ?? null,
      })
    }).catch((loadError) => { if (active) setError(bookingLoadError(loadError)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [loadBooking, user?.id])

  useEffect(() => {
    const from = privateLocations?.item_lat != null && privateLocations?.item_lng != null ? `${privateLocations.item_lng},${privateLocations.item_lat}` : null
    const to = privateLocations?.renter_lat != null && privateLocations?.renter_lng != null ? `${privateLocations.renter_lng},${privateLocations.renter_lat}` : null
    if (!from || !to) { setRouteCoordinates(null); setRouteDistanceKm(null); setRouteDriveMinutes(null); setRoadRouteAvailable(false); return }
    let active = true
    setRoadRouteAvailable(null)
    async function loadRoute() {
      try {
        const token = import.meta.env.VITE_MAPBOX_TOKEN
        if (!token) throw new Error('No Mapbox token')
        const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${from};${to}?overview=full&geometries=geojson&access_token=${encodeURIComponent(token)}`)
        if (!response.ok) throw new Error('No route')
        const route = (await response.json()).routes?.[0]
        if (!route?.geometry?.coordinates?.length) throw new Error('No route')
        if (active) {
          setRouteCoordinates(route.geometry.coordinates)
          setRouteDistanceKm(route.distance / 1000)
          setRouteDriveMinutes(Math.max(1, Math.round(route.duration / 60)))
          setRoadRouteAvailable(true)
        }
      } catch {
        if (active) {
          setRouteCoordinates([[Number(from.split(',')[0]), Number(from.split(',')[1])], [Number(to.split(',')[0]), Number(to.split(',')[1])]])
          setRouteDistanceKm(null)
          setRouteDriveMinutes(null)
          setRoadRouteAvailable(false)
        }
      }
    }
    loadRoute()
    return () => { active = false }
  }, [privateLocations])

  const isParticipant = useMemo(() => Boolean(booking && (booking.renter_id === user?.id || booking.items?.owner_id === user?.id)), [booking, user?.id])
  const isOwner = Boolean(booking && booking.items?.owner_id === user?.id)
  const isRenter = Boolean(booking && booking.renter_id === user?.id)
  const hasPickupCoordinates = privateLocations?.item_lat != null && privateLocations?.item_lng != null
  const hasRenterCoordinates = privateLocations?.renter_lat != null && privateLocations?.renter_lng != null
  const sameDayTimeInvalid = Boolean(booking && booking.start_date === booking.end_date && form.pickupTime && form.returnTime && form.returnTime <= form.pickupTime)
  const directionsUrl = form.meetingLatitude != null && form.meetingLongitude != null
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${form.meetingLatitude},${form.meetingLongitude}`)}`
    : null

  async function saveDetails(event) {
    event.preventDefault()
    if (saving || !booking || !isParticipant) return
    setSaveError('')
    setSaveSuccess(false)
    if (!form.pickupTime || !form.returnTime) {
      setSaveError('Choose both a pickup time and a return time.')
      return
    }
    if (sameDayTimeInvalid) {
      setSaveError('For a same-day rental, return time must be after pickup time.')
      return
    }
    setSaving(true)
    try {
      const { data, error: updateError } = await supabase.from('bookings').update({
        pickup_time: form.pickupTime,
        return_time: form.returnTime,
        meeting_spot: form.meetingSpot.trim() || null,
        meeting_lat: form.meetingLatitude,
        meeting_lng: form.meetingLongitude,
      }).eq('id', booking.id).eq('status', 'confirmed')
        .select('id, pickup_time, return_time, meeting_spot, meeting_lat, meeting_lng, meeting_spot_proposed_by, meeting_spot_confirmed')
        .maybeSingle()
      if (updateError) throw updateError
      if (!data) throw new Error('This booking is no longer confirmed. Refresh to see its latest details.')
      setBooking((current) => ({ ...current, ...data }))
      setForm((current) => ({ ...current, pickupTime: formatTime(data.pickup_time), returnTime: formatTime(data.return_time), meetingSpot: data.meeting_spot || '' }))
      setSaveSuccess(true)
    } catch (updateError) {
      setSaveError(updateError?.code === '42501'
        ? 'Your account could not edit this booking. Confirm location_timing_setup.sql and mapbox_location_setup.sql have been applied and try again.'
        : updateError?.message || 'We could not save these details. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function agreeToSpot() {
    if (!booking || agreeing || booking.status !== 'confirmed') return
    setAgreementError('')
    setAgreeing(true)
    try {
      const { error: agreeError } = await supabase.rpc('agree_booking_meeting_spot', { p_booking_id: booking.id })
      if (agreeError) throw agreeError
      setBooking((current) => ({ ...current, meeting_spot_confirmed: true }))
    } catch (agreeError) { setAgreementError(agreeError?.message || 'We could not confirm this pickup spot. Please try again.') }
    finally { setAgreeing(false) }
  }

  async function transitionBooking(nextStatus, expectedStatus, confirmation) {
    if (!booking || !isParticipant || transitioning) return
    if (!window.confirm(confirmation)) return
    setTransitioning(true)
    setTransitionError('')
    setTransitionSuccess('')
    try {
      const { data, error: updateError } = await supabase.from('bookings')
        .update({ status: nextStatus })
        .eq('id', booking.id)
        .eq('status', expectedStatus)
        .select('id, status')
        .maybeSingle()
      if (updateError) throw updateError
      if (!data) throw new Error('This booking has changed. Refresh the page to see its latest status.')
      setBooking((current) => ({ ...current, status: data.status }))
      setTransitionSuccess(`Booking status updated to ${data.status.replaceAll('_', ' ')}.`)
    } catch (updateError) {
      setTransitionError(updateError?.code === '42501'
        ? 'Your account is not allowed to make this handover change.'
        : updateError?.message || 'We could not update this booking. Please try again.')
    } finally {
      setTransitioning(false)
    }
  }

  async function openChat() {
    if (!booking || !isParticipant || chatLoading || !supabase) return
    setChatLoading(true)
    setChatError('')
    try {
      const functionName = isRenter ? 'start_conversation' : 'start_booking_conversation'
      const args = isRenter ? { p_item_id: booking.item_id } : { p_booking_id: booking.id }
      const { data, error: startError } = await supabase.rpc(functionName, args)
      if (startError) throw startError
      const conversationId = Array.isArray(data) ? data[0] : data
      if (!conversationId) throw new Error('We could not open this conversation. Please try again.')
      navigate(`/messages?conversation=${encodeURIComponent(conversationId)}`)
    } catch (startError) {
      setChatError(['42883', 'PGRST202'].includes(startError?.code)
        ? 'Chat is not set up yet. Run chat_setup.sql in your Supabase SQL Editor.'
        : startError?.message || 'We could not open this conversation. Please try again.')
    } finally {
      setChatLoading(false)
    }
  }

  if (loading) return <main className="item-details-page"><div className="item-details-container"><div className="details-skeleton-bar" /><div className="edit-item-loading-card" role="status" aria-label="Loading booking details"><i /><i /><i /></div></div></main>
  if (notAllowed) return <main className="item-details-page"><div className="item-details-container"><section className="details-empty-state"><span className="details-section-kicker">PRIVATE BOOKING</span><h1>This booking isnâ€™t available.</h1><p>Only the renter and item owner can view its details.</p><Link to="/bookings" className="details-primary-link">Back to My Bookings</Link></section></div></main>
  if (error || !booking) return <main className="item-details-page"><div className="item-details-container"><section className="details-empty-state" role="alert"><span className="details-section-kicker">A LITTLE PAUSE</span><h1>We couldnâ€™t load this booking.</h1><p>{error || 'This booking was not found.'}</p><Link to="/bookings" className="details-primary-link">Back to My Bookings</Link></section></div></main>

  const canEdit = booking.status === 'confirmed' && isParticipant
  const mapLatitude = form.meetingLatitude
  const mapLongitude = form.meetingLongitude

  return <main className="item-details-page booking-details-page"><div className="item-details-container">
    <Link to="/bookings" className="details-back-link"><span aria-hidden="true">&#8592;</span> Back to My Bookings</Link>
    <header className="details-heading booking-page-heading"><span className="details-section-kicker">BOOKING DETAILS</span><h1>{booking.items?.title || 'Your rental'}</h1></header>
    <div className="booking-detail-layout">
      <section className="booking-detail-card booking-rental-card" aria-labelledby="booking-rental-heading">
        <span className="details-section-kicker">YOUR RESERVATION</span><h2 id="booking-rental-heading">Rental plan</h2>
        <dl className="booking-detail-grid">
          <div><dt>Booking status</dt><dd><span className={'booking-status-badge booking-status-' + booking.status}>{booking.status.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')}</span></dd></div>
          <div><dt>Booking dates</dt><dd>{formatDate(booking.start_date)} &ndash; {formatDate(booking.end_date)}</dd></div>
          <div><dt>Pickup date &amp; time</dt><dd>{formatDate(booking.start_date)} &middot; {formatTime(booking.pickup_time)}</dd></div>
          <div><dt>Return date &amp; time</dt><dd>{formatDate(booking.end_date)} &middot; {formatTime(booking.return_time)}</dd></div>
          <div><dt>Meeting location</dt><dd>{booking.meeting_spot || 'Not specified'}</dd></div>
          {privateLocations?.item_address && <div><dt>Pickup address</dt><dd>{privateLocations.item_address}</dd></div>}
          {isOwner && privateLocations?.renter_address && <div><dt>Renter location</dt><dd>{privateLocations.renter_address}</dd></div>}
          <div className="booking-total-row"><dt>Total rental amount</dt><dd>{currency.format(Number(booking.total_price))}</dd></div>
        </dl>
        {((isOwner && booking.status === 'confirmed') || (isRenter && booking.status === 'picked_up') || (isOwner && booking.status === 'return_requested')) && <div className="booking-detail-actions booking-handover-actions">
          {isOwner && booking.status === 'confirmed' && <button type="button" className="booking-detail-save" disabled={transitioning} onClick={() => transitionBooking('picked_up', 'confirmed', 'Confirm that you have handed this item to the renter?')}>{transitioning ? <>Updating&hellip;</> : 'Mark handed over'}</button>}
          {isRenter && booking.status === 'picked_up' && <button type="button" className="booking-detail-save" disabled={transitioning} onClick={() => transitionBooking('return_requested', 'picked_up', 'Confirm that you have returned this item and are asking the owner to verify it?')}>{transitioning ? <>Updating&hellip;</> : 'I returned it'}</button>}
          {isOwner && booking.status === 'return_requested' && <button type="button" className="booking-detail-save" disabled={transitioning || booking.end_date >= localDateString()} onClick={() => transitionBooking('returned', 'return_requested', 'Confirm that the renter returned this item?')}>{transitioning ? <>Updating&hellip;</> : 'Confirm return'}</button>}
        </div>}
        {transitionError && <p className="booking-detail-error" role="alert">{transitionError}</p>}
        {transitionSuccess && <p className="booking-detail-success" role="status">{transitionSuccess}</p>}
      </section>
      <aside className="booking-detail-card booking-payment-card" aria-labelledby="booking-payment-heading">
        <span className="details-section-kicker">PAYMENT</span><h2 id="booking-payment-heading">Payment details</h2>
        <div className="booking-payment-status"><span>Payment status</span>{booking.payment_id ? <strong className="booking-paid-badge">Paid</strong> : <strong className="booking-status-badge booking-status-pending">{booking.status === 'pending_payment' ? 'Pending' : 'Not recorded'}</strong>}</div>
        <div className="booking-payment-amount"><span>Total amount</span><strong>{currency.format(Number(booking.total_price))}</strong></div>
        {booking.payment_id && <div className="booking-payment-id"><span>Payment ID</span><code>{booking.payment_id}</code></div>}
        <div className="booking-detail-links"><Link to={'/items/' + booking.item_id} className="booking-list-detail-link">View item listing</Link><button type="button" className="booking-chat-button" onClick={openChat} disabled={chatLoading}>{chatLoading ? <>Opening chat&hellip;</> : 'Chat'}</button></div>
        {chatError && <p className="booking-detail-error" role="alert">{chatError}</p>}
      </aside>
    </div>
    <section className="booking-route-section booking-detail-card" aria-labelledby="booking-route-heading">
      <div className="booking-section-heading"><span className="details-section-kicker">PICKUP &amp; DIRECTIONS</span><h2 id="booking-route-heading">Pickup &amp; route</h2></div>
      {booking.meeting_spot_confirmed && <p className="spot-agreed-badge" role="status">Spot agreed</p>}
      {booking.status === 'confirmed' && booking.meeting_spot_proposed_by && booking.meeting_spot_proposed_by !== user?.id && !booking.meeting_spot_confirmed && <div className="spot-agreement-panel"><p>The other participant proposed this pickup spot.</p><button type="button" className="booking-detail-save" disabled={agreeing} onClick={agreeToSpot}>{agreeing ? <>Agreeing&hellip;</> : 'Agree'}</button>{agreementError && <p className="booking-detail-error" role="alert">{agreementError}</p>}</div>}
      {booking.status === 'confirmed' && booking.meeting_spot_proposed_by === user?.id && !booking.meeting_spot_confirmed && <p className="booking-inline-status" role="status">Waiting for the other person to agree to this pickup spot.</p>}
      {(hasPickupCoordinates || hasRenterCoordinates) ? <MapView routeMap height={420} readOnly label="Route between owner pickup and renter locations" markers={[...(hasPickupCoordinates ? [{ latitude: privateLocations.item_lat, longitude: privateLocations.item_lng, label: 'Owner pickup' }] : []), ...(hasRenterCoordinates ? [{ latitude: privateLocations.renter_lat, longitude: privateLocations.renter_lng, label: 'Renter location', color: '#7C3AED' }] : [])]} routeCoordinates={routeCoordinates} roadRouteAvailable={roadRouteAvailable} distanceKm={routeDistanceKm ?? booking.distance_km} driveMinutes={routeDriveMinutes ?? booking.drive_minutes} /> : <p className="booking-map-empty">Pickup and renter locations are not available yet, so a route cannot be shown.</p>}
    </section>
    <section className="booking-coordination-card booking-detail-card" aria-labelledby="booking-coordination-heading">
      <div className="booking-section-heading"><span className="details-section-kicker">COORDINATE TOGETHER</span><h2 id="booking-coordination-heading">{canEdit ? 'Timing & meeting spot' : booking.meeting_spot || 'Meeting point'}</h2></div>
      {canEdit ? <form className="booking-detail-form" onSubmit={saveDetails}>
        <div className="booking-detail-time-fields">
          <label className="booking-edit-field"><span>Pickup time</span><select value={form.pickupTime} onChange={(event) => setForm((current) => ({ ...current, pickupTime: event.target.value }))} required><option value="">Choose a time</option>{timeOptions.map((time) => <option key={time} value={time}>{time}</option>)}</select></label>
          <label className="booking-edit-field"><span>Return time</span><select value={form.returnTime} onChange={(event) => setForm((current) => ({ ...current, returnTime: event.target.value }))} required><option value="">Choose a time</option>{timeOptions.map((time) => <option key={time} value={time}>{time}</option>)}</select></label>
        </div>
        {sameDayTimeInvalid && <p className="booking-detail-error" role="alert">For a same-day rental, return time must be after pickup time.</p>}
        <AddressSearch label="Proposed pickup spot" value={form.meetingSpot} onChange={(meetingSpot) => setForm((current) => ({ ...current, meetingSpot, meetingLatitude: null, meetingLongitude: null }))} onSelect={(value) => setForm((current) => ({ ...current, meetingSpot: value.address, meetingLatitude: value.latitude, meetingLongitude: value.longitude }))} placeholder="Search a meeting point or landmark" />
        <MapView latitude={mapLatitude} longitude={mapLongitude} onChange={(value) => setForm((current) => ({ ...current, meetingLatitude: value.latitude, meetingLongitude: value.longitude }))} height={220} label="Choose booking meeting spot" />
        {directionsUrl && <a className="booking-detail-link" href={directionsUrl} target="_blank" rel="noreferrer">Get directions <span aria-hidden="true">&#8599;</span></a>}
        {saveError && <p className="booking-detail-error" role="alert">{saveError}</p>}
        {saveSuccess && <p className="booking-detail-success" role="status">Booking details saved.</p>}
        <div className="booking-detail-actions"><button className="booking-detail-save" type="submit" disabled={saving || sameDayTimeInvalid}>{saving ? <>Saving&hellip;</> : 'Save changes'}</button></div>
      </form> : <>
        {mapLatitude != null && mapLongitude != null ? <><MapView latitude={mapLatitude} longitude={mapLongitude} readOnly height={320} zoom={14} label="Booking meeting spot" markers={[{ latitude: mapLatitude, longitude: mapLongitude, label: 'Meeting spot' }, ...(hasPickupCoordinates ? [{ latitude: privateLocations.item_lat, longitude: privateLocations.item_lng, label: 'Owner pickup' }] : []), ...(hasRenterCoordinates ? [{ latitude: privateLocations.renter_lat, longitude: privateLocations.renter_lng, label: 'Renter location' }] : [])]} routeCoordinates={routeCoordinates} routeMap roadRouteAvailable={roadRouteAvailable} distanceKm={booking.distance_km} driveMinutes={booking.drive_minutes} />{directionsUrl && <a className="booking-detail-link" href={directionsUrl} target="_blank" rel="noreferrer">Get directions <span aria-hidden="true">&#8599;</span></a>}</> : <p className="booking-map-empty">No meeting point pin has been set for this booking.</p>}
      </>}
    </section>
  </div></main>

}

