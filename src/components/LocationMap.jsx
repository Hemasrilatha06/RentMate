import { useState } from 'react'
import { getCurrentCoordinates } from '../lib/location'
import MapView from './MapView'
import './LocationMap.css'

export default function LocationMap({
  latitude,
  longitude,
  onChange,
  readOnly = false,
  showGeolocation = false,
  height = 230,
  zoom = 14,
  label = 'Map location',
}) {
  const [error, setError] = useState('')
  async function locate() {
    try { onChange?.(await getCurrentCoordinates()); setError('') }
    catch (locationError) { setError(`${locationError.message} You can still search for an address and move the pin.`) }
  }
  return <div className="location-map-field">
    {showGeolocation && <button className="location-map-geolocate" type="button" onClick={locate}>Use my current location</button>}
    <p className="location-map-help">{readOnly ? 'Approximate area only' : 'Search an address first, then drag the pin to fine-tune it.'}</p>
    <MapView latitude={latitude} longitude={longitude} onChange={onChange} readOnly={readOnly} height={height} zoom={zoom} label={label} />
    {error && <p className="location-map-error" role="alert">{error}</p>}
  </div>
}
