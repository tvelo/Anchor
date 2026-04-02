import { supabase } from '../supabase'
import type { SocialProfile } from '../types'

export interface Conversation {
  id: string
  user1_id: string
  user2_id: string
  last_message_at: string
  last_message_preview: string | null
  created_at: string
  other_user?: SocialProfile
}

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  content: string
  created_at: string
  read_at: string | null
}

export async function getOrCreateConversation(currentUserId: string, otherUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_or_create_conversation', {
    p_user1: currentUserId,
    p_user2: otherUserId,
  })
  if (error) throw error
  return data as string
}

export async function getConversations(userId: string): Promise<Conversation[]> {
  const { data } = await supabase
    .from('conversations')
    .select('*')
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .order('last_message_at', { ascending: false })

  if (!data?.length) return []

  // Get other user profiles
  const otherIds = data.map(c => c.user1_id === userId ? c.user2_id : c.user1_id)
  const { data: profiles } = await supabase.from('social_profiles').select('*').in('id', otherIds)
  const pMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]))

  return data.map(c => ({
    ...c,
    other_user: pMap[c.user1_id === userId ? c.user2_id : c.user1_id] as SocialProfile | undefined,
  }))
}

export async function getMessages(conversationId: string, limit = 50, cursor?: string): Promise<Message[]> {
  let query = supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (cursor) {
    query = query.lt('created_at', cursor)
  }

  const { data } = await query
  return (data ?? []) as Message[]
}

export async function sendMessage(conversationId: string, senderId: string, content: string): Promise<Message> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, content })
    .select()
    .single()

  if (error) throw error

  // Update conversation preview
  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString(), last_message_preview: content.slice(0, 100) })
    .eq('id', conversationId)

  return data as Message
}

export async function markRead(conversationId: string, userId: string): Promise<void> {
  await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .neq('sender_id', userId)
    .is('read_at', null)
}

export function subscribeToMessages(conversationId: string, onMessage: (msg: Message) => void) {
  return supabase
    .channel(`messages:${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => { onMessage(payload.new as Message) }
    )
    .subscribe()
}
