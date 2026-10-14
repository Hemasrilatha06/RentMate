import Input from '../ui/Input'
import Button from '../ui/Button'

const categories = ['All', 'Cameras', 'Electronics', 'Calculators', 'Projectors', 'Bicycles', 'Books', 'Other']

export default function FilterBar({ filters, onChange, onCategoryChange, onClear }) {
  function update(name, value) { onChange((current) => ({ ...current, [name]: value })) }
  return (
    <section className="browse-filter-panel" aria-label="Filter listings">
      <div className="category-filter-row"><span className="filter-label">Category</span><div className="category-chips" role="group" aria-label="Filter by category">{categories.map((category) => <button key={category} type="button" className={`category-chip${filters.category === category ? ' is-selected' : ''}`} aria-pressed={filters.category === category} onClick={() => onCategoryChange ? onCategoryChange(category) : update('category', category)}>{category}</button>)}</div>{filters.category !== 'All' && <button type="button" className="category-chip category-clear-button" onClick={() => onCategoryChange ? onCategoryChange('All') : update('category', 'All')}>Clear category</button>}</div>
      <div className="filter-control-grid">
        <div className="filter-group price-filter-group"><span className="filter-label">Price per day</span><div className="filter-pair"><Input id="browse-min-price" label="Minimum price" type="number" min="0" step="1" value={filters.minPrice} onChange={(event) => update('minPrice', event.target.value)} placeholder="Min" /><span className="filter-pair-divider" aria-hidden="true">to</span><Input id="browse-max-price" label="Maximum price" type="number" min="0" step="1" value={filters.maxPrice} onChange={(event) => update('maxPrice', event.target.value)} placeholder="Max" /></div></div>
        <div className="filter-group"><Input id="browse-location" label="Location" value={filters.location} onChange={(event) => update('location', event.target.value)} placeholder="City or area" autoComplete="off" /></div>
        <div className="filter-group date-filter-group"><span className="filter-label">Available between</span><div className="filter-pair"><Input id="browse-date-start" label="Start date" type="date" value={filters.availableFrom} onChange={(event) => update('availableFrom', event.target.value)} /><span className="filter-pair-divider" aria-hidden="true">and</span><Input id="browse-date-end" label="End date" type="date" min={filters.availableFrom || undefined} value={filters.availableTo} onChange={(event) => update('availableTo', event.target.value)} /></div></div>
        <div className="filter-group sort-filter-group"><label className="filter-label" htmlFor="browse-sort">Sort by</label><div className="browse-sort-wrap"><select id="browse-sort" value={filters.sort} onChange={(event) => update('sort', event.target.value)}><option value="newest">Newest</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option></select><span className="browse-sort-chevron" aria-hidden="true" /></div></div>
        <Button type="button" className="browse-clear-button" onClick={onClear}>Clear filters</Button>
      </div>
    </section>
  )
}
