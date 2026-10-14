import { Link } from 'react-router-dom'

export default function BookingsPlaceholderPage() {
  return <main className="bookings-placeholder-page"><section className="bookings-placeholder-card">
    <span className="details-section-kicker">YOUR RENTMATE JOURNEY</span>
    <span className="bookings-placeholder-icon" aria-hidden="true">✓</span>
    <h1 id="bookings-placeholder-heading">Your bookings</h1>
    <p>Your booking was saved. The My Bookings page is coming next, and this is where you’ll be able to keep track of every rental.</p>
    <Link to="/" className="details-primary-link">Back to Browse</Link>
  </section></main>
}
