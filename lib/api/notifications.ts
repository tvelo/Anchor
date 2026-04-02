import { supabase } from '../supabase'

export interface NotificationItem {
  id: string
  user_id: string
  type: string
  title: string
  body: string
  data: Record<string, any>
  status: string
  read_at: string | null
  created_at: string
}

export async function getNotifications(userId: string, limit = 50): Promise<NotificationItem[]> {
  const { data } = await supabase
    .from('notification_log')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as NotificationItem[]
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await supabase
    .from('notification_log')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
}

export async function markAllRead(userId: string): Promise<void> {
  await supabase
    .from('notification_log')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null)
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { count } = await supabase
    .from('notification_log')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)
  return count ?? 0
}
