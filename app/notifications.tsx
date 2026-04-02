import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator, FlatList, RefreshControl,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { getNotifications, markAllRead, markNotificationRead, type NotificationItem } from '../lib/api/notifications'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/ThemeContext'

const ICONS: Record<string, string> = {
  social_like: '❤️',
  social_comment: '💬',
  social_follow: '👤',
  capsule_media: '📸',
  capsule_unlock: '🔓',
  scrapbook_page: '📖',
  new_member: '✈️',
  space_join: '✦',
  new_message: '✉️',
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function NotificationsScreen() {
  const { colors: C } = useTheme()
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const items = await getNotifications(user.id)
      setNotifications(items)
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [])

  const handleTap = async (item: NotificationItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (!item.read_at) {
      markNotificationRead(item.id).catch(() => {})
      setNotifications(prev => prev.map(n => n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n))
    }
    const t = item.type
    if (t === 'capsule_media' || t === 'capsule_unlock' || t === 'new_member') router.push('/(tabs)/trips')
    else if (t === 'scrapbook_page') router.push('/(tabs)/scrapbook')
    else if (t === 'social_like' || t === 'social_comment' || t === 'social_follow') router.push('/(tabs)' as any)
    else if (t === 'space_join') router.push('/(tabs)/space')
    else if (t === 'new_message' && item.data?.conversation_id) router.push(`/messages/${item.data.conversation_id}`)
  }

  const handleMarkAllRead = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await markAllRead(user.id)
    setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })))
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }

  const unreadCount = notifications.filter(n => !n.read_at).length

  return (
    <SafeAreaView style={[s.root, { backgroundColor: C.bg }]} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={[s.backBtn, { color: C.accent }]}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: C.textPrimary }]}>Notifications</Text>
        {unreadCount > 0 ? (
          <TouchableOpacity onPress={handleMarkAllRead}>
            <Text style={[s.markAll, { color: C.accent }]}>Read all</Text>
          </TouchableOpacity>
        ) : <View style={{ width: 60 }} />}
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={C.accent} size="large" /></View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={item => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={{ fontSize: 48, marginBottom: 12 }}>🔔</Text>
              <Text style={[s.emptyTitle, { color: C.textPrimary }]}>No notifications yet</Text>
              <Text style={[s.emptyText, { color: C.textSecondary }]}>When people interact with your content, you'll see it here.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[s.row, { backgroundColor: item.read_at ? C.bg : C.surface, borderBottomColor: C.border }]}
              onPress={() => handleTap(item)}
              activeOpacity={0.7}
            >
              <Text style={s.icon}>{ICONS[item.type] ?? '🔔'}</Text>
              <View style={s.rowContent}>
                <Text style={[s.rowTitle, { color: C.textPrimary }]} numberOfLines={1}>{item.title}</Text>
                <Text style={[s.rowBody, { color: C.textSecondary }]} numberOfLines={2}>{item.body}</Text>
                <Text style={[s.rowTime, { color: C.textMuted }]}>{timeAgo(item.created_at)}</Text>
              </View>
              {!item.read_at && <View style={[s.dot, { backgroundColor: C.accent }]} />}
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  backBtn: { fontSize: 18, fontWeight: '600' },
  title: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  markAll: { fontSize: 13, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingTop: 100, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 20, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 21 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  icon: { fontSize: 28, width: 40, textAlign: 'center' },
  rowContent: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  rowBody: { fontSize: 13, lineHeight: 18, marginBottom: 3 },
  rowTime: { fontSize: 11 },
  dot: { width: 8, height: 8, borderRadius: 4 },
})
