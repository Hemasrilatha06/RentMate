import StarRating from './StarRating'
import './ItemReviews.css'

function formatReviewDate(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

export default function ItemReviews({ reviews = [], summary = null, loading = false, error = '' }) {
  const count = Number(summary?.review_count || 0)
  const average = Number(summary?.average_rating || 0)
  return <section className="item-reviews" aria-labelledby="item-reviews-heading">
    <div className="item-reviews-heading"><div><span className="details-section-kicker">COMMUNITY NOTES</span><h2 id="item-reviews-heading">Ratings &amp; reviews</h2></div>{count > 0 && <div className="item-reviews-summary"><StarRating rating={average} size="small" /><strong>{average.toFixed(1)}</strong><span>{count} {count === 1 ? 'review' : 'reviews'}</span></div>}</div>
    {loading ? <p className="item-reviews-message" role="status">Loading reviews…</p>
      : error ? <p className="item-reviews-message" role="alert">Reviews are temporarily unavailable. Please try again later.</p>
        : !reviews.length ? <div className="item-reviews-empty"><span aria-hidden="true">✧</span><p>No reviews yet. Be the first to share your experience after a rental.</p></div>
          : <ul className="item-reviews-list">{reviews.map((review) => <li className="item-review" key={review.id}><div className="item-review-top"><div className="item-review-person"><span className="item-review-avatar" aria-hidden="true">{review.reviewer_name?.charAt(0)?.toLocaleUpperCase('en-IN') || 'R'}</span><div><strong>{review.reviewer_name || 'RentMate member'}</strong><time dateTime={review.created_at}>{formatReviewDate(review.created_at)}</time></div></div><StarRating rating={review.rating} size="small" /></div>{review.comment && <p className="item-review-comment">{review.comment}</p>}</li>)}</ul>}
  </section>
}
