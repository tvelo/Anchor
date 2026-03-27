import { reverseGeocode, searchPlace, formatLocation } from '../../lib/location'

const mockFetch = jest.fn()
global.fetch = mockFetch as any

describe('reverseGeocode', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns location tag from nominatim response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        address: { city: 'Brooklyn', state: 'New York', country_code: 'us' },
        display_name: 'Brooklyn, Kings County, New York, US',
      }),
    })
    const result = await reverseGeocode(40.68, -73.94)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('Brooklyn, New York')
    expect(result!.country).toBe('US')
    expect(result!.latitude).toBe(40.68)
  })

  it('returns null on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))
    const result = await reverseGeocode(0, 0)
    expect(result).toBeNull()
  })

  it('returns null on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false })
    const result = await reverseGeocode(0, 0)
    expect(result).toBeNull()
  })
})

describe('searchPlace', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns array of location tags', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { lat: '40.68', lon: '-73.94', display_name: 'Brooklyn, New York, US', address: { country_code: 'us' } },
      ],
    })
    const results = await searchPlace('Brooklyn')
    expect(results.length).toBe(1)
    expect(results[0].latitude).toBe(40.68)
  })

  it('returns empty array for empty query', async () => {
    const results = await searchPlace('')
    expect(results).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns empty array on failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'))
    const results = await searchPlace('test')
    expect(results).toEqual([])
  })
})

describe('formatLocation', () => {
  it('formats with country', () => {
    expect(formatLocation({ latitude: 0, longitude: 0, name: 'Paris', country: 'FR' }))
      .toBe('📍 Paris, FR')
  })

  it('formats without country', () => {
    expect(formatLocation({ latitude: 0, longitude: 0, name: 'Unknown', country: '' }))
      .toBe('📍 Unknown')
  })
})
