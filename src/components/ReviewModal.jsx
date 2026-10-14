import { useEffect, useRef, useState } from 'react'
import Button from './ui/Button'
import StarRating from './StarRating'
import './ReviewModal.css'

export default function ReviewModal({ itemTitle, onClose, onSubmit, submitting = false, error = '' }) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [validationError, setValidationError] = useState('')
  const closeRef = useRef(null)

  useEffect(() => {
    closeRef.current?.focus()
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, submitting])

  async function submit(event) {
    event.preventDefault()
    if (!rating) {
      setValidationError('Choose a star rating to continue.')
      return
    }
    setValidationError('')
    await onSubmit({ rating, comment: comment.trim() })
  }

  return <div className="review-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose() }}>
    <section className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-modal-title" aria-describedby="review-modal-description">
      <button ref={closeRef} type="button" className="review-modal-close" onClick={onClose} disabled={submitting} aria-label="Close review dialog">×</button>
      <span className="details-section-kicker">SHARE YOUR EXPERIENCE</span>
      <h2 id="review-modal-title">How was your rental?</h2>
      <p id="review-modal-description" className="review-modal-item">{itemTitle}</p>
      <form onSubmit={submit}>
        <label className="review-field-label">Your rating</label>
        <StarRating mode="input" rating={rating} onChange={(value) => { setRating(value); setValidationError('') }} label="Choose a rating from one to five stars" size="large" />
        <label className="review-field-label review-comment-label" htmlFor="review-comment">A few words <span>Optional</span></label>
        <textarea id="review-comment" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1200} rows={4} placeholder="What should other renters know?" />
        {(validationError || error) && <p className="review-modal-error" role="alert">{validationError || error}</p>}
        <div className="review-modal-actions"><Button type="button" className="review-modal-cancel" disabled={submitting} onClick={onClose}>Cancel</Button><Button type="submit" loading={submitting} disabled={!rating}>Submit review</Button></div>
      </form>
    </section>
  </div>
}
