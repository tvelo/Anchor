import NetInfo from '@react-native-community/netinfo'
import { Alert } from 'react-native'

// ─────────────────────────────────────────────────────────────────────────────
// Install: npx expo install @react-native-community/netinfo
// ─────────────────────────────────────────────────────────────────────────────

export async function isOnline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch()
    return state.isConnected === true && state.isInternetReachable !== false
  } catch {
    return true // assume online if check fails
  }
}

// Retry an async operation up to maxAttempts times with exponential backoff
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number
    delayMs?: number
    onFail?: (err: Error, attempt: number) => void
    label?: string
  } = {}
): Promise<T> {
  const { maxAttempts = 3, delayMs = 800, onFail, label = 'Operation' } = options
  let lastErr: Error = new Error('Unknown error')

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (e: any) {
      lastErr = e instanceof Error ? e : new Error(String(e))
      onFail?.(lastErr, attempt)
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, delayMs * attempt))
      }
    }
  }
  throw lastErr
}

// Upload a file with retry and offline check
export async function safeUpload(
  uploadFn: () => Promise<string | null>,
  label = 'Upload'
): Promise<string | null> {
  const online = await isOnline()
  if (!online) {
    Alert.alert(
      'No connection',
      `${label} will resume when you're back online. Please try again.`
    )
    return null
  }

  try {
    return await withRetry(uploadFn, {
      maxAttempts: 3,
      delayMs: 1000,
      label,
    })
  } catch (e: any) {
    Alert.alert(`${label} failed`, `${e.message || 'Please check your connection and try again.'}`)
    return null
  }
}

// Wrap a Supabase call with error handling and user-facing alerts
export async function safeQuery<T>(
  fn: () => Promise<{ data: T | null; error: any }>,
  options: {
    errorMessage?: string
    showAlert?: boolean
    fallback?: T
  } = {}
): Promise<T | null> {
  const { errorMessage = 'Something went wrong', showAlert = true, fallback = null } = options
  try {
    const { data, error } = await fn()
    if (error) {
      console.warn('[safeQuery]', error.message)
      if (showAlert) Alert.alert('Error', `${errorMessage}: ${error.message}`)
      return fallback as T | null
    }
    return data
  } catch (e: any) {
    console.warn('[safeQuery] exception', e.message)
    if (showAlert) Alert.alert('Error', errorMessage)
    return fallback as T | null
  }
}

// Send a push notification to other members via Edge Function
export async function notifyMembers(payload: {
  type: 'capsule_media' | 'capsule_unlock' | 'scrapbook_page' | 'new_member' | 'social_like' | 'social_comment' | 'social_follow' | 'space_join' | 'new_message'
  capsule_id?: string
  scrapbook_id?: string
  target_user_id?: string
  actor_id: string
  actor_name: string
  title: string
  body: string
  data?: Record<string, unknown>
}): Promise<void> {
  try {
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

    const res = await fetch(`${supabaseUrl}/functions/v1/notify-members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      console.warn('[notifyMembers] Edge function returned', res.status)
    }
  } catch (e) {
    // Non-fatal — notification failure shouldn't block user action
    console.warn('[notifyMembers] failed silently', e)
  }
}
