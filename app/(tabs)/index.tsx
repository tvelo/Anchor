import * as Haptics from 'expo-haptics'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Animated, Dimensions, Image, Modal,
  RefreshControl, ScrollView, Share, StyleSheet, Text,
  TextInput, TouchableOpacity, View
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { PromptModal } from '../../components/PromptModal'
import { safeString } from '../../lib/safeContent'
import { supabase } from '../../lib/supabase'
import { useTheme } from '../../lib/ThemeContext'

const { width: SW } = Dimensions.get('window')

type Space = {
  id: string; name: string; owner_id: string
  memberCount: number; lastActivity: string | null; coverColor: string | null
}

type RecentActivity = {
  id: string; type: 'memory' | 'scrapbook' | 'trip'
  title: string; subtitle: string; spaceId: string
  spaceName: string; createdAt: string; emoji: string
}

type Friend = {
  id: string; username: string; display_name: string
  avatar_url: string | null; is_following_back: boolean
}

type SearchResult = {
  id: string; username: string; display_name: string
  avatar_url: string | null; bio: string | null
}

const ACCENT_COLORS = ['#C9956C', '#B8A9D9', '#6BBED4', '#D46B8A', '#7BC47B', '#D4B66B']
function getSpaceColor(id: string) { return ACCENT_COLORS[id.charCodeAt(0) % ACCENT_COLORS.length] }

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'Just now'; if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function FriendAvatar({ friend, size = 48, onPress }: { friend: Friend; size?: number; onPress?: () => void }) {
  const { colors: C } = useTheme()
  const letter = (friend.display_name || friend.username)[0]?.toUpperCase()
  return (
    <TouchableOpacity onPress={onPress} style={{ alignItems: 'center', gap: 5, width: size + 16 }}
      accessibilityRole="button" accessibilityLabel={`${friend.display_name || friend.username}'s profile`}>
      {friend.avatar_url
        ? <Image source={{ uri: friend.avatar_url }} style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: C.accent + '50' }} />
        : <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.accentSoft, borderWidth: 2, borderColor: C.accent + '50', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: C.accent, fontWeight: '800', fontSize: size * 0.38 }}>{letter}</Text>
          </View>
      }
      {friend.is_following_back && (
        <View style={{ position: 'absolute', bottom: 16, right: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: '#5EBA8A', borderWidth: 1.5, borderColor: C.bg }} />
      )}
      <Text style={{ color: C.textSecondary, fontSize: 10, fontWeight: '600', textAlign: 'center' }} numberOfLines={1}>
        {(friend.display_name || friend.username).split(' ')[0]}
      </Text>
    </TouchableOpacity>
  )
}

function AddFriendsModal({ visible, userId, onClose, onFollowed }: {
  visible: boolean; userId: string; onClose: () => void; onFollowed: () => void
}) {
  const { colors: C } = useTheme()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [following, setFollowing] = useState<Set<string>>(new Set())
  const [searching, setSearching] = useState(false)

  useEffect(() => { if (visible) loadFollowing() }, [visible])

  const loadFollowing = async () => {
    try {
      const { data } = await supabase.from('social_follows').select('following_id').eq('follower_id', userId)
      setFollowing(new Set((data ?? []).map((f: any) => f.following_id)))
    } catch {}
  }

  const handleSearch = async (q: string) => {
    setQuery(q)
    if (!q.trim()) { setResults([]); return }
    setSearching(true)
    try {
      const { data } = await supabase
        .from('social_profiles')
        .select('id, username, display_name, avatar_url, bio')
        .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
        .neq('id', userId)
        .limit(15)
      setResults((data ?? []) as SearchResult[])
    } catch {} finally { setSearching(false) }
  }

  const handleFollow = async (profileId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    try {
      if (following.has(profileId)) {
        await supabase.from('social_follows').delete().eq('follower_id', userId).eq('following_id', profileId)
        setFollowing(prev => { const s = new Set(prev); s.delete(profileId); return s })
      } else {
        await supabase.from('social_follows').insert({ follower_id: userId, following_id: profileId })
        setFollowing(prev => new Set([...prev, profileId]))
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      }
      onFollowed()
    } catch {}
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderColor: C.border }}>
          <TouchableOpacity onPress={onClose}><Text style={{ color: C.textSecondary, fontSize: 16 }}>Done</Text></TouchableOpacity>
          <Text style={{ color: C.textPrimary, fontSize: 17, fontWeight: '700' }}>Add Friends</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.surfaceHigh, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: C.border, gap: 8, marginBottom: 20 }}>
            <Text style={{ fontSize: 16, opacity: 0.5 }}>🔍</Text>
            <TextInput style={{ flex: 1, color: C.textPrimary, fontSize: 15 }} value={query} onChangeText={handleSearch}
              placeholder="Search by username or name..." placeholderTextColor={C.textMuted} autoCapitalize="none" autoCorrect={false} />
          </View>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: C.accentSoft, borderRadius: 16, borderWidth: 1, borderColor: C.accent + '40', marginBottom: 20 }}
            onPress={() => Share.share({ message: 'Join me on Anchor 💛\nhttps://anchor.app' })}>
            <Text style={{ fontSize: 28 }}>✉️</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.accent, fontWeight: '700', fontSize: 15 }}>Invite people to Anchor</Text>
              <Text style={{ color: C.textSecondary, fontSize: 12, marginTop: 2 }}>Share the app with friends & family</Text>
            </View>
            <Text style={{ color: C.accent, fontSize: 20 }}>›</Text>
          </TouchableOpacity>
          {query.trim() && results.length === 0 && !searching && (
            <Text style={{ color: C.textMuted, textAlign: 'center', marginTop: 20 }}>No users found for "{query}"</Text>
          )}
          {results.map(r => {
            const isFollowing = following.has(r.id)
            const letter = (r.display_name || r.username)[0]?.toUpperCase()
            return (
              <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}>
                {r.avatar_url
                  ? <Image source={{ uri: r.avatar_url }} style={{ width: 48, height: 48, borderRadius: 24 }} />
                  : <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: C.accent, fontWeight: '800', fontSize: 18 }}>{letter}</Text>
                    </View>
                }
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.textPrimary, fontWeight: '600', fontSize: 15 }}>{r.display_name || r.username}</Text>
                  <Text style={{ color: C.textMuted, fontSize: 12 }}>@{r.username}</Text>
                  {r.bio && <Text style={{ color: C.textSecondary, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{r.bio}</Text>}
                </View>
                <TouchableOpacity onPress={() => handleFollow(r.id)}
                  style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: isFollowing ? C.surfaceHigh : C.accent, borderWidth: 1, borderColor: isFollowing ? C.border : C.accent }}>
                  <Text style={{ color: isFollowing ? C.textSecondary : C.bg, fontWeight: '700', fontSize: 13 }}>
                    {isFollowing ? 'Following' : 'Follow'}
                  </Text>
                </TouchableOpacity>
              </View>
            )
          })}
        </ScrollView>
      </View>
    </Modal>
  )
}

export default function Home() {
  const { colors: C } = useTheme()
  const [name, setName] = useState('')
  const [userId, setUserId] = useState('')
  const [spaces, setSpaces] = useState<Space[]>([])
  const [activity, setActivity] = useState<RecentActivity[]>([])
  const [friends, setFriends] = useState<Friend[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [greeting, setGreeting] = useState('')
  const [showAddFriends, setShowAddFriends] = useState(false)
  const [showCreateSpace, setShowCreateSpace] = useState(false)

  const headerY = useRef(new Animated.Value(-30)).current
  const headerO = useRef(new Animated.Value(0)).current
  const cardAnims = useRef(Array.from({ length: 8 }, () => ({
    y: new Animated.Value(40), o: new Animated.Value(0),
  }))).current

  useEffect(() => {
    const hour = new Date().getHours()
    setGreeting(hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening')
    load()

    // Listen for space deletions and insertions
    const ch = supabase.channel('home-canvas-changes')
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'canvases' }, payload => {
        setSpaces(prev => prev.filter(s => s.id !== (payload.old as any).id))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'canvases' }, () => {
        supabase.auth.getUser().then(({ data: { user } }) => { if (user) loadSpaces(user.id) })
      })
      .subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [])

  // Re-fetch name and friends every time this screen comes into focus
  // This ensures name updates from Settings are reflected immediately
  useFocusEffect(
    useCallback(() => {
      console.log('[Home] focused — refreshing name')
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (!user) return
        supabase.from('users').select('display_name').eq('id', user.id).maybeSingle().then(({ data, error }) => {
          console.log('[Home] name fetch result:', data, error)
          if (data?.display_name) setName(data.display_name)
        })
        loadFriends(user.id)
      })
    }, [])
  )
       

  function animateIn() {
    Animated.parallel([
      Animated.timing(headerY, { toValue: 0, duration: 500, useNativeDriver: true }),
      Animated.timing(headerO, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start()
    cardAnims.forEach((anim, i) => {
      Animated.parallel([
        Animated.timing(anim.y, { toValue: 0, duration: 450, delay: 80 + i * 60, useNativeDriver: true }),
        Animated.timing(anim.o, { toValue: 1, duration: 450, delay: 80 + i * 60, useNativeDriver: true }),
      ]).start()
    })
  }

  async function load() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      setUserId(user.id)

      const { data: prof } = await supabase.from('users').select('display_name').eq('id', user.id).maybeSingle()
      const dn = prof?.display_name || user.user_metadata?.display_name || user.email?.split('@')[0] || 'you'
      setName(dn)
      if (!prof) {
        await supabase.from('users').upsert({ id: user.id, display_name: dn })
      }

      await Promise.all([
        loadSpaces(user.id),
        loadActivity(user.id),
        loadFriends(user.id),
      ])
    } catch (e) {
      console.log('[Home] load error:', e)
    } finally {
      setLoading(false)
      animateIn()
    }
  }

  async function loadSpaces(uid: string) {
    try {
      const { data: canvases } = await supabase.from('canvases')
        .select('id, name, owner_id, background_value')
        .or(`owner_id.eq.${uid},partner_id.eq.${uid}`)
      if (!canvases?.length) return

      const withData = await Promise.all(canvases.map(async c => {
        try {
          const { count } = await supabase.from('space_members').select('*', { count: 'exact', head: true }).eq('space_id', c.id)
          const { data: lastWidget } = await supabase.from('canvas_widgets').select('created_at').eq('canvas_id', c.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
          return { id: c.id, name: c.name, owner_id: c.owner_id, memberCount: count || 1, lastActivity: lastWidget?.created_at || null, coverColor: c.background_value || null } as Space
        } catch { return { id: c.id, name: c.name, owner_id: c.owner_id, memberCount: 1, lastActivity: null, coverColor: null } as Space }
      }))
      setSpaces(withData)
    } catch {}
  }

  async function loadActivity(uid: string) {
    try {
      const activityItems: RecentActivity[] = []
      const { data: canvases } = await supabase.from('canvases').select('id, name').or(`owner_id.eq.${uid},partner_id.eq.${uid}`)
      for (const canvas of (canvases ?? []).slice(0, 2)) {
        try {
          const { data: books } = await supabase.from('scrapbooks').select('id, name').eq('canvas_id', canvas.id).limit(2)
          for (const book of books ?? []) {
            const { data: entries } = await supabase.from('scrapbook_entries').select('id, created_at').eq('scrapbook_id', book.id).order('created_at', { ascending: false }).limit(1)
            if (entries?.[0]) activityItems.push({ id: `scrap-${entries[0].id}`, type: 'scrapbook', title: book.name, subtitle: 'New page added', spaceId: canvas.id, spaceName: canvas.name, createdAt: entries[0].created_at, emoji: '📖' })
          }
        } catch {}
      }
      activityItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      setActivity(activityItems.slice(0, 5))
    } catch {}
  }

 // Replace your existing loadFriends function in home.tsx with this:

async function loadFriends(uid: string) {
  try {
    // Load accepted friends from the friends table
    const { data: accepted } = await supabase
      .from('friends')
      .select(`
        requester_id, addressee_id,
        requester:requester_id(id, username, display_name, avatar_url),
        addressee:addressee_id(id, username, display_name, avatar_url)
      `)
      .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`)
      .eq('status', 'accepted')
      .limit(10)

    if (!accepted?.length) { setFriends([]); return }

    // Get the other person's profile from each row
    const profiles = accepted.map((f: any) =>
      f.requester_id === uid ? f.addressee : f.requester
    )

    // Try to sort by who you've messaged most recently
    // Get conversation IDs the user is in
    const { data: myMemberships } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', uid)

    const myConvIds = (myMemberships ?? []).map((m: any) => m.conversation_id)

    if (myConvIds.length > 0) {
      // For each friend, find if there's a DM and its last message time
      const withActivity = await Promise.all(
        profiles.map(async (p: any) => {
          try {
            const { data: shared } = await supabase
              .from('conversation_members')
              .select('conversation_id')
              .eq('user_id', p.id)
              .in('conversation_id', myConvIds)
              .limit(1)

            if (shared?.length) {
              const { data: conv } = await supabase
                .from('conversations')
                .select('updated_at')
                .eq('id', shared[0].conversation_id)
                .eq('type', 'dm')
                .maybeSingle()
              return { ...p, lastActivity: conv?.updated_at || null }
            }
          } catch {}
          return { ...p, lastActivity: null }
        })
      )

      // Sort: friends with recent activity first, then alphabetically
      withActivity.sort((a: any, b: any) => {
        if (a.lastActivity && b.lastActivity) {
          return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
        }
        if (a.lastActivity) return -1
        if (b.lastActivity) return 1
        return 0
      })

      // Show up to 3
      setFriends(withActivity.slice(0, 3).map((p: any) => ({
        id: p.id,
        username: p.username,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
        is_following_back: true,
      })))
    } else {
      // No conversations yet — just show first 3 friends
      setFriends(profiles.slice(0, 3).map((p: any) => ({
        id: p.id,
        username: p.username,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
        is_following_back: true,
      })))
    }
  } catch (e) {
    console.log('loadFriends error', e)
  }
}

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [])

  function handleCreateSpace() {
    if (spaces.length >= 1) {
      Alert.alert('Upgrade to create more', 'Free plan includes 1 space. Unlock unlimited with Anchor Plus.')
      return
    }
    setShowCreateSpace(true)
  }

  async function submitCreateSpace(spaceName: string) {
    setShowCreateSpace(false)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('canvases').insert({ name: safeString(spaceName).trim(), owner_id: user.id, background_type: 'color', background_value: '#1A1118', theme: 'dark' }).select('*').single()
      if (data) {
        await supabase.from('space_members').insert({ space_id: data.id, user_id: user.id, role: 'owner' })
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        load()
      }
    } catch (e: any) { Alert.alert('Error', e.message) }
  }

  async function handleInvite(spaceId: string, spaceName: string) {
    await Share.share({ message: `Join me on "${spaceName}" in Anchor 💛\nanchormobilev2://space/${spaceId}` })
  }

  const firstName = name.split(' ')[0] || '...'

  return (
    <SafeAreaView style={[st.root, { backgroundColor: C.bg }]} edges={['top']}>
      <AddFriendsModal visible={showAddFriends} userId={userId} onClose={() => setShowAddFriends(false)} onFollowed={() => loadFriends(userId)} />
      <PromptModal visible={showCreateSpace} title="New Space" message="What do you want to call this space?" placeholder="e.g. Our memories" onSubmit={submitCreateSpace} onCancel={() => setShowCreateSpace(false)} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}>

        {/* Hero Header */}
        <Animated.View style={[st.hero, { opacity: headerO, transform: [{ translateY: headerY }] }]}>
          <View>
            <Text style={[st.greetingText, { color: C.textSecondary }]}>{greeting}</Text>
            <Text style={[st.nameText, { color: C.textPrimary }]}>{firstName} ✦</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TouchableOpacity
              style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border }}
              onPress={() => router.push('/messages' as any)}
              accessibilityRole="button" accessibilityLabel="Messages">
              <Text style={{ fontSize: 18 }}>✉️</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border }}
              onPress={() => router.push('/notifications' as any)}
              accessibilityRole="button" accessibilityLabel="Notifications">
              <Text style={{ fontSize: 18 }}>🔔</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.avatarCircle, { backgroundColor: C.accentSoft, borderColor: C.accent + '60', borderWidth: 1.5 }]}
              onPress={() => router.push('/(tabs)/settings' as any)}
              accessibilityRole="button" accessibilityLabel="Open settings">
              <Text style={[st.avatarText, { color: C.accent }]}>{firstName.slice(0, 2).toUpperCase()}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Quick Actions */}
        <Animated.View style={{ opacity: cardAnims[0].o, transform: [{ translateY: cardAnims[0].y }] }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.quickRow}>
            {[
              { emoji: '❤️', label: 'Space',     route: '/(tabs)/space' },
              { emoji: '📖', label: 'Scrapbook', route: '/(tabs)/scrapbook' },
              { emoji: '✈️', label: 'Trips',     route: '/(tabs)/trips' },
            ].map(item => (
              <TouchableOpacity key={item.label} style={[st.quickBtn, { backgroundColor: C.surface, borderColor: C.border }]}
                onPress={() => { Haptics.selectionAsync(); router.push(item.route as any) }}
                accessibilityRole="button" accessibilityLabel={`Open ${item.label}`}>
                <Text style={st.quickEmoji}>{item.emoji}</Text>
                <Text style={[st.quickLabel, { color: C.textSecondary }]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Animated.View>

        {/* Friends */}
        <Animated.View style={{ opacity: cardAnims[1].o, transform: [{ translateY: cardAnims[1].y }] }}>
          <View style={st.sectionHeader}>
            <Text style={[st.sectionTitle, { color: C.textPrimary }]}>Friends</Text>
            <TouchableOpacity onPress={() => setShowAddFriends(true)} style={[st.sectionAction, { backgroundColor: C.accentSoft }]}>
              <Text style={[st.sectionActionText, { color: C.accent }]}>+ Add</Text>
            </TouchableOpacity>
          </View>
          {friends.length === 0 ? (
            <TouchableOpacity style={[st.friendsEmpty, { backgroundColor: C.surface, borderColor: C.border }]} onPress={() => setShowAddFriends(true)}>
              <Text style={{ fontSize: 26 }}>👋</Text>
              <View style={{ flex: 1 }}>
                <Text style={[st.friendsEmptyTitle, { color: C.textPrimary }]}>Add your first friend</Text>
                <Text style={[st.friendsEmptySub, { color: C.textMuted }]}>Follow people to see them here</Text>
              </View>
              <Text style={{ color: C.accent, fontSize: 20 }}>›</Text>
            </TouchableOpacity>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingVertical: 4 }}>
              <TouchableOpacity onPress={() => setShowAddFriends(true)} style={{ alignItems: 'center', gap: 5, width: 64 }}>
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: C.surfaceHigh, borderWidth: 2, borderColor: C.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 20 }}>+</Text>
                </View>
                <Text style={{ color: C.textMuted, fontSize: 10, fontWeight: '600' }}>Add</Text>
              </TouchableOpacity>
              {friends.map(friend => (
                <FriendAvatar key={friend.id} friend={friend} size={48} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/messages' as any) }} />
              ))}
            </ScrollView>
          )}
          {friends.filter(f => f.is_following_back).length > 0 && (
            <Text style={[st.mutualNote, { color: C.textMuted }]}>
              🟢 {friends.filter(f => f.is_following_back).length} mutual friend{friends.filter(f => f.is_following_back).length > 1 ? 's' : ''} following you back
            </Text>
          )}
        </Animated.View>

        {/* Spaces */}
        <Animated.View style={{ opacity: cardAnims[2].o, transform: [{ translateY: cardAnims[2].y }] }}>
          <View style={st.sectionHeader}>
            <Text style={[st.sectionTitle, { color: C.textPrimary }]}>Your Space</Text>
            {spaces.length === 0 && (
              <TouchableOpacity onPress={handleCreateSpace} style={[st.sectionAction, { backgroundColor: C.accentSoft }]}>
                <Text style={[st.sectionActionText, { color: C.accent }]}>+ Create</Text>
              </TouchableOpacity>
            )}
          </View>
          {spaces.length === 0 ? (
            <TouchableOpacity onPress={handleCreateSpace} style={[st.emptySpace, { backgroundColor: C.surface, borderColor: C.border }]}>
              <View style={st.emptySpaceInner}>
                <Text style={st.emptySpaceEmoji}>✦</Text>
                <View>
                  <Text style={[st.emptySpaceTitle, { color: C.textPrimary }]}>Create your first space</Text>
                  <Text style={[st.emptySpaceSub, { color: C.textMuted }]}>A private canvas for you and the people you love</Text>
                </View>
              </View>
            </TouchableOpacity>
          ) : (
            spaces.map(space => {
              const color = getSpaceColor(space.id)
              return (
                <TouchableOpacity key={space.id} style={[st.spaceCard, { backgroundColor: C.surface, borderColor: C.border }]}
                  onPress={async () => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
                    const { data } = await supabase.from('canvases').select('id').eq('id', space.id).maybeSingle()
                    if (!data) {
                      setSpaces(prev => prev.filter(s => s.id !== space.id))
                      Alert.alert('Space not found', 'This space has been deleted.')
                      return
                    }
                    router.push(`/space/[id]?id=${space.id}` as any)
                  }} activeOpacity={0.85}>
                  <View style={[st.spaceColorBar, { backgroundColor: color }]} />
                  <View style={st.spaceCardInner}>
                    <View style={[st.spaceIcon, { backgroundColor: color + '25' }]}>
                      <Text style={[st.spaceIconLetter, { color }]}>{space.name.slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[st.spaceName, { color: C.textPrimary }]}>{space.name}</Text>
                      <View style={st.spaceMeta}>
                        <Text style={[st.spaceMetaText, { color: C.textMuted }]}>{space.memberCount} {space.memberCount === 1 ? 'person' : 'people'}</Text>
                        {space.lastActivity && (
                          <><Text style={[st.spaceDot, { color: C.textMuted }]}>·</Text>
                          <Text style={[st.spaceMetaText, { color: C.textMuted }]}>{timeAgo(space.lastActivity)}</Text></>
                        )}
                      </View>
                    </View>
                    <TouchableOpacity onPress={e => { e.stopPropagation?.(); handleInvite(space.id, space.name) }}
                      style={[st.inviteBtn, { backgroundColor: color + '18', borderColor: color + '50' }]}>
                      <Text style={[st.inviteBtnText, { color }]}>Invite</Text>
                    </TouchableOpacity>
                    <Text style={[st.spaceChevron, { color: C.textMuted }]}>›</Text>
                  </View>
                </TouchableOpacity>
              )
            })
          )}
        </Animated.View>

        {/* Activity */}
        {activity.length > 0 && (
          <Animated.View style={{ opacity: cardAnims[3].o, transform: [{ translateY: cardAnims[3].y }] }}>
            <View style={st.sectionHeader}>
              <Text style={[st.sectionTitle, { color: C.textPrimary }]}>Recent Activity</Text>
            </View>
            <View style={[st.activityCard, { backgroundColor: C.surface, borderColor: C.border }]}>
              {activity.map((item, i) => (
                <TouchableOpacity key={item.id}
                  style={[st.activityRow, i < activity.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border }]}
                  onPress={() => { Haptics.selectionAsync(); router.push('/(tabs)/scrapbook' as any) }}>
                  <View style={[st.activityDot, { backgroundColor: C.accentSoft }]}>
                    <Text style={{ fontSize: 16 }}>{item.emoji}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[st.activityTitle, { color: C.textPrimary }]} numberOfLines={1}>{item.title}</Text>
                    <Text style={[st.activitySub, { color: C.textMuted }]}>{item.subtitle}</Text>
                  </View>
                  <Text style={[st.activityTime, { color: C.textMuted }]}>{timeAgo(item.createdAt)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Animated.View>
        )}

        {/* Feature Cards */}
        <Animated.View style={{ opacity: cardAnims[4].o, transform: [{ translateY: cardAnims[4].y }] }}>
          <View style={st.sectionHeader}>
            <Text style={[st.sectionTitle, { color: C.textPrimary }]}>Explore Anchor</Text>
          </View>
          <View style={st.featureGrid}>
            {[
              { route: '/(tabs)/space',     title: 'Canvas',    sub: 'Your shared board',    emoji: '❤️', bg: '#C9956C' },
              { route: '/(tabs)/scrapbook', title: 'Scrapbook', sub: 'Build pages together', emoji: '📖', bg: '#B8A9D9' },
              { route: '/(tabs)/trips',     title: 'Trips',     sub: 'Travel time capsules', emoji: '✈️', bg: '#6BBED4' },
            ].map(f => (
              <TouchableOpacity key={f.title} style={[st.featureCard, { backgroundColor: f.bg + '18', borderColor: f.bg + '40' }]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(f.route as any) }}
                accessibilityRole="button" accessibilityLabel={`Open ${f.title}`} accessibilityHint={f.sub}>
                <Text style={st.featureEmoji}>{f.emoji}</Text>
                <Text style={[st.featureTitle, { color: C.textPrimary }]}>{f.title}</Text>
                <Text style={[st.featureSub, { color: C.textSecondary }]}>{f.sub}</Text>
                <View style={[st.featureArrow, { backgroundColor: f.bg + '30' }]}>
                  <Text style={{ color: f.bg, fontSize: 14, fontWeight: '700' }}>→</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>

        {/* Invite Banner */}
        <Animated.View style={{ opacity: cardAnims[5].o, transform: [{ translateY: cardAnims[5].y }], paddingHorizontal: 16, marginTop: 8 }}>
          <TouchableOpacity style={[st.inviteBanner, { backgroundColor: C.accent + '15', borderColor: C.accent + '35' }]}
            onPress={() => Share.share({ message: 'Join me on Anchor — a private space for memories 💛\nhttps://anchor.app' })}>
            <View style={{ flex: 1 }}>
              <Text style={[st.inviteBannerTitle, { color: C.accent }]}>Invite someone you love</Text>
              <Text style={[st.inviteBannerSub, { color: C.textSecondary }]}>Anchor is better with the right person</Text>
            </View>
            <View style={[st.inviteBannerBtn, { backgroundColor: C.accent }]}>
              <Text style={st.inviteBannerBtnText}>Share ✦</Text>
            </View>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  )
}

const st = StyleSheet.create({
  root: { flex: 1 },
  hero: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  greetingText: { fontSize: 13, fontWeight: '500', letterSpacing: 0.3 },
  nameText: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5, marginTop: 2 },
  avatarCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontWeight: '800' },
  quickRow: { paddingHorizontal: 16, gap: 10, paddingBottom: 4, paddingTop: 2 },
  quickBtn: { alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14, borderRadius: 18, borderWidth: 1, gap: 6, minWidth: 72 },
  quickEmoji: { fontSize: 24 },
  quickLabel: { fontSize: 11, fontWeight: '600' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 24, marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  sectionAction: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  sectionActionText: { fontSize: 13, fontWeight: '700' },
  friendsEmpty: { marginHorizontal: 16, borderRadius: 16, borderWidth: 1, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  friendsEmptyTitle: { fontSize: 14, fontWeight: '700' },
  friendsEmptySub: { fontSize: 12, marginTop: 2 },
  mutualNote: { fontSize: 11, paddingHorizontal: 20, marginTop: 6 },
  emptySpace: { marginHorizontal: 16, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', padding: 20 },
  emptySpaceInner: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  emptySpaceEmoji: { fontSize: 32 },
  emptySpaceTitle: { fontSize: 15, fontWeight: '700', marginBottom: 3 },
  emptySpaceSub: { fontSize: 12, lineHeight: 16, maxWidth: 220 },
  spaceCard: { marginHorizontal: 16, borderRadius: 18, borderWidth: 1, overflow: 'hidden', marginBottom: 10 },
  spaceColorBar: { height: 4, width: '100%' },
  spaceCardInner: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  spaceIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  spaceIconLetter: { fontSize: 20, fontWeight: '800' },
  spaceName: { fontSize: 16, fontWeight: '700', marginBottom: 3 },
  spaceMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  spaceMetaText: { fontSize: 12 },
  spaceDot: { fontSize: 12 },
  inviteBtn: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  inviteBtnText: { fontSize: 12, fontWeight: '700' },
  spaceChevron: { fontSize: 22, fontWeight: '300', marginLeft: 4 },
  activityCard: { marginHorizontal: 16, borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  activityRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  activityDot: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  activityTitle: { fontSize: 14, fontWeight: '600' },
  activitySub: { fontSize: 12 },
  activityTime: { fontSize: 11 },
  featureGrid: { paddingHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  featureCard: { width: (SW - 42) / 2, borderRadius: 20, borderWidth: 1, padding: 16, gap: 6 },
  featureEmoji: { fontSize: 28, marginBottom: 4 },
  featureTitle: { fontSize: 15, fontWeight: '800' },
  featureSub: { fontSize: 12, lineHeight: 16 },
  featureArrow: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  inviteBanner: { borderRadius: 20, borderWidth: 1, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14 },
  inviteBannerTitle: { fontSize: 15, fontWeight: '800', marginBottom: 3 },
  inviteBannerSub: { fontSize: 12, lineHeight: 17 },
  inviteBannerBtn: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  inviteBannerBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
})