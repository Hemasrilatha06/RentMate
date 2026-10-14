import './StarRating.css'
import { Star as StarIcon } from 'lucide-react'

function Star({ value, rating, className = '' }) {
  const fill = Math.max(0, Math.min(1, rating - value + 1))
  return <span className={`star-rating-star ${className}`} aria-hidden="true">
    <StarIcon className="star-rating-empty" focusable="false" />
    <span className="star-rating-fill" style={{ width: `${fill * 100}%` }}><StarIcon focusable="false" /></span>
  </span>
}

export default function StarRating({ rating = 0, mode = 'display', onChange, label = 'Rating', size = 'normal' }) {
  const safeRating = Math.max(0, Math.min(5, Number(rating) || 0))
  if (mode === 'input') {
    function handleKeyDown(event, value) {
      let nextValue = value
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextValue = Math.min(5, value + 1)
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextValue = Math.max(1, value - 1)
      else if (event.key === 'Home') nextValue = 1
      else if (event.key === 'End') nextValue = 5
      else return
      event.preventDefault()
      onChange?.(nextValue)
      event.currentTarget.parentElement?.querySelector(`[data-rating="${nextValue}"]`)?.focus()
    }

    return <div className={`star-rating star-rating-input star-rating-${size}`} role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" role="radio" aria-checked={safeRating === value} aria-label={`${value} ${value === 1 ? 'star' : 'stars'}`} data-rating={value} tabIndex={safeRating === value || (safeRating === 0 && value === 1) ? 0 : -1} className="star-rating-choice" onClick={() => onChange?.(value)} onKeyDown={(event) => handleKeyDown(event, value)}><Star value={value} rating={safeRating} /></button>)}
    </div>
  }
  const spokenRating = Number.isInteger(safeRating) ? safeRating : safeRating.toFixed(1)
  return <span className={`star-rating star-rating-display star-rating-${size}`} role="img" aria-label={`${spokenRating} out of 5 stars`}>
    {[1, 2, 3, 4, 5].map((value) => <Star key={value} value={value} rating={safeRating} />)}
  </span>
}
