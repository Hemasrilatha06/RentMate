export function distanceBetweenCoordinates(first, second) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180
  const lat1 = toRadians(Number(first.latitude))
  const lat2 = toRadians(Number(second.latitude))
  const latitudeDelta = toRadians(Number(second.latitude) - Number(first.latitude))
  const longitudeDelta = toRadians(Number(second.longitude) - Number(first.longitude))
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(longitudeDelta / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

export function getCurrentCoordinates() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location is not available in this browser.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      (error) => reject(new Error(error.code === error.PERMISSION_DENIED
        ? 'Location permission was denied. You can allow it in your browser settings and try again.'
        : 'We could not get your location. Please try again.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    )
  })
}
