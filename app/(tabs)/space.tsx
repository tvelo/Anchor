import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { PromptModal } from '../../components/PromptModal'
import SpaceCanvas from '../../components/SpaceCanvas'
import { safeString } from '../../lib/safeContent'
import { storageUploadUrl } from '../../lib/storage'
import { supabase } from '../../lib/supabase'
import { useTheme } from '../../lib/ThemeContext'
import { getLimits, useAnchorPlus } from '../../lib/useAnchorPlus'
import { useBiometricSetting } from '../../lib/useBiometricSetting'

// ─── Free-plan caps ───────────────────────────────────────────────────────────
// How many spaces (total, including invited) a free user may be a member of
const FREE_SPACE_CAP = 3

type Space = {
  id: string
  name: string
  owner_id: string
  background_value: string | null
  memberCount: number
  lastActivity: string | null
}

type Friend = {
  id: string
  display_name: string | null
  username: string | null
}

const SPACE_COLORS = ['#C8A96E', '#B8A9D9', '#6BBED4', '#D46B8A', '#7BC47B', '#D4B66B']
function spaceColor(id: string) { return SPACE_COLORS[id.charCodeAt(0) % SPACE_COLORS.length] }

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const makeStyles = (C: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 },
  headerTitle: { fontSize: 34, fontWeight: '800', color: C.textPrimary, fontFamily: 'Georgia', letterSpacing: -0.8 },
  headerSub: { fontSize: 13, color: C.textSecondary, marginTop: 3 },
  newBtn: { backgroundColor: C.accent, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 10, alignSelf: 'flex-end' },
  newBtnText: { color: C.bg, fontWeight: '800', fontSize: 13 },
  list: { padding: 16, gap: 14, paddingBottom: 48 },
  spaceCard: { borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  accentBar: { height: 5 },
  spaceCardBody: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
  spaceIconWrap: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  spaceIconLetter: { fontSize: 22, fontWeight: '800' },
  spaceName: { fontSize: 17, fontWeight: '700', color: C.textPrimary, marginBottom: 3 },
  spaceMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  spaceMetaText: { fontSize: 12, color: C.textSecondary },
  spaceDot: { fontSize: 12, color: C.textMuted },
  spaceRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inviteChip: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1 },
  inviteChipText: { fontSize: 12, fontWeight: '700' },
  chevron: { fontSize: 22, color: C.textMuted, fontWeight: '200' },
  empty: { alignItems: 'center', paddingTop: 80, gap: 16, paddingHorizontal: 32 },
  emptyIconWrap: { width: 88, height: 88, borderRadius: 28, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 22, fontWeight: '800', color: C.textPrimary, textAlign: 'center', letterSpacing: -0.4 },
  emptyText: { fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 21, maxWidth: 280 },
  emptyBtn: { backgroundColor: C.accent, borderRadius: 24, paddingHorizontal: 28, paddingVertical: 14, marginTop: 4 },
  emptyBtnText: { color: C.bg, fontWeight: '800', fontSize: 15 },
  // Invite modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 44, borderTopWidth: 1, borderColor: C.border, maxHeight: '70%' },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.textPrimary, marginBottom: 4 },
  modalSub: { fontSize: 13, color: C.textSecondary, marginBottom: 20 },
  friendRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border },
  friendAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  friendAvatarText: { color: C.accent, fontSize: 16, fontWeight: '800' },
  friendName: { flex: 1, color: C.textPrimary, fontSize: 15, fontWeight: '600' },
  friendUsername: { color: C.textSecondary, fontSize: 12, marginTop: 1 },
  addFriendBtn: { backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  addFriendBtnText: { color: C.bg, fontWeight: '700', fontSize: 13 },
  cancelBtn: { marginTop: 16, backgroundColor: C.surfaceHigh, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  cancelBtnText: { color: C.textPrimary, fontSize: 15 },
})

export default function SpaceTab() {
  const { colors: C } = useTheme()
  const styles = makeStyles(C)
  const { isPlus } = useAnchorPlus()
  const limits = getLimits(isPlus)
  const [userId, setUserId] = useState('')
  const [spaces, setSpaces] = useState<Space[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null)
  const [spaceMenuId, setSpaceMenuId] = useState<string | null>(null)
  const [showCreatePrompt, setShowCreatePrompt] = useState(false)
  const { prompt: biometricPrompt } = useBiometricSetting()
  const [coverUploadingId, setCoverUploadingId] = useState<string | null>(null)

  // ── Invite (friend-picker) state ──────────────────────────────────────────
  const [inviteModal, setInviteModal] = useState<{ spaceId: string; spaceName: string } | null>(null)
  const [inviteFriends, setInviteFriends] = useState<Friend[]>([])
  const [inviteLoading, setInviteLoading] = useState(false)
  const [addingFriendId, setAddingFriendId] = useState<string | null>(null)

  // Entrance animations
  const headerAnim = useRef(new Animated.Value(0)).current
  const cardAnims = useRef(Array.from({ length: 6 }, () => ({ y: new Animated.Value(24), o: new Animated.Value(0) }))).current

  // ── Open invite modal + load friends ─────────────────────────────────────
  async function openInviteModal(spaceId: string, spaceName: string) {
    setInviteModal({ spaceId, spaceName })
    setInviteLoading(true)
    setInviteFriends([])

    try {
      // Step 1: get friend relationship rows (no nested join)
      const { data: rows } = await supabase
        .from('friends')
        .select('requester_id, addressee_id')
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
        .eq('status', 'accepted')

      if (!rows?.length) {
        setInviteFriends([])
        setInviteLoading(false)
        return
      }

      // Step 2: resolve the OTHER user's profile
      const otherIds = rows.map((r: any) =>
        r.requester_id === userId ? r.addressee_id : r.requester_id
      )

      const { data: profiles } = await supabase
        .from('users')
        .select('id, display_name, username')
        .in('id', otherIds)

      setInviteFriends((profiles ?? []) as Friend[])
    } catch (e) {
      console.log('invite load error', e)
    }

    setInviteLoading(false)
  }

  // ── Add friend to space — with free-plan cap check ────────────────────────
  async function addFriendToSpace(friend: Friend) {
    if (!inviteModal) return
    setAddingFriendId(friend.id)
    try {
      // 1. Check if the invitee is on Anchor Plus
      const { data: friendPlus } = await supabase
        .from('anchor_plus')
        .select('id')
        .eq('user_id', friend.id)
        .maybeSingle()

      // 2. If free plan, count total spaces they are already a member of
      if (!friendPlus) {
        const { count } = await supabase
          .from('space_members')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', friend.id)

        if ((count ?? 0) >= FREE_SPACE_CAP) {
          Alert.alert(
            'Cannot invite',
            `${friend.display_name || '@' + friend.username} is on the free plan and has already reached the ${FREE_SPACE_CAP}-space limit. They would need Anchor Plus to join more spaces.`
          )
          setAddingFriendId(null)
          return
        }
      }

      // 3. Insert via SECURITY DEFINER function to avoid RLS policy cycle
      const { error } = await supabase.rpc('add_space_member', {
        p_space_id: inviteModal.spaceId,
        p_user_id: friend.id,
      })
      if (error && !error.message.includes('23505') && !error.message.toLowerCase().includes('duplicate')) {
        throw error
      }
      Alert.alert(
        'Added ✓',
        `${friend.display_name || '@' + friend.username} has been added to "${inviteModal.spaceName}".`
      )
      setInviteModal(null)
    } catch (e: any) {
      Alert.alert('Error', e.message)
    }
    setAddingFriendId(null)
  }

  async function uploadSpaceCover(spaceId: string) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) { Alert.alert('Permission needed'); return }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.85, allowsEditing: true, aspect: [1, 1] })
    if (result.canceled) return
    setCoverUploadingId(spaceId)
    try {
      const uri = result.assets[0].uri
      const path = `space-covers/${spaceId}-${Date.now()}.jpg`
      const fd = new FormData()
      fd.append('file', { uri, name: 'cover.jpg', type: 'image/jpeg' } as any)
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(storageUploadUrl('canvas-images', path),
        { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'x-upsert': 'true' }, body: fd })
      if (!res.ok) throw new Error('Upload failed')
      const url = supabase.storage.from('canvas-images').getPublicUrl(path).data.publicUrl
      await supabase.from('canvases').update({ cover_url: url }).eq('id', spaceId)
      setSpaces(prev => prev.map(s => s.id === spaceId ? { ...s, cover_url: url } as any : s))
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (e: any) { Alert.alert('Upload failed', e.message) }
    setCoverUploadingId(null)
    setSpaceMenuId(null)
  }

  async function handleDeleteSpace(spaceId: string, spaceName: string) {
    Alert.alert('Delete space?', `"${spaceName}" and all its content will be permanently deleted.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('canvases').delete().eq('id', spaceId)
          setSpaces(prev => prev.filter(s => s.id !== spaceId))
          setSpaceMenuId(null)
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        }
      },
    ])
  }

  async function load() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      // Fetch spaces the user is a member of (not just owner/partner)
      const { data: memberships } = await supabase
        .from('space_members')
        .select('space_id')
        .eq('user_id', user.id)
      const memberSpaceIds = (memberships ?? []).map((m: any) => m.space_id)

      let canvasQuery = supabase
        .from('canvases')
        .select('id, name, owner_id, background_value, cover_url')

      if (memberSpaceIds.length > 0) {
        canvasQuery = canvasQuery.or(
          `owner_id.eq.${user.id},partner_id.eq.${user.id},id.in.(${memberSpaceIds.join(',')})`
        )
      } else {
        canvasQuery = canvasQuery.or(`owner_id.eq.${user.id},partner_id.eq.${user.id}`)
      }

      const { data: canvases } = await canvasQuery
      if (!canvases) return

      const withData = await Promise.all(canvases.map(async c => {
        const { count } = await supabase.from('space_members')
          .select('*', { count: 'exact', head: true }).eq('space_id', c.id)
        const { data: lastWidget } = await supabase.from('canvas_widgets')
          .select('created_at').eq('canvas_id', c.id)
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        return { ...c, memberCount: count || 1, lastActivity: lastWidget?.created_at || null } as Space
      }))

      setSpaces(withData)
    } catch (e) {
      console.log('[Space] load error:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load().then(() => {
      Animated.parallel([
        Animated.timing(headerAnim, { toValue: 1, duration: 450, useNativeDriver: true }),
        ...cardAnims.map((a, i) => Animated.parallel([
          Animated.timing(a.y, { toValue: 0, duration: 400, delay: 60 + i * 50, useNativeDriver: true }),
          Animated.timing(a.o, { toValue: 1, duration: 400, delay: 60 + i * 50, useNativeDriver: true }),
        ]))
      ]).start()
    })
  }, [])

  // Realtime: instant updates for spaces list — no restart needed
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel(`spaces-list-${userId}`)
      // Added to a new space → reload
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'space_members', filter: `user_id=eq.${userId}` },
        () => load())
      // Removed from a space → reload
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'space_members', filter: `user_id=eq.${userId}` },
        () => load())
      // Space name/background changed → patch in-place
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'canvases' },
        (payload) => {
          setSpaces(prev => prev.map(s =>
            s.id === payload.new.id ? { ...s, name: payload.new.name ?? s.name } : s
          ))
        })
      // Space deleted → remove from list
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'canvases' },
        (payload) => setSpaces(prev => prev.filter(s => s.id !== (payload.old as any).id)))
      // Widget added → update last activity
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'canvas_widgets' },
        (payload) => {
          setSpaces(prev => prev.map(s =>
            s.id === payload.new.canvas_id ? { ...s, lastActivity: payload.new.created_at } : s
          ))
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId])



  // (paste this into SpaceTab in spaces.tsx, NOT into SpaceCanvas.tsx)
  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel(`spaces-list-realtime-${userId}`)

      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'space_members',
        filter: `user_id=eq.${userId}`,
      }, () => load())

      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'space_members',
        filter: `user_id=eq.${userId}`,
      }, () => load())

      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'canvases',
      }, (payload: any) => {
        setSpaces((prev: Space[]) =>
          prev.map((s: Space) =>
            s.id === payload.new.id
              ? { ...s, name: payload.new.name ?? s.name }
              : s
          )
        )
      })

      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'canvases',
      }, (payload: any) => {
        setSpaces((prev: Space[]) => prev.filter((s: Space) => s.id !== payload.old.id))
      })

      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'canvas_widgets',
      }, (payload: any) => {
        setSpaces((prev: Space[]) =>
          prev.map((s: Space) =>
            s.id === payload.new.canvas_id
              ? { ...s, lastActivity: payload.new.created_at }
              : s
          )
        )
      })

      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId])
  // ── end of block to insert in SpaceTab ──

  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false) }, [])

  function handleCreateSpace() {
    if (!isPlus && spaces.filter(s => s.owner_id === userId).length >= limits.spaces) {
      Alert.alert('Upgrade to create more', 'Free plan includes 1 space. Unlock unlimited with Anchor Plus — coming soon.', [{ text: 'OK' }])
      return
    }
    setShowCreatePrompt(true)
  }


  async function submitCreateSpace(name: string) {
    setShowCreatePrompt(false)
    try {
      const { data: newCanvas, error: canvasErr } = await supabase.from('canvases')
        .insert({ name: safeString(name).trim(), owner_id: userId, background_type: 'color', background_value: '#1A1118', theme: 'none' })
        .select('*').single()
      if (canvasErr) { Alert.alert('Could not create space', canvasErr.message); return }
      if (newCanvas) {
        const { error: memberErr } = await supabase.from('space_members').insert({ space_id: newCanvas.id, user_id: userId, role: 'owner' })
        if (memberErr) { Alert.alert('Space created but membership failed', memberErr.message) }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        load()
      }
    } catch (e: any) { Alert.alert('Error', e.message) }
  }

  async function enterSpace(id: string) {
    const ok = await biometricPrompt()
    if (!ok) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setActiveSpaceId(id)
  }

  if (activeSpaceId) {
    return <SpaceCanvas spaceId={activeSpaceId} onBack={() => { setActiveSpaceId(null); load() }} />
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <PromptModal
        visible={showCreatePrompt}
        title="New Space"
        message="What do you want to call this space?"
        placeholder="e.g. Our memories"
        onSubmit={submitCreateSpace}
        onCancel={() => setShowCreatePrompt(false)}
      />

      {/* ── Header ── */}
      <Animated.View style={[styles.header, {
        opacity: headerAnim,
        transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }],
      }]}>
        <View>
          <Text style={styles.headerTitle}>Spaces</Text>
          <Text style={styles.headerSub}>{spaces.length === 0 ? 'Your shared canvases' : `${spaces.length} ${spaces.length === 1 ? 'space' : 'spaces'}`}</Text>
        </View>
        <TouchableOpacity style={styles.newBtn} onPress={handleCreateSpace}
          accessibilityRole="button" accessibilityLabel="Create a new space">
          <Text style={styles.newBtnText}>+ New</Text>
        </TouchableOpacity>
      </Animated.View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.accent} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
          showsVerticalScrollIndicator={false}>

          {spaces.map((space, i) => {
            const color = spaceColor(space.id)
            const anim = cardAnims[i] ?? cardAnims[0]
            const coverUrl = (space as any).cover_url
            return (
              <Animated.View key={space.id} style={{ opacity: anim.o, transform: [{ translateY: anim.y }] }}>
                <View style={styles.spaceCard}>
                  <View style={[styles.accentBar, { backgroundColor: color }]} />
                  <TouchableOpacity style={styles.spaceCardBody} onPress={() => enterSpace(space.id)} activeOpacity={0.85}
                    accessibilityRole="button" accessibilityLabel={`Open ${space.name} space`}>
                    <TouchableOpacity
                      style={[styles.spaceIconWrap, { backgroundColor: color + '22', borderWidth: 1.5, borderColor: color + '50' }]}
                      onPress={(e) => { e.stopPropagation?.(); setSpaceMenuId(space.id) }}>
                      {coverUploadingId === space.id
                        ? <ActivityIndicator color={color} size="small" />
                        : coverUrl
                          ? <Image source={{ uri: coverUrl }} style={{ width: '100%', height: '100%', borderRadius: 14 }} resizeMode="cover" />
                          : <Text style={[styles.spaceIconLetter, { color }]}>{space.name.slice(0, 1).toUpperCase()}</Text>
                      }
                    </TouchableOpacity>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.spaceName}>{space.name}</Text>
                      <View style={styles.spaceMeta}>
                        <Text style={styles.spaceMetaText}>👥 {space.memberCount} {space.memberCount === 1 ? 'person' : 'people'}</Text>
                        {space.lastActivity && (
                          <><Text style={styles.spaceDot}>·</Text>
                            <Text style={styles.spaceMetaText}>{timeAgo(space.lastActivity)}</Text></>
                        )}
                        {space.owner_id === userId && (
                          <><Text style={styles.spaceDot}>·</Text>
                            <Text style={[styles.spaceMetaText, { color }]}>Owner</Text></>
                        )}
                      </View>
                    </View>
                    <View style={styles.spaceRight}>
                      {/* Only the owner can invite others */}
                      {space.owner_id === userId && (
                        <TouchableOpacity
                          style={[styles.inviteChip, { backgroundColor: color + '18', borderColor: color + '50' }]}
                          onPress={e => { e.stopPropagation?.(); openInviteModal(space.id, space.name) }}>
                          <Text style={[styles.inviteChipText, { color }]}>Invite</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border }}
                        onPress={(e) => { e.stopPropagation?.(); Haptics.selectionAsync(); setSpaceMenuId(space.id) }}>
                        <Text style={{ color: C.textSecondary, fontSize: 14, letterSpacing: 0.5 }}>···</Text>
                      </TouchableOpacity>
                      <Text style={styles.chevron}>›</Text>
                    </View>
                  </TouchableOpacity>

                  {/* Inline context menu */}
                  {spaceMenuId === space.id && (
                    <View style={{ backgroundColor: C.surfaceHigh, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingVertical: 4 }}>
                      <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}
                        onPress={() => uploadSpaceCover(space.id)}>
                        <Text style={{ fontSize: 16 }}>🖼️</Text>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: C.textPrimary }}>Set cover photo</Text>
                      </TouchableOpacity>
                      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: C.border, marginHorizontal: 16 }} />
                      {space.owner_id === userId && (
                        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}
                          onPress={() => { setSpaceMenuId(null); handleDeleteSpace(space.id, space.name) }}>
                          <Text style={{ fontSize: 16 }}>🗑️</Text>
                          <Text style={{ fontSize: 14, fontWeight: '600', color: C.danger }}>Delete space</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}
                        onPress={() => setSpaceMenuId(null)}>
                        <Text style={{ fontSize: 16 }}>✕</Text>
                        <Text style={{ fontSize: 14, color: C.textSecondary }}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </Animated.View>
            )
          })}

          {spaces.length === 0 && (
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}><Text style={styles.emptyIcon}>✦</Text></View>
              <Text style={styles.emptyTitle}>No spaces yet</Text>
              <Text style={styles.emptyText}>Create your first space and invite the people you care about.</Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={handleCreateSpace}
                accessibilityRole="button" accessibilityLabel="Create a space">
                <Text style={styles.emptyBtnText}>Create a space</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Friend-picker invite modal ── */}
      <Modal
        visible={!!inviteModal}
        transparent
        animationType="slide"
        onRequestClose={() => setInviteModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Invite to "{inviteModal?.spaceName}"</Text>
            <Text style={styles.modalSub}>Choose a friend to give access</Text>

            {inviteLoading ? (
              <ActivityIndicator color={C.accent} style={{ marginVertical: 32 }} />
            ) : inviteFriends.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <Text style={{ color: C.textSecondary, fontSize: 14, textAlign: 'center' }}>
                  No friends yet. Add friends from the Friends tab first.
                </Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
                {inviteFriends.map(friend => (
                  <View key={friend.id} style={styles.friendRow}>
                    <View style={styles.friendAvatar}>
                      <Text style={styles.friendAvatarText}>
                        {(friend.display_name || friend.username || '?')[0].toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.friendName}>{friend.display_name || friend.username}</Text>
                      <Text style={styles.friendUsername}>@{friend.username}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.addFriendBtn, addingFriendId === friend.id && { opacity: 0.5 }]}
                      onPress={() => addFriendToSpace(friend)}
                      disabled={addingFriendId === friend.id}>
                      {addingFriendId === friend.id
                        ? <ActivityIndicator color={C.bg} size="small" />
                        : <Text style={styles.addFriendBtnText}>Add</Text>
                      }
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}

            <TouchableOpacity style={styles.cancelBtn} onPress={() => setInviteModal(null)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}