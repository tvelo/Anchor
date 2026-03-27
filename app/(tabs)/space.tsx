import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, Alert, Animated, Image, RefreshControl, ScrollView,
  Share, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { PromptModal } from '../../components/PromptModal'
import SpaceCanvas from '../../components/SpaceCanvas'
import { safeString } from '../../lib/safeContent'
import { storageUploadUrl } from '../../lib/storage'
import { supabase } from '../../lib/supabase'
import { useTheme } from '../../lib/ThemeContext'
import { getLimits, useAnchorPlus } from '../../lib/useAnchorPlus'

type Space = {
  id: string
  name: string
  owner_id: string
  background_value: string | null
  memberCount: number
  lastActivity: string | null
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
  // Header
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 },
  headerTitle: { fontSize: 34, fontWeight: '800', color: C.textPrimary, fontFamily: 'Georgia', letterSpacing: -0.8 },
  headerSub: { fontSize: 13, color: C.textSecondary, marginTop: 3 },
  newBtn: { backgroundColor: C.accent, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 10, alignSelf: 'flex-end' },
  newBtnText: { color: C.bg, fontWeight: '800', fontSize: 13 },
  list: { padding: 16, gap: 14, paddingBottom: 48 },
  // Space card
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
  // Locked ghost card
  lockedCard: { borderRadius: 22, borderWidth: 1.5, borderColor: C.border, borderStyle: 'dashed', backgroundColor: C.surface, padding: 18, gap: 10 },
  lockedInner: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  lockedLock: { fontSize: 28 },
  lockedTitle: { fontSize: 15, fontWeight: '700', color: C.textMuted },
  lockedSub: { fontSize: 12, color: C.accent, marginTop: 2 },
  lockedHint: { fontSize: 11, color: C.textMuted, fontStyle: 'italic', textAlign: 'center' },
  // Empty
  empty: { alignItems: 'center', paddingTop: 80, gap: 16, paddingHorizontal: 32 },
  emptyIconWrap: { width: 88, height: 88, borderRadius: 28, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 22, fontWeight: '800', color: C.textPrimary, textAlign: 'center', letterSpacing: -0.4 },
  emptyText: { fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 21, maxWidth: 280 },
  emptyBtn: { backgroundColor: C.accent, borderRadius: 24, paddingHorizontal: 28, paddingVertical: 14, marginTop: 4 },
  emptyBtnText: { color: C.bg, fontWeight: '800', fontSize: 15 },
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
  const FREE_LIMIT = 1
  const [spaceMenuId, setSpaceMenuId] = useState<string | null>(null)
  const [showCreatePrompt, setShowCreatePrompt] = useState(false)
  const [coverUploadingId, setCoverUploadingId] = useState<string | null>(null)

  // Entrance animations
  const headerAnim = useRef(new Animated.Value(0)).current
  const cardAnims = useRef(Array.from({ length: 6 }, () => ({ y: new Animated.Value(24), o: new Animated.Value(0) }))).current

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
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await supabase.from('canvases').delete().eq('id', spaceId)
        setSpaces(prev => prev.filter(s => s.id !== spaceId))
        setSpaceMenuId(null)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      }},
    ])
  }

  async function load() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      const { data: canvases } = await supabase.from('canvases')
        .select('id, name, owner_id, background_value')
        .or(`owner_id.eq.${user.id},partner_id.eq.${user.id}`)

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

  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false) }, [])

  function handleCreateSpace() {
    if (!isPlus && spaces.length >= limits.spaces) {
      Alert.alert('Upgrade to create more', 'Free plan includes 1 space. Unlock unlimited with Anchor Plus — coming soon.', [{ text: 'OK' }])
      return
    }
    setShowCreatePrompt(true)
  }

  async function submitCreateSpace(name: string) {
    setShowCreatePrompt(false)
    try {
      const { data: newCanvas } = await supabase.from('canvases')
        .insert({ name: safeString(name).trim(), owner_id: userId, background_type: 'color', background_value: '#1A1118', theme: 'none' })
        .select('*').single()
      if (newCanvas) {
        await supabase.from('space_members').insert({ space_id: newCanvas.id, user_id: userId, role: 'owner' })
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        load()
      }
    } catch (e: any) { Alert.alert('Error', e.message) }
  }

  async function handleInvite(spaceId: string, spaceName: string) {
    await Share.share({ message: `Join my space "${spaceName}" on Anchor 💛\nhttps://yourusername.github.io/anchor-links/space/${spaceId}` })
  }

  function enterSpace(id: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setActiveSpaceId(id)
  }

  if (activeSpaceId) {
    return <SpaceCanvas spaceId={activeSpaceId} onBack={() => { setActiveSpaceId(null); load() }} />
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <PromptModal visible={showCreatePrompt} title="New Space" message="What do you want to call this space?" placeholder="e.g. Our memories" onSubmit={submitCreateSpace} onCancel={() => setShowCreatePrompt(false)} />
      {/* Header */}
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
                      <TouchableOpacity
                        style={[styles.inviteChip, { backgroundColor: color + '18', borderColor: color + '50' }]}
                        onPress={e => { e.stopPropagation?.(); handleInvite(space.id, space.name) }}>
                        <Text style={[styles.inviteChipText, { color }]}>Invite</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border }}
                        onPress={(e) => { e.stopPropagation?.(); Haptics.selectionAsync(); setSpaceMenuId(space.id) }}>
                        <Text style={{ color: C.textSecondary, fontSize: 14, letterSpacing: 0.5 }}>···</Text>
                      </TouchableOpacity>
                      <Text style={styles.chevron}>›</Text>
                    </View>
                  </TouchableOpacity>
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

          {/* Locked ghost card */}
          {spaces.length >= FREE_LIMIT && (
            <Animated.View style={{ opacity: cardAnims[spaces.length]?.o ?? 1, transform: [{ translateY: cardAnims[spaces.length]?.y ?? new Animated.Value(0) }] }}>
              <TouchableOpacity style={styles.lockedCard} onPress={handleCreateSpace} activeOpacity={0.7}>
                <View style={styles.lockedInner}>
                  <Text style={styles.lockedLock}>🔒</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lockedTitle}>Create another space</Text>
                    <Text style={styles.lockedSub}>Anchor Plus · Unlimited spaces</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </View>
                <Text style={styles.lockedHint}>One person pays, everyone joins for free</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

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
    </SafeAreaView>
  )
}