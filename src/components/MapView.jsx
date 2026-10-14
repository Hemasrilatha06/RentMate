import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import './MapboxLocation.css'

const token = import.meta.env.VITE_MAPBOX_TOKEN
const fallbackCenter = [79.8612, 6.9271]

function point(longitude, latitude) {
  const lng = Number(longitude)
  const lat = Number(latitude)
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90 ? [lng, lat] : null
}

function hasValidRouteGeometry(coordinates) {
  return Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.every((coordinate) => (
    Array.isArray(coordinate)
    && coordinate.length >= 2
    && Number.isFinite(Number(coordinate[0]))
    && Number.isFinite(Number(coordinate[1]))
    && Number(coordinate[0]) >= -180 && Number(coordinate[0]) <= 180
    && Number(coordinate[1]) >= -90 && Number(coordinate[1]) <= 90
  ))
}

function safeMapDiagnostic(error) {
  const message = String(error?.message || error || 'Unknown Mapbox error')
    .replace(/([?&]access_token=)[^&\s"''<>]+/gi, '$1[redacted]')
    .replace(/\b(?:pk|sk)\.[A-Za-z0-9._-]+/g, '[redacted Mapbox token]')
  return { name: error?.name || 'Error', message, status: Number(error?.status) || undefined }
}
export default function MapView({
  latitude, longitude, onChange, readOnly = false, height = 240, zoom = 13,
  label = 'Map', markers = [], routeCoordinates = null, distanceKm = null, driveMinutes = null,
  routeMap = false, roadRouteAvailable = null, rotationEnabled = false, onError,
}) {
  const container = useRef(null)
  const mapRef = useRef(null)
  const markerRefs = useRef([])
  const [mapError, setMapError] = useState("")
  const mainPoint = point(longitude, latitude)
  const center = mainPoint || point(markers[0]?.longitude, markers[0]?.latitude) || fallbackCenter
  const prominentMap = routeMap || (Boolean(onChange) && height <= 220)
  const hasRouteSummary = routeMap
  const renterMarker = markers.find((marker) => /renter/i.test(marker.label || ''))
  const pickupMarker = markers.find((marker) => /owner pickup|item|pickup/i.test(marker.label || ''))
  const validRouteGeometry = hasValidRouteGeometry(routeCoordinates)
  const originLabel = renterMarker?.label || 'Renter location'
  const destinationLabel = pickupMarker?.label || 'Owner pickup'

  function applyRoute(map, coordinates, isRoadRoute) {
    if (!map.isStyleLoaded()) return
    if (!hasValidRouteGeometry(coordinates)) {
      if (map.getLayer('rentmate-route-line')) map.removeLayer('rentmate-route-line')
      if (map.getLayer('rentmate-route-casing')) map.removeLayer('rentmate-route-casing')
      if (map.getLayer('rentmate-route-glow')) map.removeLayer('rentmate-route-glow')
      if (map.getSource('rentmate-route')) map.removeSource('rentmate-route')
      return
    }
    const data = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }
    const source = map.getSource('rentmate-route')
    if (source) source.setData(data)
    else map.addSource('rentmate-route', { type: 'geojson', data })
    if (!map.getLayer('rentmate-route-glow')) {
      map.addLayer({ id: 'rentmate-route-glow', type: 'line', source: 'rentmate-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#4b9381', 'line-width': 15, 'line-opacity': 0.2, 'line-blur': 5 } })
    }
    if (!map.getLayer('rentmate-route-casing')) {
      map.addLayer({ id: 'rentmate-route-casing', type: 'line', source: 'rentmate-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fffdf8', 'line-width': 11, 'line-opacity': 0.96 } })
    }
    if (!map.getLayer('rentmate-route-line')) {
      map.addLayer({ id: 'rentmate-route-line', type: 'line', source: 'rentmate-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#368875', 'line-width': 7, 'line-opacity': 1, ...(isRoadRoute === false ? { 'line-dasharray': [2, 2] } : {}) } })
    } else {
      map.setPaintProperty('rentmate-route-line', 'line-width', 7)
      map.setPaintProperty('rentmate-route-line', 'line-opacity', 1)
      map.setPaintProperty('rentmate-route-line', 'line-dasharray', isRoadRoute === false ? [2, 2] : null)
    }
  }

  useEffect(() => {
    if (!token || !container.current || mapRef.current) return undefined
    let map
    let resizeObserver
    let resizeMap
    try {
      mapboxgl.accessToken = token
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      map = new mapboxgl.Map({ container: container.current, style: 'mapbox://styles/mapbox/light-v11', center, zoom, attributionControl: true, ...(rotationEnabled ? { projection: 'globe', pitch: 24, bearing: 0, maxPitch: 50, dragRotate: true, pitchWithRotate: true } : {}) })
      mapRef.current = map
      map.addControl(new mapboxgl.NavigationControl({ showZoom: true, showCompass: rotationEnabled }), 'top-right')
      map.on('error', (event) => {
        const diagnostic = safeMapDiagnostic(event?.error)
        console.warn('[RentMate map] Mapbox runtime error', diagnostic)
        const detail = diagnostic.message.toLowerCase()
        const message = diagnostic.status === 401 || diagnostic.status === 403
          ? 'Mapbox rejected the access token. Check that VITE_MAPBOX_TOKEN is valid and has map style access, then restart Vite.'
          : /style|sprite|glyph/.test(detail)
            ? 'Mapbox could not load its map style resources. Check the browser network panel and Mapbox token configuration.'
            : 'Mapbox reported a resource error. The map remains available; check the browser console for sanitized details.'
        if (diagnostic.status === 401 || diagnostic.status === 403 || /style|sprite|glyph/.test(detail)) {
          setMapError(message)
          onError?.(message)
        }
      })
      resizeMap = () => map.resize()
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(resizeMap)
        resizeObserver.observe(container.current)
      } else {
        window.addEventListener('resize', resizeMap)
      }
      map.on('load', () => map.resize())
    } catch {
      resizeObserver?.disconnect()
      if (resizeMap && !resizeObserver) window.removeEventListener('resize', resizeMap)
      map?.remove()
      mapRef.current = null
      const message = 'Mapbox could not initialize the map. Check the browser console for details and verify the token and allowed URLs.'
      setMapError(message)
      onError?.(message)
      return undefined
    }
    return () => {
      markerRefs.current.forEach((marker) => marker.remove())
      markerRefs.current = []
      resizeObserver?.disconnect()
      if (resizeMap && !resizeObserver) window.removeEventListener('resize', resizeMap)
      map.remove()
      mapRef.current = null
    }
  // Map construction is intentionally one-time; live data is applied below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, rotationEnabled])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const handleMapClick = (event) => {
      if (readOnly || typeof onChange !== 'function') return
      onChange({ latitude: event.lngLat.lat, longitude: event.lngLat.lng })
    }
    map.on('click', handleMapClick)
    const update = () => {
      if (mapRef.current !== map || !container.current || !map.isStyleLoaded()) return
      try {
        applyRoute(map, routeCoordinates, roadRouteAvailable)
        markerRefs.current.forEach((marker) => marker.remove())
        markerRefs.current = []
        const entries = markers.length ? markers : (mainPoint ? [{ latitude, longitude, label, draggable: !readOnly }] : [])
        for (const entry of entries) {
          const coordinates = point(entry.longitude, entry.latitude)
          if (!coordinates) continue
          const element = document.createElement('span')
          const markerLabel = entry.label || label
          const markerKind = /renter/i.test(markerLabel) ? 'mapbox-pin--renter' : /meeting/i.test(markerLabel) ? 'mapbox-pin--meeting' : /item|pickup/i.test(markerLabel) ? 'mapbox-pin--item' : ''
          element.className = `mapbox-pin ${markerKind}`
          element.setAttribute('aria-label', markerLabel)
          const marker = new mapboxgl.Marker({ element, draggable: Boolean(entry.draggable && !readOnly), color: entry.color || '#5B321B' })
            .setLngLat(coordinates).addTo(map)
          if (entry.draggable && !readOnly) marker.on('dragend', () => {
            const lngLat = marker.getLngLat()
            ;(entry.onChange || onChange)?.({ latitude: lngLat.lat, longitude: lngLat.lng })
          })
          markerRefs.current.push(marker)
        }
        if (markers.length > 0 || validRouteGeometry) {
          const bounds = new mapboxgl.LngLatBounds()
          markers.forEach((entry) => { const coordinates = point(entry.longitude, entry.latitude); if (coordinates) bounds.extend(coordinates) })
          if (validRouteGeometry) routeCoordinates.forEach((coordinates) => bounds.extend(coordinates))
          if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 })
        } else if (mainPoint) {
          const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
          map.easeTo({ center: mainPoint, zoom, duration: rotationEnabled ? (reduceMotion ? 0 : 450) : 250 })
        }
      } catch (error) {
        const diagnostic = safeMapDiagnostic(error)
        console.warn('[RentMate map] Map update failed', diagnostic)
        const message = diagnostic.name === 'ReferenceError'
          ? 'The map update encountered a JavaScript error. Reload the page and check the browser console for sanitized details.'
          : 'Mapbox could not update the map. Check the browser console for sanitized details.'
        setMapError(message)
        onError?.(message)
      }
    }
    map.on('style.load', update)
    map.on('load', update)
    if (map.isStyleLoaded()) update()
    return () => {
      map.off('click', handleMapClick)
      map.off('style.load', update)
      map.off('load', update)
    }
  }, [latitude, longitude, label, markers, mainPoint?.[0], mainPoint?.[1], onChange, readOnly, routeCoordinates, roadRouteAvailable, validRouteGeometry, zoom])

  if (!token) return <div className="mapbox-unconfigured" role="status">Add VITE_MAPBOX_TOKEN to your local .env to display the map.</div>
  if (mapError) return <div className="mapbox-unconfigured" role="alert">{mapError}</div>
  return <div className={`mapbox-map-shell${prominentMap ? ' is-prominent-map' : ''}`}>
    {hasRouteSummary && <div className="mapbox-route-summary" aria-label="Route information">
      <div className="mapbox-route-endpoint"><span className="mapbox-route-dot mapbox-route-dot-origin" aria-hidden="true" /><span><small>FROM</small><strong>{originLabel}</strong></span></div>
      <span className="mapbox-route-connector" aria-hidden="true" />
      <div className="mapbox-route-endpoint"><span className="mapbox-route-dot mapbox-route-dot-destination" aria-hidden="true" /><span><small>TO</small><strong>{destinationLabel}</strong></span></div>
      {roadRouteAvailable === true && validRouteGeometry && (distanceKm != null || driveMinutes != null) && <div className="mapbox-route-metrics">
        {distanceKm != null && Number.isFinite(Number(distanceKm)) && <strong>{Number(distanceKm).toFixed(1)} km</strong>}
        {driveMinutes != null && Number.isFinite(Number(driveMinutes)) && <span>{driveMinutes} min by car</span>}
      </div>}
      {roadRouteAvailable === false && <span className="mapbox-route-status" role="status">{validRouteGeometry ? 'Road route unavailable · approximate direct connection shown' : renterMarker && pickupMarker ? 'Road route unavailable · no route geometry was returned' : 'Road route unavailable · one or more locations are missing'}</span>}
      {roadRouteAvailable === true && !validRouteGeometry && <span className="mapbox-route-status" role="status">Road route unavailable · Directions returned invalid route geometry</span>}
      {roadRouteAvailable == null && <span className="mapbox-route-status" role="status">Finding driving route…</span>}
    </div>}
    <div className={`mapbox-view${prominentMap ? ' is-prominent-map' : ''}`} ref={container} style={prominentMap ? undefined : { height }} role="region" aria-label={label} />
  </div>
}
