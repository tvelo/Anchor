// Validates and sanitises widget/page content before rendering.

export function safeString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v
  return fallback
}

export function safeNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && isFinite(v)) return v
  return fallback
}

export function safeUrl(v: unknown): string | null {
  if (typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'))) return v
  return null
}
