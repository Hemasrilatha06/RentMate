import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import AvailabilityCalendar, { dateFromKey, dateKey } from './AvailabilityCalendar'

function formatDate(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(dateFromKey(value))
}

function nextAvailableDate(item, ranges, today) {
  let candidate = item.available_from > today ? item.available_from : today
  while (candidate <= item.available_to) {
    const overlapping = ranges.find((range) => candidate >= range.start_date && candidate <= range.end_date)
    if (!overlapping) return candidate
    const end = dateFromKey(overlapping.end_date)
    end.setDate(end.getDate() + 1)
    candidate = dateKey(end)
  }
  return null
}

export function currentBookingRange(ranges, today = dateKey(new Date())) {
  return ranges.find((range) => today >= range.start_date && today <= range.end_date) || null
}

export function formatBookedUntil(range) {
  if (!range) return 'Available now'
  const day = formatDate(range.end_date)
  if (!range.return_time) return `Booked until ${day}`
  const [hours, minutes] = range.return_time.split(':').map(Number)
  const time = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, hours, minutes))
  return `Booked until ${day}, ${time}`
}

export default function ItemAvailability({ item }) {
  const { user } = useAuth()
  const [ranges, setRanges] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    async function loadRanges() {
      setLoading(true)
      setError('')
      if (!supabase) {
        setError('Availability could not be checked.')
        setLoading(false)
        return
      }
      try {
        if (user?.id) {
          const { error: expiryError } = await supabase.rpc('expire_pending_bookings')
          if (expiryError) throw expiryError
        }
        const { data, error: rangesError } = await supabase.rpc('get_booked_ranges', { p_item_id: item.id })
        if (rangesError) throw rangesError
        if (current) setRanges(data || [])
      } catch (loadError) {
        if (current) setError(loadError?.message || 'Availability could not be checked.')
      } finally {
        if (current) setLoading(false)
      }
    }
    loadRanges()
    return () => { current = false }
  }, [item.id, user?.id])

  const today = dateKey(new Date())
  const currentRange = currentBookingRange(ranges, today)
  const upcomingRanges = ranges.filter((range) => range.end_date >= today)
  const nextDate = nextAvailableDate(item, ranges, today)

  return <section className="item-availability-section" aria-labelledby="item-availability-heading">
    <div className="item-availability-heading-row"><div><span className="details-section-kicker">PLAN AHEAD</span><h2 id="item-availability-heading">Availability</h2></div><span className={`item-availability-badge ${loading ? 'is-loading' : error ? 'is-unavailable' : currentRange ? 'is-booked' : 'is-open'}`} role="status">{loading ? 'Checking availability…' : error ? 'Availability unavailable' : formatBookedUntil(currentRange)}</span></div>
    {loading ? <p className="availability-status" role="status">Loading the calendar…</p> : error ? <p className="availability-error" role="alert">We could not load booked dates. {error}</p> : <>
      <AvailabilityCalendar item={item} bookedRanges={ranges} />
      <div className="upcoming-booked-ranges">
        <h3>Upcoming booked dates</h3>
        {upcomingRanges.length ? upcomingRanges.map((range) => <p key={`${range.start_date}-${range.end_date}`}><strong>Booked:</strong> {formatDate(range.start_date)} to {formatDate(range.end_date)}</p>) : <p>No upcoming bookings yet.</p>}
      </div>
      <p className="next-available-line">{nextDate ? <>Next available from <strong>{new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).format(dateFromKey(nextDate))}</strong></> : 'No upcoming dates are available.'}</p>
    </>}
  </section>
}
