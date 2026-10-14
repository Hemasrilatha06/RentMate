import './MapboxLocation.css'

export default function DistanceBadge({ distanceKm, driveMinutes }) {
  if (distanceKm == null || !Number.isFinite(Number(distanceKm))) return null
  return <span className="distance-badge">{Number(distanceKm).toFixed(1)} km apart{driveMinutes != null ? `, about ${driveMinutes} min by car` : ''}</span>
}
