import { safeString, safeNumber, safeUrl } from '../../lib/safeContent'

describe('safeString', () => {
  it('returns string values unchanged', () => {
    expect(safeString('hello')).toBe('hello')
  })
  it('returns empty string for null', () => {
    expect(safeString(null)).toBe('')
  })
  it('returns empty string for undefined', () => {
    expect(safeString(undefined)).toBe('')
  })
  it('returns empty string for number', () => {
    expect(safeString(42)).toBe('')
  })
  it('returns custom fallback', () => {
    expect(safeString(null, 'default')).toBe('default')
  })
  it('returns empty string for object', () => {
    expect(safeString({})).toBe('')
  })
})

describe('safeNumber', () => {
  it('returns number values unchanged', () => {
    expect(safeNumber(42)).toBe(42)
  })
  it('returns 0 for null', () => {
    expect(safeNumber(null)).toBe(0)
  })
  it('returns 0 for undefined', () => {
    expect(safeNumber(undefined)).toBe(0)
  })
  it('returns 0 for string', () => {
    expect(safeNumber('hello')).toBe(0)
  })
  it('returns 0 for NaN', () => {
    expect(safeNumber(NaN)).toBe(0)
  })
  it('returns 0 for Infinity', () => {
    expect(safeNumber(Infinity)).toBe(0)
  })
  it('returns custom fallback', () => {
    expect(safeNumber(null, 5)).toBe(5)
  })
  it('handles negative numbers', () => {
    expect(safeNumber(-10)).toBe(-10)
  })
  it('handles zero', () => {
    expect(safeNumber(0)).toBe(0)
  })
})

describe('safeUrl', () => {
  it('accepts https URLs', () => {
    expect(safeUrl('https://example.com')).toBe('https://example.com')
  })
  it('accepts http URLs', () => {
    expect(safeUrl('http://example.com')).toBe('http://example.com')
  })
  it('rejects relative paths', () => {
    expect(safeUrl('/path')).toBeNull()
  })
  it('rejects non-string values', () => {
    expect(safeUrl(42)).toBeNull()
  })
  it('rejects null', () => {
    expect(safeUrl(null)).toBeNull()
  })
  it('rejects undefined', () => {
    expect(safeUrl(undefined)).toBeNull()
  })
  it('rejects empty string', () => {
    expect(safeUrl('')).toBeNull()
  })
  it('rejects javascript: protocol', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull()
  })
  it('rejects data: URLs', () => {
    expect(safeUrl('data:text/html,<h1>hi</h1>')).toBeNull()
  })
})
