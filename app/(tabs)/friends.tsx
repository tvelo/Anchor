import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator, Alert, Modal, Platform,
  ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { notifyFriendAccepted, notifyFriendRequest } from '../../lib/notifications'
import { supabase } from '../../lib/supabase'

type UserProfile = {
  id: string
  display_name: string | null
  username: string | null
}

type FriendRow = {
  id: string
  requester_id: string
  addressee_id: string
  profile: UserProfile
}

type Tab = 'friends' | 'requests' | 'search'
type AddToTab = 'spaces' | 'scrapbooks' | 'trips'

export default function FriendsScreen() {
  const router = useRouter()
  const [userId, setUserId] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('friends')

  const [friends, setFriends] = useState<UserProfile[]>([])
  const [pendingIn, setPendingIn] = useState<FriendRow[]>([])
  const [pendingOut, setPendingOut] = useState<string[]>([])

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<UserProfile[]>([])
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(true)
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [openingDMFor, setOpeningDMFor] = useState<string | null>(null)

  // ── Add-to state ──────────────────────────────────────────────────────────
  const [addToFriend, setAddToFriend] = useState<UserProfile | null>(null)
  const [addToTab, setAddToTab] = useState<AddToTab>('spaces')
  const [addToItems, setAddToItems] = useState<{ id: string; name: string }[]>([])
  const [addToLoading, setAddToLoading] = useState(false)
  const [addingToId, setAddingToId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id || ''
      setUserId(uid)
      if (uid) loadAll(uid)
    })
  }, [])

  async function loadAll(uid: string) {
    setLoading(true)
    try {
      const { data: accepted } = await supabase
        .from('friends')
        .select(`
          id, requester_id, addressee_id,
          requester:requester_id(id, display_name, username),
          addressee:addressee_id(id, display_name, username)
        `)
        .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`)
        .eq('status', 'accepted')

      setFriends(
        (accepted ?? []).map((f: any) =>
          f.requester_id === uid ? f.addressee : f.requester
        ) as UserProfile[]
      )

      const { data: incoming } = await supabase
        .from('friends')
        .select('id, requester_id, addressee_id, requester:requester_id(id, display_name, username)')
        .eq('addressee_id', uid)
        .eq('status', 'pending')

      setPendingIn(
        (incoming ?? []).map((p: any) => ({
          id: p.id,
          requester_id: p.requester_id,
          addressee_id: p.addressee_id,
          profile: p.requester,
        }))
      )

      const { data: outgoing } = await supabase
        .from('friends')
        .select('addressee_id')
        .eq('requester_id', uid)
        .eq('status', 'pending')

      setPendingOut((outgoing ?? []).map((r: any) => r.addressee_id))
    } catch (e) {
      console.log('loadAll error', e)
    }
    setLoading(false)
  }

  // ── Add-to logic ──────────────────────────────────────────────────────────
  async function openAddTo(friend: UserProfile) {
    setAddToFriend(friend)
    setAddToTab('spaces')
    await loadAddToItems('spaces')
  }

  async function loadAddToItems(tab: AddToTab) {
    setAddToLoading(true)
    setAddToItems([])
    try {
      if (tab === 'spaces') {
        const { data } = await supabase
          .from('canvases')
          .select('id, name')
          .or(`owner_id.eq.${userId},partner_id.eq.${userId}`)
        setAddToItems((data ?? []).map((d: any) => ({ id: d.id, name: d.name })))
      } else if (tab === 'scrapbooks') {
        const { data } = await supabase
          .from('scrapbook_members')
          .select('scrapbook_id, scrapbooks(id, name)')
          .eq('user_id', userId)
        setAddToItems(
          (data ?? [])
            .map((d: any) => ({ id: d.scrapbooks?.id, name: d.scrapbooks?.name }))
            .filter((d: any) => d.id && d.name)
        )
      } else {
        const { data } = await supabase
          .from('travel_capsule_members')
          .select('capsule_id, travel_capsules(id, name)')
          .eq('user_id', userId)
        setAddToItems(
          (data ?? [])
            .map((d: any) => ({ id: d.travel_capsules?.id, name: d.travel_capsules?.name }))
            .filter((d: any) => d.id && d.name)
        )
      }
    } catch (e) {
      console.log('loadAddToItems error', e)
    }
    setAddToLoading(false)
  }

  async function switchAddToTab(tab: AddToTab) {
    setAddToTab(tab)
    await loadAddToItems(tab)
  }

  async function addFriendTo(item: { id: string; name: string }) {
    if (!addToFriend) return
    setAddingToId(item.id)
    try {
      if (addToTab === 'spaces') {
        const { error } = await supabase.from('space_members').insert({
          space_id: item.id,
          user_id: addToFriend.id,
          role: 'member',
        })
        if (error && !error.message.toLowerCase().includes('duplicate') && !error.message.includes('23505')) {
          throw error
        }
      } else if (addToTab === 'scrapbooks') {
        const { error } = await supabase.from('scrapbook_members').insert({
          scrapbook_id: item.id,
          user_id: addToFriend.id,
          can_edit: false,
          invited_by: userId,
        })
        if (error && !error.message.toLowerCase().includes('duplicate') && !error.message.includes('23505')) {
          throw error
        }
      } else {
        const { error } = await supabase.from('travel_capsule_members').insert({
          capsule_id: item.id,
          user_id: addToFriend.id,
          is_paid: false,
        })
        if (error && !error.message.toLowerCase().includes('duplicate') && !error.message.includes('23505')) {
          throw error
        }
      }
      Alert.alert(
        'Added ✓',
        `${addToFriend.display_name || '@' + addToFriend.username} has been added to "${item.name}".`
      )
      setAddToFriend(null)
    } catch (e: any) {
      Alert.alert('Error', e.message)
    }
    setAddingToId(null)
  }

  // ── DM logic — uses RPC so both member rows bypass RLS ───────────────────
  async function openDM(friend: UserProfile) {
    if (openingDMFor) return
    setOpeningDMFor(friend.id)
    try {
      // Check for an existing DM first
      const { data: myMemberships } = await supabase
        .from('conversation_members').select('conversation_id').eq('user_id', userId)
      const myConvIds = (myMemberships ?? []).map((m: any) => m.conversation_id)

      if (myConvIds.length > 0) {
        const { data: shared } = await supabase
          .from('conversation_members').select('conversation_id')
          .eq('user_id', friend.id).in('conversation_id', myConvIds)

        if (shared?.length) {
          for (const s of shared) {
            const { data: conv } = await supabase
              .from('conversations').select('id, type')
              .eq('id', s.conversation_id).eq('type', 'dm').maybeSingle()
            if (conv) {
              router.push(`/messages/${conv.id}` as any)
              setOpeningDMFor(null)
              return
            }
          }
        }
      }

      // ── Use RPC so both member rows are inserted with SECURITY DEFINER ──
      const { data: newConvId, error } = await supabase.rpc('create_dm_conversation', {
        other_user_id: friend.id,
      })

      if (error || !newConvId) {
        Alert.alert('Error', error?.message ?? 'Could not open chat')
        setOpeningDMFor(null)
        return
      }

      router.push(`/messages/${newConvId}` as any)
    } catch (e: any) {
      Alert.alert('Error', e.message)
    }
    setOpeningDMFor(null)
  }

  async function handleSearch(q: string) {
    setSearchQuery(q)
    if (!q.trim()) { setSearchResults([]); return }
    setSearching(true)
    try {
      const { data } = await supabase
        .from('users')
        .select('id, display_name, username')
        .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
        .neq('id', userId)
        .limit(20)

      const friendIds = new Set(friends.map(f => f.id))
      const incomingIds = new Set(pendingIn.map(p => p.requester_id))
      setSearchResults(
        (data ?? []).filter((u: any) => !friendIds.has(u.id) && !incomingIds.has(u.id)) as UserProfile[]
      )
    } catch (e) {
      console.log('search error', e)
    }
    setSearching(false)
  }

  async function sendRequest(target: UserProfile) {
    setActioningId(target.id)
    try {
      const { error } = await supabase.from('friends').insert({
        requester_id: userId,
        addressee_id: target.id,
        status: 'pending',
      })
      if (error) {
        Alert.alert('Error', error.message)
      } else {
        const { data: me } = await supabase
          .from('users').select('display_name, username').eq('id', userId).single()
        if (me) {
          await notifyFriendRequest(
            target.id,
            me.display_name || me.username || 'Someone',
            me.username || ''
          )
        }
        setPendingOut(prev => [...prev, target.id])
        Alert.alert('Request sent!', `Friend request sent to @${target.username}.`)
      }
    } catch (e: any) {
      Alert.alert('Error', e.message)
    }
    setActioningId(null)
  }

  async function acceptRequest(row: FriendRow) {
    setActioningId(row.id)
    await supabase.from('friends').update({ status: 'accepted' }).eq('id', row.id)
    const { data: me } = await supabase
      .from('users').select('display_name, username').eq('id', userId).single()
    if (me) {
      await notifyFriendAccepted(
        row.requester_id,
        me.display_name || me.username || 'Someone',
        me.username || ''
      )
    }
    setPendingIn(prev => prev.filter(p => p.id !== row.id))
    setFriends(prev => [...prev, row.profile])
    setActioningId(null)
  }

  async function declineRequest(row: FriendRow) {
    setActioningId(row.id)
    await supabase.from('friends').update({ status: 'declined' }).eq('id', row.id)
    setPendingIn(prev => prev.filter(p => p.id !== row.id))
    setActioningId(null)
  }

  async function removeFriend(profile: UserProfile) {
    Alert.alert(
      'Remove friend?',
      `Remove ${profile.display_name ?? '@' + profile.username}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive', onPress: async () => {
            await supabase.from('friends').delete()
              .or(`and(requester_id.eq.${userId},addressee_id.eq.${profile.id}),and(requester_id.eq.${profile.id},addressee_id.eq.${userId})`)
            setFriends(prev => prev.filter(f => f.id !== profile.id))
          },
        },
      ]
    )
  }

  function getSearchButtonState(user: UserProfile): 'add' | 'pending' | 'friends' {
    if (friends.find(f => f.id === user.id)) return 'friends'
    if (pendingOut.includes(user.id)) return 'pending'
    return 'add'
  }

  function addToTabLabel(tab: AddToTab) {
    if (tab === 'spaces') return '🏠 Spaces'
    if (tab === 'scrapbooks') return '📖 Scrapbooks'
    return '✈️ Trips'
  }

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Text style={st.headerTitle}>Friends</Text>
        {pendingIn.length > 0 && (
          <View style={st.badge}>
            <Text style={st.badgeText}>{pendingIn.length}</Text>
          </View>
        )}
      </View>

      <View style={st.tabRow}>
        {(['friends', 'requests', 'search'] as Tab[]).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[st.tab, activeTab === tab && st.tabActive]}
            onPress={() => setActiveTab(tab)}>
            <Text style={[st.tabText, activeTab === tab && st.tabTextActive]}>
              {tab === 'friends'
                ? `Friends${friends.length > 0 ? ` · ${friends.length}` : ''}`
                : tab === 'requests'
                ? `Requests${pendingIn.length > 0 ? ` · ${pendingIn.length}` : ''}`
                : 'Find People'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled">

        {/* ── FRIENDS TAB ── */}
        {activeTab === 'friends' && (
          <>
            {loading ? (
              <ActivityIndicator color="#C9956C" style={{ marginTop: 40 }} />
            ) : friends.length === 0 ? (
              <View style={st.emptyState}>
                <Text style={st.emptyEmoji}>👋</Text>
                <Text style={st.emptyTitle}>No friends yet</Text>
                <Text style={st.emptySub}>Find people in the Find People tab</Text>
                <TouchableOpacity style={st.emptyBtn} onPress={() => setActiveTab('search')}>
                  <Text style={st.emptyBtnText}>Find People</Text>
                </TouchableOpacity>
              </View>
            ) : (
              friends.map(f => (
                <TouchableOpacity
                  key={f.id}
                  style={st.row}
                  onLongPress={() => removeFriend(f)}
                  activeOpacity={0.8}>
                  <View style={st.avatar}>
                    <Text style={st.avatarText}>
                      {(f.display_name || f.username || '?')[0].toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.name}>{f.display_name || f.username}</Text>
                    <Text style={st.sub}>@{f.username}</Text>
                  </View>
                  <TouchableOpacity
                    style={[st.msgBtn, openingDMFor === f.id && { opacity: 0.5 }]}
                    onPress={() => openDM(f)}
                    disabled={openingDMFor === f.id}>
                    {openingDMFor === f.id
                      ? <ActivityIndicator color="#C9956C" size="small" />
                      : <Text style={st.msgBtnText}>✉️</Text>
                    }
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={st.addToBtn}
                    onPress={() => openAddTo(f)}>
                    <Text style={st.addToBtnText}>＋</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              ))
            )}
            {friends.length > 0 && (
              <Text style={st.hint}>Long press to remove · ＋ to add to a space, scrapbook, or trip</Text>
            )}
          </>
        )}

        {/* ── REQUESTS TAB ── */}
        {activeTab === 'requests' && (
          <>
            {pendingIn.length === 0 ? (
              <View style={st.emptyState}>
                <Text style={st.emptyEmoji}>📭</Text>
                <Text style={st.emptyTitle}>No pending requests</Text>
                <Text style={st.emptySub}>When someone sends you a request, it'll appear here</Text>
              </View>
            ) : (
              pendingIn.map(row => (
                <View key={row.id} style={st.row}>
                  <View style={st.avatar}>
                    <Text style={st.avatarText}>
                      {(row.profile.display_name || row.profile.username || '?')[0].toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.name}>{row.profile.display_name || row.profile.username}</Text>
                    <Text style={st.sub}>@{row.profile.username}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      style={[st.actionBtn, { backgroundColor: '#3D2E52' }]}
                      onPress={() => declineRequest(row)}
                      disabled={actioningId === row.id}>
                      <Text style={[st.actionBtnText, { color: '#9B8FAD' }]}>✕</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={st.actionBtn}
                      onPress={() => acceptRequest(row)}
                      disabled={actioningId === row.id}>
                      {actioningId === row.id
                        ? <ActivityIndicator color="#1A1118" size="small" />
                        : <Text style={st.actionBtnText}>✓ Accept</Text>
                      }
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </>
        )}

        {/* ── FIND PEOPLE TAB ── */}
        {activeTab === 'search' && (
          <>
            <View style={st.searchRow}>
              <Text style={st.at}>@</Text>
              <TextInput
                style={st.searchInput}
                placeholder="Search by username or name..."
                placeholderTextColor="#9B8FAD"
                value={searchQuery}
                onChangeText={handleSearch}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />
              {searching && <ActivityIndicator color="#C9956C" size="small" />}
              {searchQuery.length > 0 && !searching && (
                <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]) }}>
                  <Text style={{ color: '#9B8FAD', fontSize: 18 }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {!searchQuery.trim() && (
              <View style={st.emptyState}>
                <Text style={st.emptyEmoji}>🔍</Text>
                <Text style={st.emptyTitle}>Find your people</Text>
                <Text style={st.emptySub}>Search by username or display name</Text>
              </View>
            )}

            {searchQuery.trim() && searchResults.length === 0 && !searching && (
              <Text style={st.empty}>No users found for "{searchQuery}"</Text>
            )}

            {searchResults.map(u => {
              const state = getSearchButtonState(u)
              return (
                <View key={u.id} style={st.row}>
                  <View style={st.avatar}>
                    <Text style={st.avatarText}>
                      {(u.display_name || u.username || '?')[0].toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.name}>{u.display_name || u.username}</Text>
                    <Text style={st.sub}>@{u.username}</Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      st.actionBtn,
                      state !== 'add' && { backgroundColor: '#3D2E52' },
                    ]}
                    onPress={() => state === 'add' ? sendRequest(u) : undefined}
                    disabled={actioningId === u.id || state !== 'add'}>
                    {actioningId === u.id
                      ? <ActivityIndicator color="#1A1118" size="small" />
                      : <Text style={[
                          st.actionBtnText,
                          state !== 'add' && { color: '#9B8FAD' },
                        ]}>
                          {state === 'add' ? '+ Add' : state === 'pending' ? 'Pending' : '✓ Friends'}
                        </Text>
                    }
                  </TouchableOpacity>
                </View>
              )
            })}
          </>
        )}
      </ScrollView>

      {/* ── ADD-TO MODAL ── */}
      <Modal
        visible={!!addToFriend}
        transparent
        animationType="slide"
        onRequestClose={() => setAddToFriend(null)}>
        <View style={st.modalOverlay}>
          <View style={st.modalSheet}>
            <View style={st.modalHandle} />
            <Text style={st.modalTitle}>
              Add {addToFriend?.display_name || '@' + addToFriend?.username} to…
            </Text>
            <View style={st.addToTabRow}>
              {(['spaces', 'scrapbooks', 'trips'] as AddToTab[]).map(t => (
                <TouchableOpacity
                  key={t}
                  style={[st.addToTabBtn, addToTab === t && st.addToTabBtnActive]}
                  onPress={() => switchAddToTab(t)}>
                  <Text style={[st.addToTabText, addToTab === t && st.addToTabTextActive]}>
                    {addToTabLabel(t)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ paddingBottom: 8 }}>
              {addToLoading ? (
                <ActivityIndicator color="#C9956C" style={{ marginTop: 32 }} />
              ) : addToItems.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                  <Text style={{ color: '#9B8FAD', fontSize: 14 }}>
                    {addToTab === 'spaces'
                      ? 'No spaces found. Create one first.'
                      : addToTab === 'scrapbooks'
                      ? 'No scrapbooks found. Create one first.'
                      : 'No trips found. Create one first.'}
                  </Text>
                </View>
              ) : (
                addToItems.map(item => (
                  <View key={item.id} style={st.addToItem}>
                    <View style={st.addToItemAvatar}>
                      <Text style={{ color: '#C9956C', fontSize: 16, fontWeight: '800' }}>
                        {item.name[0].toUpperCase()}
                      </Text>
                    </View>
                    <Text style={st.addToItemName} numberOfLines={1}>{item.name}</Text>
                    <TouchableOpacity
                      style={[st.addToItemBtn, addingToId === item.id && { opacity: 0.5 }]}
                      onPress={() => addFriendTo(item)}
                      disabled={addingToId === item.id}>
                      {addingToId === item.id
                        ? <ActivityIndicator color="#1A1118" size="small" />
                        : <Text style={st.addToItemBtnText}>Add</Text>
                      }
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>
            <TouchableOpacity
              style={st.modalCloseBtn}
              onPress={() => setAddToFriend(null)}>
              <Text style={st.modalCloseBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1A1118' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    padding: 20, paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 34, fontWeight: '800', color: '#F5EEF8',
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
  },
  badge: {
    marginLeft: 10, backgroundColor: '#C9956C', borderRadius: 10,
    minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  badgeText: { color: '#1A1118', fontSize: 11, fontWeight: '800' },
  tabRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 16 },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: 9,
    borderRadius: 12, borderWidth: 1.5,
    borderColor: '#3D2E52', backgroundColor: '#2D2040',
  },
  tabActive: { borderColor: '#C9956C', backgroundColor: '#C9956C20' },
  tabText: { color: '#9B8FAD', fontWeight: '700', fontSize: 12 },
  tabTextActive: { color: '#C9956C' },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#2D2040', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 13,
    borderWidth: 1, borderColor: '#3D2E52', marginBottom: 16,
  },
  at: { color: '#9B8FAD', fontSize: 16, fontWeight: '700' },
  searchInput: { flex: 1, color: '#F5EEF8', fontSize: 15 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 12, borderBottomWidth: 1, borderColor: '#3D2E52',
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#3D2E52', alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#C9956C', fontSize: 18, fontWeight: '800' },
  name: { color: '#F5EEF8', fontSize: 15, fontWeight: '600' },
  sub: { color: '#9B8FAD', fontSize: 12, marginTop: 1 },
  actionBtn: {
    backgroundColor: '#C9956C', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  actionBtnText: { color: '#1A1118', fontWeight: '700', fontSize: 13 },
  msgBtn: {
    backgroundColor: '#2D2040', borderRadius: 10,
    padding: 8, borderWidth: 1, borderColor: '#3D2E52',
    width: 38, height: 38, alignItems: 'center', justifyContent: 'center',
  },
  msgBtnText: { fontSize: 18 },
  addToBtn: {
    backgroundColor: '#C9956C20', borderRadius: 10,
    padding: 8, borderWidth: 1, borderColor: '#C9956C60',
    width: 38, height: 38, alignItems: 'center', justifyContent: 'center',
  },
  addToBtnText: { color: '#C9956C', fontSize: 18, fontWeight: '700', lineHeight: 20 },
  empty: {
    color: '#9B8FAD', fontSize: 14, textAlign: 'center',
    marginTop: 16, fontStyle: 'italic',
  },
  hint: { color: '#9B8FAD', fontSize: 11, textAlign: 'center', marginTop: 16 },
  emptyState: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { color: '#F5EEF8', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptySub: { color: '#9B8FAD', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  emptyBtn: {
    marginTop: 24, backgroundColor: '#C9956C',
    borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12,
  },
  emptyBtnText: { color: '#1A1118', fontWeight: '700', fontSize: 15 },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#1A1118', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 44, borderTopWidth: 1, borderColor: '#3D2E52',
  },
  modalHandle: {
    width: 40, height: 4, backgroundColor: '#3D2E52',
    borderRadius: 2, alignSelf: 'center', marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18, fontWeight: '700', color: '#F5EEF8', marginBottom: 20, textAlign: 'center',
  },
  addToTabRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  addToTabBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 9,
    borderRadius: 12, borderWidth: 1.5,
    borderColor: '#3D2E52', backgroundColor: '#2D2040',
  },
  addToTabBtnActive: { borderColor: '#C9956C', backgroundColor: '#C9956C20' },
  addToTabText: { color: '#9B8FAD', fontWeight: '700', fontSize: 11 },
  addToTabTextActive: { color: '#C9956C' },
  addToItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: 1, borderColor: '#3D2E52',
  },
  addToItemAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#3D2E52', alignItems: 'center', justifyContent: 'center',
  },
  addToItemName: { flex: 1, color: '#F5EEF8', fontSize: 15, fontWeight: '600' },
  addToItemBtn: {
    backgroundColor: '#C9956C', borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  addToItemBtnText: { color: '#1A1118', fontWeight: '700', fontSize: 13 },
  modalCloseBtn: {
    marginTop: 20, backgroundColor: '#2D2040', borderRadius: 14,
    paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#3D2E52',
  },
  modalCloseBtnText: { color: '#9B8FAD', fontWeight: '600', fontSize: 15 },
})