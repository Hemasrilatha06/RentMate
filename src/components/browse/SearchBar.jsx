import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'

export default function SearchBar({ value = '', onSearch }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    const timer = window.setTimeout(() => onSearch(draft.trim()), 320)
    return () => window.clearTimeout(timer)
  }, [draft, onSearch])

  function submit(event) {
    event.preventDefault()
    onSearch(draft.trim())
  }

  return <form className="browse-search" role="search" aria-label="Search listings" onSubmit={submit}><Search aria-hidden="true" focusable="false" /><label className="visually-hidden" htmlFor="browse-search-input">Search items by title, description, category, or location</label><input id="browse-search-input" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Try film camera or weekend projector..." autoComplete="off" />{draft && <button type="button" className="search-clear" onClick={() => { setDraft(''); onSearch('') }} aria-label="Clear search"><X aria-hidden="true" /></button>}<button type="submit" className="search-submit">Search</button></form>
}
