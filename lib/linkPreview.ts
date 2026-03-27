// Fetches Open Graph metadata from a URL for link preview unfurling.
// Falls back gracefully if the page can't be reached or has no OG tags.

export interface LinkPreview {
  title: string | null
  description: string | null
  image: string | null
  siteName: string | null
  favicon: string | null
}

const TIMEOUT_MS = 5000

function extractMeta(html: string, property: string): string | null {
  // Match <meta property="og:title" content="..." /> or <meta name="..." content="..." />
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, 'i'),
  ]
  for (const re of patterns) {
    const match = html.match(re)
    if (match?.[1]) return match[1]
  }
  return null
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return match?.[1]?.trim() ?? null
}

function extractFavicon(html: string, baseUrl: string): string | null {
  const match = html.match(/<link[^>]+rel=["'](?:icon|shortcut icon)["'][^>]+href=["']([^"']+)["']/i)
    ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:icon|shortcut icon)["']/i)
  if (!match?.[1]) return null
  const href = match[1]
  if (href.startsWith('http')) return href
  if (href.startsWith('//')) return `https:${href}`
  try {
    const url = new URL(baseUrl)
    return `${url.protocol}//${url.host}${href.startsWith('/') ? href : `/${href}`}`
  } catch {
    return null
  }
}

export async function fetchLinkPreview(url: string): Promise<LinkPreview> {
  const empty: LinkPreview = { title: null, description: null, image: null, siteName: null, favicon: null }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AnchorApp/1.0 LinkPreview' },
    })
    clearTimeout(timer)
    if (!res.ok) return empty
    // Only read first 50KB to avoid downloading entire pages
    const text = await res.text()
    const head = text.slice(0, 50000)

    return {
      title: extractMeta(head, 'og:title') ?? extractTitle(head),
      description: extractMeta(head, 'og:description') ?? extractMeta(head, 'description'),
      image: extractMeta(head, 'og:image'),
      siteName: extractMeta(head, 'og:site_name'),
      favicon: extractFavicon(head, url),
    }
  } catch {
    return empty
  }
}
