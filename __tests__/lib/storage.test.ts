// Mock the environment variable before importing
const MOCK_URL = 'https://test.supabase.co'
process.env.EXPO_PUBLIC_SUPABASE_URL = MOCK_URL

import { storageUploadUrl } from '../../lib/storage'

describe('storageUploadUrl', () => {
  it('builds correct URL for bucket and path', () => {
    expect(storageUploadUrl('canvas-images', 'photos/test.jpg'))
      .toBe(`${MOCK_URL}/storage/v1/object/canvas-images/photos/test.jpg`)
  })

  it('handles paths with special characters', () => {
    expect(storageUploadUrl('canvas-images', 'space-covers/abc-123.jpg'))
      .toBe(`${MOCK_URL}/storage/v1/object/canvas-images/space-covers/abc-123.jpg`)
  })

  it('handles different bucket names', () => {
    expect(storageUploadUrl('avatars', 'user/pic.png'))
      .toBe(`${MOCK_URL}/storage/v1/object/avatars/user/pic.png`)
  })
})
