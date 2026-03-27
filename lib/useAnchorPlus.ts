import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// ─────────────────────────────────────────────────────────────────────────────
// useAnchorPlus — call this in any screen that needs to gate features
// Usage: const { isPlus, loading } = useAnchorPlus()
// ─────────────────────────────────────────────────────────────────────────────

let cachedIsPlus: boolean | null = null
let cacheTimestamp = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export function useAnchorPlus() {
  const [isPlus, setIsPlus] = useState<boolean>(cachedIsPlus ?? false)
  const [loading, setLoading] = useState<boolean>(cachedIsPlus === null)

  useEffect(() => {
    check()
  }, [])

  async function check() {
    if (cachedIsPlus !== null && Date.now() - cacheTimestamp < CACHE_TTL) {
      setIsPlus(cachedIsPlus)
      setLoading(false)
      return
    }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setIsPlus(false); setLoading(false); return }
    const { data } = await supabase
      .from('anchor_plus')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()
    const result = !!data
    cachedIsPlus = result
    cacheTimestamp = Date.now()
    setIsPlus(result)
    setLoading(false)
  }

  function refresh() {
    cachedIsPlus = null
    cacheTimestamp = 0
    check()
  }

  return { isPlus, loading, refresh }
}

// Standalone async check (for use outside React components)
export async function checkIsPlus(): Promise<boolean> {
  if (cachedIsPlus !== null && Date.now() - cacheTimestamp < CACHE_TTL) return cachedIsPlus
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data } = await supabase.from('anchor_plus').select('id').eq('user_id', user.id).maybeSingle()
  cachedIsPlus = !!data
  cacheTimestamp = Date.now()
  return cachedIsPlus
}

// ─────────────────────────────────────────────────────────────────────────────
// Free vs Plus limits — single source of truth for the whole app
// ─────────────────────────────────────────────────────────────────────────────
export const LIMITS = {
  free: {
    scrapbooks: 2,
    scrapbookPages: 10,
    capsules: 1,
    capsuleMembers: 4,
    capsuleMedia: 16,
    spaces: 1,
  },
  plus: {
    scrapbooks: Infinity,
    scrapbookPages: Infinity,
    capsules: Infinity,
    capsuleMembers: Infinity,
    capsuleMedia: 50,
    spaces: Infinity,
  },
}

export function getLimits(isPlus: boolean) {
  return isPlus ? LIMITS.plus : LIMITS.free
}
