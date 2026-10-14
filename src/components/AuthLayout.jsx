import { Link } from 'react-router-dom'
import './AuthPages.css'
import { MapPin, ShieldCheck, WalletCards } from 'lucide-react'

function BrandMark() {
  return <Link to="/" className="brand-mark" aria-label="RentMate home"><span className="brand-icon" aria-hidden="true">r</span><span>rentmate<span className="brand-period">.</span></span></Link>
}

export default function AuthLayout({ children, mode }) {
  return (
    <main className="auth-shell auth-shell-premium">
      <aside className="brand-panel auth-brand-panel">
        <div className="panel-grain" />
        <BrandMark />
        <div className="brand-copy auth-brand-copy">
          <span className="eyebrow"><span className="eyebrow-dot" /> RENTMATE MARKETPLACE</span>
          <h1>Good things are better shared.</h1>
          <p>Find useful things nearby, or earn from items you already own.</p>
          <ul className="auth-benefit-list"><li><ShieldCheck />Protected dates and secure payments</li><li><MapPin />Pickup details agreed together</li><li><WalletCards />A simpler way to rent and earn</li></ul>
        </div>
        <div className="panel-foot"><span>RentMate</span><span>Built for local sharing</span></div>
      </aside>
      <section className="form-panel">
        <div className="mobile-brand"><BrandMark /></div>
        <div className="auth-content">
          <div className="form-kicker">{mode === 'login' ? 'ACCOUNT ACCESS' : 'CREATE YOUR ACCOUNT'}</div>
          {children}
        </div>
        <div className="form-foot"><span>© {new Date().getFullYear()} RentMate</span><span>Your details stay private.</span></div>
      </section>
    </main>
  )
}

