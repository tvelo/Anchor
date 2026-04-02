export interface PhotoFilter {
  key: string
  label: string
  overlay: { color: string; opacity: number } | null
  imageOpacity?: number
}

export const FILTERS: PhotoFilter[] = [
  { key: 'original', label: 'Original', overlay: null },
  { key: 'warm',     label: 'Warm',     overlay: { color: '#FF8C00', opacity: 0.15 } },
  { key: 'cool',     label: 'Cool',     overlay: { color: '#4169E1', opacity: 0.12 } },
  { key: 'vintage',  label: 'Vintage',  overlay: { color: '#D2691E', opacity: 0.18 }, imageOpacity: 0.9 },
  { key: 'bw',       label: 'B&W',      overlay: { color: '#555555', opacity: 0.65 }, imageOpacity: 0.7 },
  { key: 'fade',     label: 'Fade',     overlay: { color: '#FFFFFF', opacity: 0.20 }, imageOpacity: 0.85 },
  { key: 'vivid',    label: 'Vivid',    overlay: { color: '#FF6B35', opacity: 0.08 } },
]

export function getFilter(key: string): PhotoFilter {
  return FILTERS.find(f => f.key === key) ?? FILTERS[0]
}
