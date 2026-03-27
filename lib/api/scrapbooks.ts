import { supabase } from '../supabase'
import type { Scrapbook, Page } from '../types'

export async function getScrapbooks(canvasId: string): Promise<Scrapbook[]> {
  const { data, error } = await supabase
    .from('scrapbooks')
    .select('*')
    .eq('canvas_id', canvasId)
    .order('created_at', { ascending: false })
  if (error) throw error

  const withCounts = await Promise.all((data ?? []).map(async b => {
    const { count } = await supabase
      .from('scrapbook_entries')
      .select('*', { count: 'exact', head: true })
      .eq('scrapbook_id', b.id)
    return { ...b, entryCount: count || 0 } as Scrapbook
  }))
  return withCounts
}

export async function createScrapbook(
  canvasId: string,
  userId: string,
  name: string,
  themeColor: string,
) {
  const { data, error } = await supabase
    .from('scrapbooks')
    .insert({ canvas_id: canvasId, created_by: userId, name, theme_color: themeColor })
    .select('*')
    .single()
  if (error) throw error
  return data as Scrapbook
}

export async function deleteScrapbook(scrapbookId: string) {
  const { error } = await supabase.from('scrapbooks').delete().eq('id', scrapbookId)
  if (error) throw error
}

export async function getPages(scrapbookId: string): Promise<Page[]> {
  const { data, error } = await supabase
    .from('scrapbook_entries')
    .select('*')
    .eq('scrapbook_id', scrapbookId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(p => ({
    ...p,
    elements: typeof p.elements === 'string'
      ? JSON.parse(p.elements || '[]')
      : (p.elements || []),
    bg_color: p.bg_color || '#FFFFFF',
  })) as Page[]
}

export async function insertPage(scrapbookId: string, userId: string) {
  const { data, error } = await supabase
    .from('scrapbook_entries')
    .insert({
      scrapbook_id: scrapbookId,
      added_by: userId,
      bg_color: '#FFFFFF',
      elements: '[]',
      page_size: 'default',
    })
    .select('*')
    .single()
  if (error) throw error
  return {
    ...data,
    elements: [],
    bg_color: data.bg_color || '#FFFFFF',
  } as Page
}

export async function savePage(pageId: string, updates: Partial<Page>) {
  const { error } = await supabase
    .from('scrapbook_entries')
    .update(updates)
    .eq('id', pageId)
  if (error) throw error
}

export async function deletePage(pageId: string) {
  const { error } = await supabase.from('scrapbook_entries').delete().eq('id', pageId)
  if (error) throw error
}
