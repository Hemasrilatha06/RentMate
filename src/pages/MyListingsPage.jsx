import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../components/ui/Button'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import './MyListingsPage.css'
import DistanceBadge from '../components/DistanceBadge'

const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

function formatTime(value) {
  return value ? value.slice(0, 5) : 'Not set'
}

function statusLabel(status) {
  return status.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function localDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function ListingSkeleton() {
  return <div className="my-listings-skeletons" role="status" aria-label="Loading your listings">{[0, 1, 2].map((item) => <div className="my-listing-skeleton" key={item}><span /><div><i /><i /><i /></div></div>)}</div>
}

function friendlyError(error) {
  if (error?.code === '22023') return error.message || 'This booking cannot be marked as returned yet. The rental period must be over.'
  if (error?.code === '42501') return 'Your account does not have permission to manage these listings. Check the item access policies in Supabase.'
  if (error?.code === '42P01') return 'The listings or bookings table is missing. Check that the RentMate database setup has been applied.'
  return 'We could not complete that request. Please try again.'
}

// Distance columns are optional until mapbox_location_setup.sql is applied.
// Retry the booking query without only those columns so older deployments
// continue showing the bookings and all other query failures remain visible.
function isMissingDistanceColumn(error) {
  return ['42703', 'PGRST204'].includes(error?.code)
    && /distance_km|drive_minutes/i.test(error?.message || '')
}

async function fetchBookingsForItems(itemIds) {
  const selectBookings = (includeDistance) => supabase
    .from('bookings')
    .select(`id, item_id, renter_id, start_date, end_date, total_price, status, pickup_time, return_time, meeting_spot, meeting_lat, meeting_lng, ${includeDistance ? 'distance_km, drive_minutes, ' : ''}created_at`)
    .in('item_id', itemIds)
    .order('created_at', { ascending: false })

  let result = await selectBookings(true)
  if (isMissingDistanceColumn(result.error)) result = await selectBookings(false)
  return result
}

export default function MyListingsPage() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [busyKey, setBusyKey] = useState('')

  const loadListings = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const { data: ownedItems, error: itemError } = await supabase
      .from('items')
      .select('id, owner_id, title, price_per_day, image_url, available_from, available_to, is_active, created_at')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
    if (itemError) throw itemError
    const listingRows = ownedItems || []
    if (!listingRows.length) return []

    const { data: bookingRows, error: bookingError } = await fetchBookingsForItems(listingRows.map((item) => item.id))
    if (bookingError) throw bookingError
    const bookings = bookingRows || []
    const renterIds = [...new Set(bookings.map((booking) => booking.renter_id).filter(Boolean))]
    let profilesById = {}
    if (renterIds.length) {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', renterIds)
      if (profilesError) throw profilesError
      profilesById = Object.fromEntries((profiles || []).map((profile) => [profile.id, profile.full_name]))
    }
    const bookingsByItem = new Map()
    bookings.forEach((booking) => {
      const list = bookingsByItem.get(booking.item_id) || []
      list.push({ ...booking, renter_name: profilesById[booking.renter_id] || 'RentMate member' })
      bookingsByItem.set(booking.item_id, list)
    })
    return listingRows.map((item) => ({ ...item, bookings: bookingsByItem.get(item.id) || [] }))
  }, [user?.id])

  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    loadListings()
      .then((data) => { if (current) setItems(data) })
      .catch((loadError) => { if (current) setError(loadError?.message && !loadError?.code ? loadError.message : friendlyError(loadError)) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [loadListings, retry])

  async function refresh() {
    const latest = await loadListings()
    setItems(latest)
  }

  async function toggleActive(item) {
    const nextActive = !item.is_active
    setBusyKey(`item:${item.id}`)
    setError('')
    try {
      const { data, error: updateError } = await supabase
        .from('items')
        .update({ is_active: nextActive })
        .eq('id', item.id)
        .eq('owner_id', user.id)
        .select('id, is_active')
        .maybeSingle()
      if (updateError) throw updateError
      if (!data) throw new Error('This listing could not be updated. Refresh and try again.')
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_active: data.is_active } : entry))
    } catch (actionError) {
      setError(actionError?.message && !actionError?.code ? actionError.message : friendlyError(actionError))
    } finally {
      setBusyKey('')
    }
  }

  async function deleteListing(item) {
    if (!window.confirm(`Delete “${item.title}”? This will also delete its bookings, and the action cannot be undone.`)) return
    setBusyKey(`item:${item.id}`)
    setError('')
    try {
      const { data, error: deleteError } = await supabase
        .from('items')
        .delete()
        .eq('id', item.id)
        .eq('owner_id', user.id)
        .select('id')
        .maybeSingle()
      if (deleteError) throw deleteError
      if (!data) throw new Error('This listing could not be deleted. Refresh and try again.')
      setItems((current) => current.filter((entry) => entry.id !== item.id))
    } catch (actionError) {
      setError(actionError?.message && !actionError?.code ? actionError.message : friendlyError(actionError))
    } finally {
      setBusyKey('')
    }
  }

  async function transitionBooking(booking, nextStatus, expectedStatus, confirmation) {
    if (busyKey || !window.confirm(confirmation)) return
    if (nextStatus === 'returned' && booking.end_date >= localDateString()) {
      setError('The return can be confirmed after the rental period has ended.')
      return
    }
    setBusyKey(`booking:${booking.id}`)
    setError('')
    try {
      const { data, error: updateError } = await supabase.from('bookings')
        .update({ status: nextStatus })
        .eq('id', booking.id)
        .eq('status', expectedStatus)
        .select('id')
        .maybeSingle()
      if (updateError) throw updateError
      if (!data) throw new Error('This booking has changed. Refresh the page and try again.')
      setItems((current) => current.map((item) => item.id !== booking.item_id ? item : {
        ...item,
        bookings: item.bookings.map((entry) => entry.id === booking.id ? { ...entry, status: nextStatus } : entry),
      }))
    } catch (actionError) {
      setError(actionError?.message && !actionError?.code ? actionError.message : friendlyError(actionError))
    } finally {
      setBusyKey('')
    }
  }

  const listingCount = useMemo(() => items.length, [items])

  return <main className="my-listings-page">
    <div className="my-listings-container">
      <header className="my-listings-heading"><span className="details-section-kicker">YOUR RENTMATE COLLECTION</span><h1>My listings<span>.</span></h1><p>Keep your shared finds in good shape and see who’s booked them.</p></header>
      {error && <p className="my-listings-error" role="alert">{error}</p>}
      {loading ? <ListingSkeleton /> : error && !items.length ? <section className="my-listings-state" role="alert"><span className="details-section-kicker">A LITTLE PAUSE</span><h2>We couldn’t load your listings.</h2><p>{error}</p><Button type="button" onClick={() => setRetry((count) => count + 1)}>Try again</Button></section>
        : !listingCount ? <section className="my-listings-state"><span className="my-listings-empty-mark" aria-hidden="true">r.</span><span className="details-section-kicker">A LITTLE ROOM TO SHARE</span><h2>Your first listing starts here.</h2><p>Add something you own and give it a second life with someone nearby.</p><Link to="/items/new" className="my-listings-add-link">Add an item <span aria-hidden="true">↗</span></Link></section>
          : <div className="my-listings-grid">{items.map((item) => <article className="my-listing-card" key={item.id}>
            <div className="my-listing-photo-wrap">{item.image_url ? <img className="my-listing-photo" src={item.image_url} alt={item.title} /> : <div className="my-listing-photo-placeholder" aria-label="No item photo available"><span aria-hidden="true">r.</span></div>}<span className={`my-listing-status ${item.is_active ? 'is-active' : 'is-inactive'}`}>{item.is_active ? 'Active' : 'Inactive'}</span></div>
            <div className="my-listing-content"><div className="my-listing-title-row"><div><span className="details-section-kicker">YOUR LISTING</span><h2>{item.title}</h2></div><p className="my-listing-price"><strong>{currency.format(Number(item.price_per_day))}</strong><span> / day</span></p></div>
              <div className="my-listing-availability"><span className="details-section-kicker">AVAILABLE RANGE</span><p>{formatDate(item.available_from)} <span aria-hidden="true">—</span> {formatDate(item.available_to)}</p></div>
            <div className="my-listing-actions"><Link to={`/items/${item.id}/edit`} className="my-listing-edit">Edit</Link><Button type="button" className="my-listing-toggle" disabled={busyKey !== ''} loading={busyKey === `item:${item.id}`} onClick={() => toggleActive(item)}>{item.is_active ? 'Set inactive' : 'Set active'}</Button><button className="my-listing-delete" type="button" disabled={busyKey !== ''} onClick={() => deleteListing(item)}>Delete</button></div>
              <details className="my-listing-bookings"><summary>Bookings & handover actions <span>{item.bookings.length}</span></summary>
                {!item.bookings.length ? <p className="my-listing-no-bookings">No bookings for this listing yet.</p> : <ul>{item.bookings.map((booking) => <li className="my-listing-booking" key={booking.id}><div className="my-listing-booking-top"><div><span className="details-section-kicker">RENTER</span><p>{booking.renter_name}</p></div><span className={`my-listing-booking-status status-${booking.status}`}>{statusLabel(booking.status)}</span></div><div className="my-listing-booking-meta"><p>{formatDate(booking.start_date)} <span aria-hidden="true">—</span> {formatDate(booking.end_date)}<br />{formatTime(booking.pickup_time)} pickup · {formatTime(booking.return_time)} return</p><strong>{currency.format(Number(booking.total_price))}</strong></div><DistanceBadge distanceKm={booking.distance_km} driveMinutes={booking.drive_minutes} /><Link className="booking-list-detail-link" to={`/bookings/${booking.id}`}>Timing & meeting spot</Link>{item.owner_id === user.id && booking.status === 'confirmed' && <Button type="button" className="my-listing-return" disabled={busyKey !== ''} loading={busyKey === `booking:${booking.id}`} onClick={() => transitionBooking(booking, 'picked_up', 'confirmed', `Mark ${booking.renter_name}'s booking as handed over?`)}>Mark handed over</Button>}{item.owner_id === user.id && booking.status === 'return_requested' && <Button type="button" className="my-listing-return" disabled={busyKey !== '' || booking.end_date >= localDateString()} loading={busyKey === `booking:${booking.id}`} onClick={() => transitionBooking(booking, 'returned', 'return_requested', `Confirm that ${booking.renter_name} returned this item?`)}>Confirm return</Button>}{item.owner_id === user.id && booking.status === 'confirmed' && booking.start_date > localDateString() && <button type="button" className="my-listing-cancel-booking" disabled={busyKey !== ''} onClick={() => transitionBooking(booking, 'cancelled', 'confirmed', `Cancel ${booking.renter_name}'s booking for ${item.title}?`)}>Cancel booking</button>}</li>)}</ul>}
              </details>
            </div>
          </article>)}</div>}
    </div>
  </main>
}
