import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Button from '../components/ui/Button'
import SearchBar from '../components/browse/SearchBar'
import FilterBar from '../components/browse/FilterBar'
import ItemGrid from '../components/browse/ItemGrid'
import SkeletonCard from '../components/browse/SkeletonCard'
import { fetchActiveItems, fetchAllActiveItems, ITEMS_PER_PAGE } from '../lib/items'
import { distanceBetweenCoordinates, getCurrentCoordinates } from '../lib/location'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUpRight, Bike, BookOpen, Calculator, Camera, Laptop, Package, Projector, RefreshCw, SearchX, Sparkles } from 'lucide-react'
import './BrowsePage.css'

const initialFilters = { category: 'All', minPrice: '', maxPrice: '', location: '', availableFrom: '', availableTo: '', sort: 'newest' }
const validCategories = ['Cameras', 'Electronics', 'Calculators', 'Projectors', 'Bicycles', 'Books', 'Other']
const browseCategories = [
  { name: 'Cameras', icon: Camera, position: '0% 0%', alt: 'A mirrorless camera and lens on a warm wooden table.' },
  { name: 'Electronics', icon: Laptop, position: '50% 0%', alt: 'A laptop and useful electronics in a home workspace.' },
  { name: 'Calculators', icon: Calculator, position: '100% 0%', alt: 'A scientific calculator beside study notes.' },
  { name: 'Projectors', icon: Projector, position: '0% 50%', alt: 'A projector in a cozy living room.' },
  { name: 'Bicycles', icon: Bike, position: '50% 50%', alt: 'A city bicycle outdoors in golden light.' },
  { name: 'Books', icon: BookOpen, position: '100% 50%', alt: 'Books and a cup in a warm reading nook.' },
  { name: 'Other', icon: Package, position: '0% 100%', alt: 'Useful everyday objects arranged for sharing.' },
]

function categoryFromParams(params) {
  const category = params.get('category')
  return validCategories.includes(category) ? category : 'All'
}

export default function BrowsePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [filters, setFilters] = useState(() => ({ ...initialFilters, category: categoryFromParams(searchParams) }))
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const categoryInUrl = categoryFromParams(searchParams)
  const search = searchParams.get('q')?.trim() || ''
  const [items, setItems] = useState([])
  const [count, setCount] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [retryCount, setRetryCount] = useState(0)
  const [ratingSummaries, setRatingSummaries] = useState({})
  const [nearbyCoordinates, setNearbyCoordinates] = useState(null)
  const [nearbyLoading, setNearbyLoading] = useState(false)
  const [nearbyError, setNearbyError] = useState('')
  const [nearbyDataError, setNearbyDataError] = useState('')
  const [expiryError, setExpiryError] = useState('')
  const requestId = useRef(0)

  useEffect(() => {
    setFilters((current) => current.category === categoryInUrl ? current : { ...current, category: categoryInUrl })
  }, [categoryInUrl])

  const applySearch = useCallback((value) => {
    const next = new URLSearchParams(searchParams)
    const normalized = value.trim()
    if (normalized) next.set('q', normalized)
    else next.delete('q')
    if (next.toString() !== searchParams.toString()) setSearchParams(next)
  }, [searchParams, setSearchParams])

  const clearFilters = useCallback(() => {
    setFilters(initialFilters)
    setSearchParams(new URLSearchParams())
  }, [setSearchParams])

  const updateCategory = useCallback((category) => {
    const next = new URLSearchParams(searchParams)
    if (category === 'All') next.delete('category')
    else next.set('category', category)
    navigate({ pathname: '/browse', search: next.toString() ? `?${next.toString()}` : '' })
    setFilters((current) => ({ ...current, category }))
  }, [navigate, searchParams])

  useEffect(() => {
    let current = true
    if (!supabase || !user?.id) return () => { current = false }
    setExpiryError('')
    ;(async () => {
      try {
        const { error: rpcError } = await supabase.rpc('expire_pending_bookings')
        if (rpcError) throw rpcError
      } catch (rpcError) {
        if (current) setExpiryError(rpcError?.message || 'Could not refresh expired payment holds. Availability may be out of date.')
      }
    })()
    return () => { current = false }
  }, [retryCount, user?.id])

  useEffect(() => {
    const activeRequest = ++requestId.current
    setLoading(true)
    setLoadingMore(false)
    setError('')
    setNearbyDataError('')
    setItems([])
    const request = (async () => {
      const result = nearbyCoordinates
        ? await fetchAllActiveItems({ ...filters, search })
        : await fetchActiveItems({ offset: 0, limit: ITEMS_PER_PAGE, filters: { ...filters, search } })
      if (!nearbyCoordinates || !result.items.length) return result
      const { data: locations, error: locationError } = await supabase.rpc('get_item_approximate_locations', { p_item_ids: result.items.map((item) => item.id) })
      if (locationError) {
        setNearbyDataError(`Could not load approximate item locations, so distance sorting is unavailable. ${locationError.message || 'Please retry.'}`)
        return result
      }
      const locationByItemId = Object.fromEntries((locations || []).map((location) => [location.item_id, location]))
      return { ...result, items: result.items.map((item) => ({ ...item, ...(locationByItemId[item.id] || {}) })) }
    })()
    request
      .then((result) => {
        if (requestId.current !== activeRequest) return
        setItems(result.items)
        setCount(result.count)
        setHasMore(result.hasMore)
      })
      .catch((fetchError) => {
        if (requestId.current === activeRequest) setError(fetchError?.message || 'We could not load listings right now.')
      })
      .finally(() => {
        if (requestId.current === activeRequest) setLoading(false)
      })
    return () => { if (requestId.current === activeRequest) requestId.current += 1 }
  }, [filters, search, retryCount, nearbyCoordinates])

  useEffect(() => {
    let current = true
    const itemIds = items.map((item) => item.id)
    if (!supabase || !itemIds.length) {
      setRatingSummaries({})
      return () => { current = false }
    }
    supabase.from('item_rating_summary').select('item_id, average_rating, review_count').in('item_id', itemIds)
      .then(({ data, error: summaryError }) => {
        if (current) setRatingSummaries(summaryError ? {} : Object.fromEntries((data || []).map((entry) => [entry.item_id, entry])))
      })
      .catch(() => { if (current) setRatingSummaries({}) })
    return () => { current = false }
  }, [items])

  async function loadMore() {
    const activeRequest = requestId.current
    setLoadingMore(true)
    setError('')
    try {
      const result = await fetchActiveItems({ offset: items.length, limit: ITEMS_PER_PAGE, filters: { ...filters, search } })
      if (requestId.current !== activeRequest) return
      setItems((current) => [...current, ...result.items])
      setCount(result.count)
      setHasMore(result.hasMore)
    } catch (fetchError) {
      if (requestId.current === activeRequest) setError(fetchError?.message || 'We could not load more listings right now.')
    } finally {
      if (requestId.current === activeRequest) setLoadingMore(false)
    }
  }

  async function toggleNearby() {
    setNearbyError('')
    setNearbyDataError('')
    if (nearbyCoordinates) {
      setNearbyCoordinates(null)
      return
    }
    setNearbyLoading(true)
    try {
      setNearbyCoordinates(await getCurrentCoordinates())
    } catch (locationError) {
      setNearbyError(locationError.message)
    } finally {
      setNearbyLoading(false)
    }
  }

  const displayedItems = useMemo(() => {
    if (!nearbyCoordinates) return items
    return [...items].sort((first, second) => {
      const firstHasLocation = first.latitude != null && first.longitude != null
      const secondHasLocation = second.latitude != null && second.longitude != null
      if (!firstHasLocation && !secondHasLocation) return 0
      if (!firstHasLocation) return 1
      if (!secondHasLocation) return -1
      return distanceBetweenCoordinates(nearbyCoordinates, first) - distanceBetweenCoordinates(nearbyCoordinates, second)
    })
  }, [items, nearbyCoordinates])

  const loadedCategoryCounts = useMemo(() => items.reduce((result, item) => {
    result[item.category] = (result[item.category] || 0) + 1
    return result
  }, {}), [items])

  const hasFilters = Boolean(search || filters.category !== 'All' || filters.minPrice || filters.maxPrice || filters.location || filters.availableFrom || filters.availableTo || filters.sort !== 'newest')

  return (
    <main className="browse-page">
      <div className="browse-container">
        <section className="browse-hero" aria-labelledby="browse-heading">
          <div className="browse-hero-copy"><span className="eyebrow browse-eyebrow"><span className="eyebrow-dot" /> THE NEIGHBORHOOD MARKETPLACE</span><h1 id="browse-heading">Find something worth <em>borrowing.</em></h1><p>Good things are closer than you think. Discover useful finds shared by people nearby.</p><Sparkles className="browse-hero-sparkle" aria-hidden="true" /></div>
          <SearchBar value={search} onSearch={applySearch} />
          <div className="nearby-controls"><button className="nearby-button" type="button" onClick={toggleNearby} disabled={nearbyLoading}>{nearbyLoading ? 'Finding you…' : nearbyCoordinates ? 'Clear nearby' : 'Near me'}</button>{nearbyCoordinates && !nearbyDataError && <span className="nearby-status" role="status">Sorted by distance</span>}{nearbyError && <span className="nearby-status" role="alert">{nearbyError}</span>}{nearbyDataError && <><span className="nearby-status" role="alert">{nearbyDataError}</span><button className="nearby-button" type="button" onClick={() => setNearbyCoordinates((coordinates) => coordinates ? { ...coordinates } : coordinates)}>Retry nearby</button></>}</div>
          {expiryError && <div className="browse-rpc-warning" role="alert"><span>Payment hold refresh failed: {expiryError}</span><Button type="button" onClick={() => setRetryCount((current) => current + 1)}>Retry</Button></div>}
          <div className="browse-hero-foot"><span>Thoughtfully shared, right around the corner.</span><span className="browse-hero-mark" aria-hidden="true">r.</span></div>
        </section>

        <section className="browse-categories" aria-labelledby="browse-categories-heading">
          <div className="browse-categories-heading"><div><span className="browse-section-kicker">A GOOD PLACE TO START</span><h2 id="browse-categories-heading">Find your kind of <em>useful.</em></h2></div><span className="browse-categories-note"><span aria-hidden="true">↘</span> Choose a shelf to explore</span></div>
          <div className="browse-category-grid">{browseCategories.map(({ name, icon: Icon, position, alt }, index) => <button className={`browse-category-card browse-category-card-${index + 1}${categoryInUrl === name ? ' is-selected' : ''}`} type="button" key={name} aria-pressed={categoryInUrl === name} onClick={() => updateCategory(name)} style={{ '--category-photo-position': position }}><span className="browse-category-photo" role="img" aria-label={alt} /><span className="browse-category-copy"><span className="browse-category-name"><Icon aria-hidden="true" />{name}</span><span className="browse-category-count">{loading ? 'Loading' : `${loadedCategoryCounts[name] || 0} shown`}</span></span><span className="browse-category-arrow" aria-hidden="true"><ArrowUpRight /></span></button>)}</div>
        </section>

        <div className="browse-content-grid">
          <aside id="browse-filter-sidebar" className={`browse-filter-sidebar${mobileFiltersOpen ? ' is-open' : ''}`} aria-label="Listing filters">
            <FilterBar filters={filters} onChange={setFilters} onCategoryChange={updateCategory} onClear={clearFilters} />
          </aside>
          <div className="browse-results-column">
            <button type="button" className="browse-mobile-filter-toggle" aria-expanded={mobileFiltersOpen} aria-controls="browse-filter-sidebar" onClick={() => setMobileFiltersOpen((open) => !open)}>{mobileFiltersOpen ? 'Hide filters' : 'Filters'} <span aria-hidden="true">{mobileFiltersOpen ? '−' : '+'}</span></button>
        <section className="browse-results" aria-labelledby="results-heading" aria-live="polite">
          <div className="results-heading-row"><div><span className="results-kicker">{filters.sort === 'newest' ? 'RECENTLY ADDED' : 'THE COMMUNITY SHELF'}</span><h2 id="results-heading">{filters.sort === 'newest' ? 'Fresh finds near you.' : 'Find something useful.'}</h2></div>{!loading && !error && <span className="results-count">{search ? `${count ?? items.length} items found for '${search}'` : `${count ?? items.length} ${(count ?? items.length) === 1 ? 'listing' : 'listings'}`}</span>}</div>
          {error ? <div className="browse-state browse-error-state" role="alert"><div className="state-icon state-error-icon"><RefreshCw /></div><h3>We could not load listings.</h3><p>{error}</p><Button type="button" onClick={() => setRetryCount((current) => current + 1)} className="browse-state-button">Try again <RefreshCw /></Button></div>
            : loading ? <div className="item-grid" aria-label="Loading listings">{Array.from({ length: 12 }, (_, index) => <SkeletonCard key={index} />)}</div>
              : displayedItems.length === 0 ? <div className="browse-state browse-empty-state"><div className="state-icon"><SearchX /></div><h3>{hasFilters ? 'Nothing matches those filters yet.' : 'The marketplace is ready for its first listing.'}</h3><p>{hasFilters ? 'Try widening your dates, changing the price range, or clearing your filters.' : 'Check back soon, or share something of your own with the community.'}</p><Button type="button" className="browse-state-button" onClick={clearFilters} disabled={!hasFilters}>Clear filters</Button></div>
                : <><ItemGrid items={displayedItems} userId={user?.id} ratingSummaries={ratingSummaries} nearbyCoordinates={nearbyCoordinates} />{hasMore && !nearbyCoordinates && <div className="load-more-wrap"><Button type="button" className="load-more-button" loading={loadingMore} onClick={loadMore}>Load more listings <span aria-hidden="true"><ArrowDown /></span></Button></div>}</>}
        </section>
          </div>
        </div>
      </div>
    </main>
  )
}
