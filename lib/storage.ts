// Centralised storage upload URL builder.
// Replaces hardcoded Supabase storage REST endpoints across the codebase.

export function storageUploadUrl(bucket: string, path: string): string {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL
  return `${url}/storage/v1/object/${bucket}/${path}`
}
