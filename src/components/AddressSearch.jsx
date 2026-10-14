import { SearchBox } from '@mapbox/search-js-react'
import { useEffect, useState } from 'react'
import { getCurrentCoordinates } from '../lib/location'
import './MapboxLocation.css'

const token = import.meta.env.VITE_MAPBOX_TOKEN

export default function AddressSearch({ value = '', onChange, onSelect, placeholder = 'Search an address or nearby landmark', label = 'Address', country = 'IN' }) {
  const [searchValue, setSearchValue] = useState(value)
  const [locationError, setLocationError] = useState('')
  const [locating, setLocating] = useState(false)

  useEffect(() => { setSearchValue(value) }, [value])

  function choose(address, latitude, longitude) {
    setSearchValue(address)
    onChange?.(address)
    onSelect?.({ address, latitude, longitude })
  }

  async function useCurrentLocation() {
    setLocationError('')
    setLocating(true)
    try {
      const coordinates = await getCurrentCoordinates()
      const address = `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}`
      try {
        if (token) {
          const response = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${coordinates.longitude},${coordinates.latitude}.json?limit=1&access_token=${encodeURIComponent(token)}`)
          if (response.ok) {
            const data = await response.json()
            choose(data.features?.[0]?.place_name || address, coordinates.latitude, coordinates.longitude)
          } else choose(address, coordinates.latitude, coordinates.longitude)
        } else choose(address, coordinates.latitude, coordinates.longitude)
      } catch { choose(address, coordinates.latitude, coordinates.longitude) }
    } catch (error) { setLocationError(error.message) }
    finally { setLocating(false) }
  }

  function retrieve(result) {
    const feature = result?.features?.[0]
    const coordinates = feature?.geometry?.coordinates || feature?.properties?.coordinates
    if (!feature || !coordinates) return
    const address = feature.properties?.full_address || feature.properties?.name || feature.place_name || searchValue
    const longitude = Array.isArray(coordinates) ? coordinates[0] : coordinates.longitude
    const latitude = Array.isArray(coordinates) ? coordinates[1] : coordinates.latitude
    if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) return
    choose(address, Number(latitude), Number(longitude))
  }

  return <div className="address-search-field">
    <label className="address-search-label">{label}</label>
    {token ? <SearchBox accessToken={token} value={searchValue} onChange={(next) => { setSearchValue(next); onChange?.(next) }} onRetrieve={retrieve} options={{ country, language: 'en', limit: 5 }} placeholder={placeholder} aria-label={label} /> : <input className="address-search-fallback" value={searchValue} onChange={(event) => { setSearchValue(event.target.value); onChange?.(event.target.value) }} placeholder={placeholder} autoComplete="street-address" aria-label={label} />}
    <button type="button" className="address-current-button" onClick={useCurrentLocation} disabled={locating}>{locating ? 'Finding location…' : 'Use my current location'}</button>
    {locationError && <p className="location-map-error" role="alert">{locationError}</p>}
  </div>
}
