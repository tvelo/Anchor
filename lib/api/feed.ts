import { supabase } from '../supabase'
import type { SocialPost } from '../types'

export async function getFeedPage(
  userId: string,
  cursor?: string,
  limit = 20,
): Promise<SocialPost[]> {
  try {
    const { data, error } = await supabase.rpc('get_enriched_posts', {
      p_user_id: userId,
      p_limit: limit,
      p_cursor: cursor ?? new Date().toISOString(),
    })
    if (error) throw error
    return data ?? []
  } catch {
    // Fallback: direct query if RPC not deployed yet
    const { data } = await supabase
      .from('social_posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    return (data ?? []) as SocialPost[]
  }
}

export async function likePost(postId: string, userId: string) {
  await supabase
    .from('social_likes')
    .upsert({ user_id: userId, post_id: postId }, { onConflict: 'user_id,post_id' })
}

export async function unlikePost(postId: string, userId: string) {
  await supabase
    .from('social_likes')
    .delete()
    .eq('user_id', userId)
    .eq('post_id', postId)
}

export async function favouritePost(postId: string, userId: string) {
  await supabase
    .from('social_favourites')
    .upsert({ user_id: userId, post_id: postId }, { onConflict: 'user_id,post_id' })
}

export async function unfavouritePost(postId: string, userId: string) {
  await supabase
    .from('social_favourites')
    .delete()
    .eq('user_id', userId)
    .eq('post_id', postId)
}

export async function addComment(postId: string, userId: string, content: string) {
  const { data, error } = await supabase
    .from('social_comments')
    .insert({ post_id: postId, user_id: userId, content })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function deleteComment(commentId: string) {
  await supabase.from('social_comments').delete().eq('id', commentId)
}

export async function reportPost(postId: string, userId: string, reason: string) {
  const { error } = await supabase
    .from('social_reports')
    .insert({ post_id: postId, reported_by: userId, reason })
  if (error) throw error
}

export async function deletePost(postId: string) {
  await supabase.from('social_posts').delete().eq('id', postId)
}
