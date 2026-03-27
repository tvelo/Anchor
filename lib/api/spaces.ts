import { supabase } from '../supabase'
import type { Space } from '../types'

export async function getSpaces(userId: string): Promise<Space[]> {
  const { data, error } = await supabase
    .from('canvases_enriched')
    .select('*')
    .or(`owner_id.eq.${userId},partner_id.eq.${userId}`)
  if (error) {
    // Fallback to non-enriched view if the view doesn't exist yet
    const { data: fallback } = await supabase
      .from('canvases')
      .select('id, name, owner_id, background_value')
      .or(`owner_id.eq.${userId},partner_id.eq.${userId}`)
    return (fallback ?? []).map(c => ({
      ...c, member_count: 1, last_activity: null,
    })) as Space[]
  }
  return data ?? []
}

export async function createSpace(name: string, ownerId: string) {
  const { data, error } = await supabase
    .from('canvases')
    .insert({
      name,
      owner_id: ownerId,
      background_type: 'color',
      background_value: '#1A1118',
      theme: 'none',
    })
    .select('*')
    .single()
  if (error) throw error
  await supabase
    .from('space_members')
    .insert({ space_id: data.id, user_id: ownerId, role: 'owner' })
  return data
}

export async function deleteSpace(spaceId: string) {
  const { error } = await supabase.from('canvases').delete().eq('id', spaceId)
  if (error) throw error
}
