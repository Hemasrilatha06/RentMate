import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowDown, ArrowRight, Bike, BookOpen, Camera, Calculator, Check, ChevronRight, Coins, Laptop, MapPin, Package, Projector, Search, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { fetchActiveItems } from '../lib/items'
import ItemGrid from '../components/browse/ItemGrid'
import ItemPhoto from '../components/ItemPhoto'
import findStepImage from '../assets/how-it-works-find.png'
import bookStepImage from '../assets/how-it-works-book.png'
import meetStepImage from '../assets/how-it-works-meet.png'
import './HomePage.css'

const categories = [
  { name: 'Cameras', icon: Camera },
  { name: 'Electronics', icon: Laptop },
  { name: 'Calculators', icon: Calculator },
  { name: 'Projectors', icon: Projector },
  { name: 'Bicycles', icon: Bike },
  { name: 'Books', icon: BookOpen },
  { name: 'Other', icon: Package },
]

const renterSteps = [
  { number: '01', title: 'Find', text: 'Search nearby listings and choose what fits your plans.', icon: Search, image: findStepImage, imageAlt: 'A curated selection of cameras, a laptop, a projector, books, and a bicycle.' },
  { number: '02', title: 'Book', text: 'Choose dates, agree on the details, and pay securely.', icon: Check, image: bookStepImage, imageAlt: 'A person confirming a camera rental on a phone.' },
  { number: '03', title: 'Meet and return', text: 'Meet at your agreed spot, then return it on time.', icon: MapPin, image: meetStepImage, imageAlt: 'Two people warmly handing a camera to each other.' },
]

const ownerSteps = [
  { number: '01', title: 'List', text: 'Add a few details and photos of something you can share.', icon: Package, image: findStepImage, imageAlt: 'A collection of useful items ready to be shared with nearby renters.' },
  { number: '02', title: 'Approve and hand over', text: 'Coordinate with the renter and hand it over at the agreed spot.', icon: Users, image: meetStepImage, imageAlt: 'Two people meeting to hand over a camera rental.' },
  { number: '03', title: 'Earn', text: 'Earn from things that spend more time on a shelf than in use.', icon: Coins, image: bookStepImage, imageAlt: 'A camera rental booking confirmed on a phone.' },
]

const benefits = [
  { title: 'Spend less', text: 'Borrow a useful item for the time you need it, without buying it outright.', icon: Coins },
  { title: 'Earn from what you own', text: 'Make underused cameras, tools, and gear work for you.', icon: Sparkles },
  { title: 'Bookings without clashes', text: 'Date checks help prevent overlapping reservations.', icon: ShieldCheck },
  { title: 'Agree on the details', text: 'Chat with the owner and choose a pickup spot together.', icon: Users },
]

function Reveal({ children, className = '', delay = 0 }) {
  const reduceMotion = useReducedMotion()
  return <motion.div className={className} initial={reduceMotion ? false : { opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.14 }} transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}>{children}</motion.div>
}

export default function HomePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const reduceMotion = useReducedMotion()
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('renters')
  const [featured, setFeatured] = useState([])
  const [categoryCounts, setCategoryCounts] = useState(null)
  const [stats, setStats] = useState(null)
  const [itemsError, setItemsError] = useState('')
  const [statsError, setStatsError] = useState('')

  useEffect(() => {
    let current = true
    fetchActiveItems({ limit: 8 }).then(({ items }) => {
      if (current) setFeatured(items)
    }).catch((error) => {
      if (current) setItemsError(error?.message || 'Featured items are temporarily unavailable.')
    })
    if (supabase) {
      supabase.from('items').select('category').eq('is_active', true).then(({ data, error }) => {
        if (current && error) setStatsError('Live category counts are unavailable right now.')
        if (current && !error) {
          const counts = (data || []).reduce((result, row) => {
            if (row.category) result[row.category] = (result[row.category] || 0) + 1
            return result
          }, {})
          setCategoryCounts(counts)
        }
      }).catch(() => { if (current) setStatsError('Live category counts are unavailable right now.') })
      supabase.rpc('get_public_marketplace_stats').then(({ data, error }) => {
        if (current && error) setStatsError('Run public_read_setup.sql to enable all live marketplace totals.')
        if (current && !error) setStats(Array.isArray(data) ? data[0] : data)
      }).catch(() => { if (current) setStatsError('Live marketplace totals are unavailable right now.') })
    }
    return () => { current = false }
  }, [])

  const steps = useMemo(() => mode === 'renters' ? renterSteps : ownerSteps, [mode])
  const activeCount = stats?.items_listed ?? (categoryCounts ? Object.values(categoryCounts).reduce((sum, count) => sum + count, 0) : null)
  const categoryCount = stats?.categories_count ?? (categoryCounts ? Object.keys(categoryCounts).length : null)
  const bookingCount = stats?.bookings_made

  function searchItems(event) {
    event.preventDefault()
    const term = query.trim()
    navigate(`/browse${term ? `?q=${encodeURIComponent(term)}` : ''}`)
  }

  return <main className="public-home">
    <section className="home-hero" aria-labelledby="home-title">
      <div className="home-hero-poster" aria-hidden="true" />
      {!reduceMotion && <video className="home-hero-video" autoPlay muted loop playsInline preload="metadata" poster="/videos/rentmate-hero-poster.jpg" aria-hidden="true" tabIndex={-1}>
        <source src="/videos/rentmate-hero.mp4" type="video/mp4" />
      </video>}
      <div className="home-hero-grid" aria-hidden="true" />
      <div className="home-hero-glow home-hero-glow-one" aria-hidden="true" />
      <div className="home-hero-glow home-hero-glow-two" aria-hidden="true" />
      <div className="home-hero-content">
        <motion.div className="home-hero-copy" initial={reduceMotion ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65 }}>
          <span className="home-eyebrow"><span /> RENT SMART. SHARE MORE.</span>
          <h1 id="home-title">Need it for a while?<br />Rent it. Own it? Earn from it.</h1>
          <p>Find what you need nearby, rent with ease, and turn the things you own into extra income.</p>
          <form className="home-search" onSubmit={searchItems} role="search" aria-label="Search rentals">
            <Search aria-hidden="true" /><input aria-label="What are you looking for?" placeholder="What are you looking for?" value={query} onChange={(event) => setQuery(event.target.value)} /><button type="submit">Search <ArrowRight size={17} /></button>
          </form>
          <div className="home-hero-actions"><Link to="/browse" className="home-button home-button-primary">Browse items <ArrowRight size={17} /></Link><Link to={user ? '/items/new' : '/register'} className="home-button home-button-secondary">List your item <Package size={17} /></Link></div>
          <div className="home-trust-chips"><span><ShieldCheck />Date-clash protection</span><span><Users />Chat with the owner</span><span><MapPin />Agreed pickup spot</span></div>
        </motion.div>
        <motion.div className="home-hero-visual" initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.12 }} aria-label="Popular items available to rent">
          <div className="hero-visual-orbit hero-visual-orbit-one" /><div className="hero-visual-orbit hero-visual-orbit-two" />
          {featured.length ? <>
            {featured.slice(0, 3).map((item, index) => <Link key={item.id} to={`/items/${item.id}`} className={`floating-item-card floating-item-card-${index + 1}`} style={{ '--float-delay': `${index * -1.4}s` }}>
              <div className="floating-item-photo"><ItemPhoto item={item} /></div><div className="floating-item-copy"><span>{item.category}</span><strong>{item.title}</strong><small>₹{Number(item.price_per_day).toLocaleString('en-IN')} <i>/ day</i></small></div><span className="floating-item-arrow"><ChevronRight /></span>
            </Link>)}
          </> : <>
            <div className="floating-item-card floating-item-card-1 placeholder-float"><span className="placeholder-float-icon"><Camera /></span><span><small>CAMERAS</small><strong>Camera available nearby</strong><em>From ₹180 / day</em></span></div>
            <div className="floating-item-card floating-item-card-2 placeholder-float"><span className="placeholder-float-icon"><Bike /></span><span><small>BICYCLES</small><strong>Bicycle available nearby</strong><em>From ₹250 / day</em></span></div>
            <div className="floating-item-card floating-item-card-3 placeholder-float"><span className="placeholder-float-icon"><Projector /></span><span><small>PROJECTORS</small><strong>Projector available nearby</strong><em>From ₹350 / day</em></span></div>
          </>}
          <div className="hero-visual-note"><span className="hero-visual-note-icon"><MapPin /></span><span><strong>Close to home</strong><small>Useful things, shared locally</small></span></div>
          <div className="hero-visual-sparkle sparkle-one">✦</div><div className="hero-visual-sparkle sparkle-two">✧</div>
        </motion.div>
      </div>
      <a className="home-scroll-cue" href="#how-it-works"><span>Explore RentMate</span><ArrowDown size={15} /></a>
    </section>

    <section className="home-stats" aria-label="RentMate marketplace statistics">
      <div className="home-stats-inner"><div><strong>{activeCount ?? '—'}</strong><span>Items listed</span></div><i /><div><strong>{categoryCount ?? '—'}</strong><span>Categories</span></div><i /><div><strong>{bookingCount ?? '—'}</strong><span>Bookings made</span></div><p>{statsError || 'Live activity from the RentMate marketplace'}</p></div>
    </section>

    <section className="home-section home-how" id="how-it-works">
      <div className="how-decorations" aria-hidden="true"><span className="how-deco how-deco-camera"><Camera /></span><span className="how-deco how-deco-laptop"><Laptop /></span><span className="how-deco how-deco-bike"><Bike /></span><span className="how-deco how-deco-books"><BookOpen /></span><span className="how-deco how-deco-projector"><Projector /></span><span className="how-deco how-deco-bag"><Package /></span><span className="how-deco how-deco-pin"><MapPin /></span><svg className="how-deco-path" viewBox="0 0 1200 180" preserveAspectRatio="none"><path d="M20 125 C210 15 340 170 505 82 S810 20 980 96 S1110 135 1180 47" /></svg></div>
      <Reveal className="home-section-heading"><span className="section-eyebrow">A SIMPLE WAY TO SHARE</span><h2>How it <em>works.</em></h2><p>Clear steps from finding an item to returning it.</p></Reveal>
      <div className="how-toggle" role="tablist" aria-label="Choose how you use RentMate"><button type="button" role="tab" id="renters-tab" aria-controls="how-steps" aria-selected={mode === 'renters'} className={mode === 'renters' ? 'is-active' : ''} onClick={() => setMode('renters')}>I want to rent</button><button type="button" role="tab" id="owners-tab" aria-controls="how-steps" aria-selected={mode === 'owners'} className={mode === 'owners' ? 'is-active' : ''} onClick={() => setMode('owners')}>I want to earn</button></div>
      <AnimatePresence mode="wait"><motion.div id="how-steps" key={mode} className="home-steps-grid" role="tabpanel" aria-labelledby={mode === 'renters' ? 'renters-tab' : 'owners-tab'} initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>{steps.map(({ number, title, text, icon: Icon, image, imageAlt }) => <article className="home-step-card" key={number}><div className="home-step-image-wrap"><img className="home-step-image" src={image} alt={imageAlt} loading="lazy" /><span className="home-step-image-number">{number}</span></div><div className="home-step-copy"><div className="home-step-top"><span>STEP {number}</span><Icon aria-hidden="true" /></div><h3>{title}</h3><p>{text}</p></div></article>)}</motion.div></AnimatePresence>
    </section>

    <section className="home-section home-categories">
      <Reveal className="home-section-heading home-section-heading-row"><div><span className="section-eyebrow">FIND WHAT YOU NEED</span><h2>Browse by category</h2><p>Everyday essentials and one-off finds, all in one place.</p></div><Link to="/browse" className="home-text-link">Explore all items <ArrowRight /></Link></Reveal>
      <div className="home-category-grid">{categories.map(({ name, icon: Icon }, index) => <Reveal key={name} delay={index * 0.035}><Link className="home-category-tile" to={`/browse?category=${encodeURIComponent(name)}`}><span className="home-category-icon"><Icon /></span><strong>{name}</strong><small>{categoryCounts?.[name] ?? 0} items</small><ArrowRight className="home-category-arrow" /></Link></Reveal>)}</div>
    </section>

    <section className="home-section home-featured">
      <Reveal className="home-section-heading home-section-heading-row"><div><span className="section-eyebrow">RECENTLY ADDED</span><h2>Featured items</h2><p>Fresh listings from people in your community.</p></div><Link to="/browse" className="home-text-link">Browse all items <ArrowRight /></Link></Reveal>
      {itemsError ? <p className="home-data-message" role="status">{itemsError}</p> : featured.length ? <ItemGrid items={featured} userId={user?.id} /> : <div className="home-featured-empty"><Package /><strong>New listings are on the way.</strong><span>Check back soon or add the first item in your area.</span></div>}
    </section>

    <section className="home-benefits">
      <div className="home-benefits-inner"><Reveal className="home-benefit-intro"><span className="section-eyebrow">BUILT FOR SHARING</span><h2>Useful by design.</h2><p>RentMate gives neighbors a simpler way to make more of what they already have.</p><Link to="/browse" className="home-button home-button-primary">Explore the marketplace <ArrowRight /></Link></Reveal><div className="home-benefit-grid">{benefits.map(({ title, text, icon: Icon }, index) => <Reveal key={title} delay={index * 0.06}><article className="home-benefit-card"><span><Icon /></span><h3>{title}</h3><p>{text}</p></article></Reveal>)}</div></div>
    </section>

    <section className="home-final-cta"><div className="home-cta-glow" /><div><span className="section-eyebrow">START WITH ONE ITEM</span><h2>Make your next rental simple.</h2><p>Find what you need or give something you own a second life.</p></div><div className="home-cta-actions"><Link to="/browse" className="home-button home-button-light">Browse items <ArrowRight /></Link><Link to={user ? '/items/new' : '/register'} className="home-button home-button-outline">List your item <Package /></Link></div></section>

    <footer className="home-footer"><div className="home-footer-main"><div className="home-footer-brand"><Link to="/" className="brand-mark"><span className="brand-icon">r</span><span>rentmate<span className="brand-period">.</span></span></Link><p>A local marketplace for useful things and the people who share them.</p></div><div className="home-footer-links"><div><strong>Marketplace</strong><Link to="/browse">Browse items</Link><Link to="/browse?category=Cameras">Cameras</Link><Link to="/browse?category=Bicycles">Bicycles</Link></div><div><strong>Get started</strong><Link to={user ? '/items/new' : '/register'}>List an item</Link><Link to="/#how-it-works">How it works</Link><Link to="/login">Log in</Link></div><div><strong>Your account</strong><Link to="/bookings">My bookings</Link><Link to="/messages">Messages</Link><Link to="/my-listings">My listings</Link></div></div></div><div className="home-footer-bottom"><span>© {new Date().getFullYear()} RentMate</span><span>Peer-to-peer rentals near you.</span></div></footer>
  </main>
}
