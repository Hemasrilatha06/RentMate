import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, MapPin } from 'lucide-react'
import StarRating from '../StarRating'
import ItemPhoto from '../ItemPhoto'
import { distanceBetweenCoordinates } from '../../lib/location'
import { supabase } from '../../lib/supabaseClient'
import { currentBookingRange, formatBookedUntil } from '../ItemAvailability'
import './reviews.css'

const priceFormatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })
const dateFormatter = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

function formatDate(value) {
  if (!value) return ''
  const [year, month, day] = value.split('-').map(Number)
  return dateFormatter.format(new Date(year, month - 1, day))
}

export default function ItemCard({ item, isOwner, ratingSummary, nearbyCoordinates }) {
  const [bookedRanges, setBookedRanges] = useState(null)
  const [availabilityError, setAvailabilityError] = useState(false)
  useEffect(() => {
    let current = true
    if (!supabase) return () => { current = false }
    supabase.rpc('get_booked_ranges', { p_item_id: item.id }).then(({ data, error }) => {
      if (current && !error) setBookedRanges(data || [])
      else if (current) setAvailabilityError(true)
    }).catch(() => { if (current) setAvailabilityError(true) })
    return () => { current = false }
  }, [item.id])
  const distance = nearbyCoordinates && item.latitude != null && item.longitude != null
    ? distanceBetweenCoordinates(nearbyCoordinates, item)
    : null
  return <Link to={`/items/${item.id}`} className="item-card-link" aria-label={`${item.title}, ${priceFormatter.format(Number(item.price_per_day))} per day`}>
    <article className="item-card">
      <div className="item-card-image-wrap"><ItemPhoto item={item} className="item-card-image" /><span className="item-category-badge">{item.category}</span>{isOwner && <span className="your-item-badge">Your item</span>}</div>
      <div className="item-card-body">
        <div className="item-card-title-row"><h3>{item.title}</h3><span className="item-card-arrow" aria-hidden="true"><ArrowUpRight /></span></div>
        <p className="item-card-location"><MapPin aria-hidden="true" />{item.location || 'Location not set'}</p>
        {distance != null && <span className="item-card-distance">{distance.toFixed(1)} km away</span>}
        {bookedRanges !== null ? <span className={`item-card-availability ${currentBookingRange(bookedRanges) ? 'is-booked' : 'is-open'}`}>{formatBookedUntil(currentBookingRange(bookedRanges))}</span> : availabilityError ? <span className="item-card-availability is-unavailable">Availability unavailable</span> : null}
        {ratingSummary?.review_count > 0 && <div className="item-card-rating"><StarRating rating={Number(ratingSummary.average_rating)} size="small" /><strong>{Number(ratingSummary.average_rating).toFixed(1)}</strong><span>({ratingSummary.review_count} {ratingSummary.review_count === 1 ? 'review' : 'reviews'})</span></div>}
        <div className="item-card-meta"><p className="item-card-price"><strong>{priceFormatter.format(Number(item.price_per_day))}</strong><span> / day</span></p><p className="item-card-dates">{formatDate(item.available_from)} - {formatDate(item.available_to)}</p></div>
      </div>
    </article>
  </Link>
}
