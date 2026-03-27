// Location utilities for tagging memories and widgets with place names.
// Uses reverse geocoding via the free Open-Meteo/Nominatim API to avoid
// requiring an additional API key.

export interface LocationTag {
  latitude: number
  longitude: number
  name: string       // e.g. "Brooklyn, New York"
  country: string    // e.g. "US"
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org'
const TIMEOUT_MS = 5000

export async function reverseGeocode(lat: number, lon: number): Promise<LocationTag | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch(
      `${NOMINATIM_URL}/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10`,
      {
        signal: controller.signal,
        headers: { 'User-Agent': 'AnchorApp/1.0' },
      }
    )
    clearTimeout(timer)
    if (!res.ok) return null
    const data = await res.json()
    const addr = data.address ?? {}
    const city = addr.city ?? addr.town ?? addr.village ?? addr.hamlet ?? ''
    const state = addr.state ?? ''
    const country = addr.country_code?.toUpperCase() ?? ''
    const name = [city, state].filter(Boolean).join(', ')
    return { latitude: lat, longitude: lon, name: name || data.display_name || 'Unknown', country }
  } catch {
    return null
  }
}

export async function searchPlace(query: string): Promise<LocationTag[]> {
  if (!query.trim()) return []
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch(
      `${NOMINATIM_URL}/search?format=json&q=${encodeURIComponent(query)}&limit=5`,
      {
        signal: controller.signal,
        headers: { 'User-Agent': 'AnchorApp/1.0' },
      }
    )
    clearTimeout(timer)
    if (!res.ok) return []
    const results = await res.json()
    return results.map((r: any) => ({
      latitude: parseFloat(r.lat),
      longitude: parseFloat(r.lon),
      name: r.display_name?.split(',').slice(0, 2).join(',').trim() ?? 'Unknown',
      country: r.address?.country_code?.toUpperCase() ?? '',
    }))
  } catch {
    return []
  }
}

export function formatLocation(tag: LocationTag): string {
  return tag.country ? `📍 ${tag.name}, ${tag.country}` : `📍 ${tag.name}`
}
