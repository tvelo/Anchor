import { supabase } from '../supabase'
import type { TravelCapsule, CapsuleMedia, CapsuleMember } from '../types'

export async function getCapsules(userId: string): Promise<TravelCapsule[]> {
  const { data: memberships } = await supabase
    .from('travel_capsule_members')
    .select('capsule_id')
    .eq('user_id', userId)

  const capsuleIds = (memberships ?? []).map((m: any) => m.capsule_id)
  if (!capsuleIds.length) return []

  try {
    // Try enriched view first
    const { data, error } = await supabase
      .from('travel_capsules_enriched')
      .select('*')
      .in('id', capsuleIds)
      .order('created_at', { ascending: false })
    if (error) throw error

    // Auto-unlock expired capsules
    const enriched = await Promise.all((data ?? []).map(async (c: any) => {
      let is_unlocked = c.is_unlocked
      if (c.visibility === 'locked' && !is_unlocked && c.unlock_date) {
        if (new Date(c.unlock_date) <= new Date()) {
          is_unlocked = true
          await supabase.from('travel_capsules').update({ is_unlocked: true }).eq('id', c.id)
        }
      }
      return { ...c, is_unlocked } as TravelCapsule
    }))
    return enriched
  } catch {
    // Fallback if view not deployed yet
    const { data } = await supabase
      .from('travel_capsules')
      .select('*')
      .in('id', capsuleIds)
      .order('created_at', { ascending: false })
    return (data ?? []).map(c => ({ ...c, media_count: 0, member_count: 0 })) as TravelCapsule[]
  }
}

export async function createCapsule(
  canvasId: string,
  userId: string,
  input: { name: string; destination: string; description: string; visibility: string; unlock_date: string | null; cover_url: string | null },
) {
  const { data, error } = await supabase
    .from('travel_capsules')
    .insert({ ...input, canvas_id: canvasId, created_by: userId })
    .select('*')
    .single()
  if (error) throw error
  await supabase
    .from('travel_capsule_members')
    .insert({ capsule_id: data.id, user_id: userId, is_paid: false })
  return data
}

export async function deleteCapsule(capsuleId: string) {
  const { error } = await supabase.from('travel_capsules').delete().eq('id', capsuleId)
  if (error) throw error
}

export async function getMedia(capsuleId: string): Promise<CapsuleMedia[]> {
  const { data, error } = await supabase
    .from('travel_capsule_media')
    .select('*')
    .eq('capsule_id', capsuleId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function uploadMedia(capsuleId: string, userId: string, url: string, type: 'photo' | 'video') {
  const { data, error } = await supabase
    .from('travel_capsule_media')
    .insert({ capsule_id: capsuleId, uploaded_by: userId, url, type })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function getMembers(capsuleId: string): Promise<CapsuleMember[]> {
  const { data, error } = await supabase
    .from('travel_capsule_members')
    .select('*')
    .eq('capsule_id', capsuleId)
  if (error) throw error
  return data ?? []
}

export async function unlockCapsule(capsuleId: string) {
  const { error } = await supabase
    .from('travel_capsules')
    .update({ is_unlocked: true })
    .eq('id', capsuleId)
  if (error) throw error
}
