import { supabase } from '../supabase'
import type { Widget } from '../types'

export async function getWidgets(canvasId: string): Promise<Widget[]> {
  const { data, error } = await supabase
    .from('canvas_widgets')
    .select('*')
    .eq('canvas_id', canvasId)
  if (error) throw error
  return data ?? []
}

export async function insertWidget(
  canvasId: string,
  userId: string,
  type: string,
  content: any,
  x: number,
  y: number,
  width: number,
  height: number,
  zIndex: number,
  style?: any,
) {
  const { data, error } = await supabase
    .from('canvas_widgets')
    .insert({
      canvas_id: canvasId,
      created_by: userId,
      type,
      content,
      x, y, width, height,
      z_index: zIndex,
      style: style ?? {},
    })
    .select('*')
    .single()
  if (error) throw error
  return data as Widget
}

export async function updateWidgetPosition(id: string, x: number, y: number) {
  const { error } = await supabase
    .from('canvas_widgets')
    .update({ x, y })
    .eq('id', id)
  if (error) throw error
}

export async function updateWidgetStyle(id: string, style: Record<string, any>) {
  const { error } = await supabase
    .from('canvas_widgets')
    .update({ style })
    .eq('id', id)
  if (error) throw error
}

export async function updateWidgetContent(id: string, content: Record<string, any>) {
  const { error } = await supabase
    .from('canvas_widgets')
    .update({ content })
    .eq('id', id)
  if (error) throw error
}

export async function updateWidgetZIndex(id: string, zIndex: number) {
  const { error } = await supabase
    .from('canvas_widgets')
    .update({ z_index: zIndex })
    .eq('id', id)
  if (error) throw error
}

export async function deleteWidget(id: string) {
  const { error } = await supabase
    .from('canvas_widgets')
    .delete()
    .eq('id', id)
  if (error) throw error
}
