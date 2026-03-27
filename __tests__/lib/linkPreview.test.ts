import { fetchLinkPreview } from '../../lib/linkPreview'

// Mock fetch globally
const mockFetch = jest.fn()
global.fetch = mockFetch as any

describe('fetchLinkPreview', () => {
  beforeEach(() => jest.clearAllMocks())

  it('extracts og:title and og:description', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `
        <html><head>
          <meta property="og:title" content="Test Page" />
          <meta property="og:description" content="A description" />
          <meta property="og:image" content="https://example.com/img.jpg" />
          <meta property="og:site_name" content="Example" />
        </head></html>`,
    })
    const result = await fetchLinkPreview('https://example.com')
    expect(result.title).toBe('Test Page')
    expect(result.description).toBe('A description')
    expect(result.image).toBe('https://example.com/img.jpg')
    expect(result.siteName).toBe('Example')
  })

  it('falls back to <title> tag when no og:title', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><head><title>Fallback Title</title></head></html>',
    })
    const result = await fetchLinkPreview('https://example.com')
    expect(result.title).toBe('Fallback Title')
  })

  it('returns empty preview on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))
    const result = await fetchLinkPreview('https://example.com')
    expect(result.title).toBeNull()
    expect(result.description).toBeNull()
    expect(result.image).toBeNull()
  })

  it('returns empty preview on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false })
    const result = await fetchLinkPreview('https://example.com')
    expect(result.title).toBeNull()
  })

  it('extracts favicon from link tag', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `
        <html><head>
          <link rel="icon" href="/favicon.ico" />
          <title>Test</title>
        </head></html>`,
    })
    const result = await fetchLinkPreview('https://example.com/page')
    expect(result.favicon).toBe('https://example.com/favicon.ico')
  })

  it('handles meta tags with content before property', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<meta content="Reversed" property="og:title" />`,
    })
    const result = await fetchLinkPreview('https://example.com')
    expect(result.title).toBe('Reversed')
  })
})
