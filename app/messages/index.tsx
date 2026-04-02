import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator, Alert, FlatList, Modal,
  ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../lib/supabase'

type Friend = {
  id: string
  display_name: string | null
  username: string | null
}

type Conversation = {
  id: string
  type: 'dm' | 'group'
  name: string | null
  updated_at: string
  displayTitle: string
  avatarText: string
  subtitle: string
}

type ModalMode = 'dm' | 'group'

export default function MessagesIndexScreen() {
  const router = useRouter()
  const [userId, setUserId] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const [showNewMessage, setShowNewMessage] = useState(false)
  const [modalMode, setModalMode] = useState<ModalMode>('dm')

  const [friends, setFriends] = useState<Friend[]>([])
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [friendSearch, setFriendSearch] = useState('')

  const [groupName, setGroupName] = useState('')
  const [selectedMembers, setSelectedMembers] = useState<Friend[]>([])
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id || ''
      setUserId(uid)
      if (uid) loadConversations(uid)
    })
  }, [])

  function closeModal() {
    setShowNewMessage(false)
    setModalMode('dm')
    setFriendSearch('')
    setGroupName('')
    setSelectedMembers([])
    setFriends([])
  }

  async function openNewMessage() {
    setShowNewMessage(true)
    setFriendsLoading(true)
    try {
      const { data: accepted } = await supabase
        .from('friends')
        .select(`
          requester_id, addressee_id,
          requester:requester_id(id, display_name, username),
          addressee:addressee_id(id, display_name, username)
        `)
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
        .eq('status', 'accepted')

      const list = (accepted ?? []).map((f: any) =>
        f.requester_id === userId ? f.addressee : f.requester
      ) as Friend[]
      setFriends(list)
    } catch (e) {
      console.log('loadFriends error', e)
    }
    setFriendsLoading(false)
  }

  async function loadConversations(uid: string) {
    setIsLoading(true)
    try {
      const { data: members } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', uid)

      if (!members?.length) { setConversations([]); setIsLoading(false); return }

      const cIds = members.map(m => m.conversation_id)
      const { data: convs } = await supabase
        .from('conversations')
        .select('*')
        .in('id', cIds)
        .order('updated_at', { ascending: false })

      if (!convs?.length) { setConversations([]); setIsLoading(false); return }

      const { data: allMembers } = await supabase
        .from('conversation_members')
        .select('conversation_id, user_id')
        .in('conversation_id', cIds)

      const allUserIds = [...new Set(allMembers?.map(m => m.user_id) || [])]
      const { data: profiles } = await supabase
        .from('users')
        .select('id, display_name, username')
        .in('id', allUserIds)

      const profileMap: Record<string, any> = {}
      profiles?.forEach(p => { profileMap[p.id] = p })

      const assembled: Conversation[] = convs.map(c => {
        let displayTitle = c.name || 'Chat'
        let avatarText = '?'
        let subtitle = 'Tap to open'

        if (c.type === 'group') {
          avatarText = (c.name || 'G')[0].toUpperCase()
          const memberCount = allMembers?.filter(m => m.conversation_id === c.id).length ?? 0
          subtitle = `${memberCount} members`
        } else {
          const other = allMembers?.find(m => m.conversation_id === c.id && m.user_id !== uid)
          if (other) {
            const p = profileMap[other.user_id]
            displayTitle = p?.display_name?.trim() || 'Unknown'
            avatarText = displayTitle[0]?.toUpperCase() || '?'
            subtitle = p?.username ? `@${p.username}` : 'Tap to open'
          }
        }

        return { ...c, displayTitle, avatarText, subtitle }
      })

      setConversations(assembled)
    } catch (e) {
      console.log('loadConversations error', e)
    }
    setIsLoading(false)
  }

  async function handleStartDM(friend: Friend) {
    if (starting) return
    setStarting(true)
    try {
      // Check for existing DM first
      const { data: myMemberships } = await supabase
        .from('conversation_members').select('conversation_id').eq('user_id', userId)
      const myConvIds = (myMemberships ?? []).map(m => m.conversation_id)

      if (myConvIds.length > 0) {
        const { data: theirMemberships } = await supabase
          .from('conversation_members').select('conversation_id')
          .eq('user_id', friend.id).in('conversation_id', myConvIds)

        if (theirMemberships?.length) {
          const { data: existingConv } = await supabase
            .from('conversations').select('id, type')
            .eq('id', theirMemberships[0].conversation_id)
            .eq('type', 'dm')
            .maybeSingle()

          if (existingConv) {
            closeModal()
            router.push(`/messages/${existingConv.id}` as any)
            setStarting(false)
            return
          }
        }
      }

      // ── Use RPC so both member rows are inserted with SECURITY DEFINER ──
      const { data: newConvId, error } = await supabase.rpc('create_dm_conversation', {
        other_user_id: friend.id,
      })

      if (error || !newConvId) {
        Alert.alert('Error', error?.message ?? 'Could not create conversation')
        setStarting(false)
        return
      }

      closeModal()
      router.push(`/messages/${newConvId}` as any)
    } catch (e: any) {
      Alert.alert('Error', e.message)
    }
    setStarting(false)
  }

  async function handleCreateGroup() {
    if (!groupName.trim()) { Alert.alert('Enter a group name'); return }
    if (selectedMembers.length < 1) { Alert.alert('Add at least one friend'); return }
    setCreatingGroup(true)
    try {
      // ── Use RPC so all member rows are inserted with SECURITY DEFINER ──
      const { data: newConvId, error } = await supabase.rpc('create_group_conversation', {
        group_name: groupName.trim(),
        member_ids: selectedMembers.map(m => m.id),
      })

      if (error || !newConvId) {
        Alert.alert('Error', error?.message ?? 'Could not create group')
        setCreatingGroup(false)
        return
      }

      closeModal()
      router.push(`/messages/${newConvId}` as any)
    } catch (e: any) {
      Alert.alert('Error', e.message)
    }
    setCreatingGroup(false)
  }

  function toggleMember(friend: Friend) {
    setSelectedMembers(prev =>
      prev.find(m => m.id === friend.id)
        ? prev.filter(m => m.id !== friend.id)
        : [...prev, friend]
    )
  }

  const filteredFriends = friends.filter(f => {
    const q = friendSearch.toLowerCase()
    return (
      f.display_name?.toLowerCase().includes(q) ||
      f.username?.toLowerCase().includes(q)
    )
  })

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <TouchableOpacity style={st.backBtn} onPress={() => router.back()}>
          <Text style={st.backBtnText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={st.headerTitle}>Messages</Text>
        <TouchableOpacity style={st.newBtn} onPress={openNewMessage}>
          <Text style={st.newBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={st.center}><ActivityIndicator color="#C9956C" /></View>
      ) : conversations.length === 0 ? (
        <View style={st.center}>
          <Text style={st.emptyEmoji}>✉️</Text>
          <Text style={st.emptyTitle}>No messages yet</Text>
          <Text style={st.emptySub}>Start a conversation with a friend</Text>
          <TouchableOpacity style={st.startBtn} onPress={openNewMessage}>
            <Text style={st.startBtnText}>New Message</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={c => c.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={st.row}
              onPress={() => router.push(`/messages/${item.id}` as any)}
              activeOpacity={0.7}>
              <View style={[st.avatar, item.type === 'group' && { backgroundColor: '#2D2040' }]}>
                <Text style={st.avatarText}>{item.avatarText}</Text>
              </View>
              <View style={st.rowText}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={st.rowTitle}>{item.displayTitle}</Text>
                  {item.type === 'group' && (
                    <View style={st.groupPill}>
                      <Text style={st.groupPillText}>group</Text>
                    </View>
                  )}
                </View>
                <Text style={st.rowSubtitle}>{item.subtitle}</Text>
              </View>
              <Text style={st.chevron}>›</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* New Message Modal */}
      <Modal visible={showNewMessage} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeModal}>
        <SafeAreaView style={st.modalSafe} edges={['top']}>
          <View style={st.modalHeader}>
            <TouchableOpacity onPress={closeModal}>
              <Text style={st.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={st.modalTitle}>
              {modalMode === 'dm' ? 'New Message' : 'New Group'}
            </Text>
            {modalMode === 'group' ? (
              <TouchableOpacity onPress={handleCreateGroup} disabled={creatingGroup}>
                <Text style={[st.modalCancel, { color: '#C9956C', fontWeight: '700' }]}>
                  {creatingGroup ? '…' : 'Create'}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 60 }} />
            )}
          </View>

          {/* Mode toggle */}
          <View style={st.modeRow}>
            <TouchableOpacity
              style={[st.modePill, modalMode === 'dm' && st.modePillActive]}
              onPress={() => setModalMode('dm')}>
              <Text style={[st.modePillText, modalMode === 'dm' && { color: '#C9956C' }]}>
                Direct Message
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.modePill, modalMode === 'group' && st.modePillActive]}
              onPress={() => setModalMode('group')}>
              <Text style={[st.modePillText, modalMode === 'group' && { color: '#C9956C' }]}>
                Group Chat
              </Text>
            </TouchableOpacity>
          </View>

          {friendsLoading ? (
            <View style={st.center}>
              <ActivityIndicator color="#C9956C" />
            </View>
          ) : friends.length === 0 ? (
            <View style={st.center}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>👥</Text>
              <Text style={[st.emptyTitle, { fontSize: 16 }]}>No friends yet</Text>
              <Text style={[st.emptySub, { textAlign: 'center' }]}>
                Add friends first before you can message them
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">

              {modalMode === 'group' && (
                <>
                  <TextInput
                    style={st.groupNameInput}
                    placeholder="Group name..."
                    placeholderTextColor="#9B8FAD"
                    value={groupName}
                    onChangeText={setGroupName}
                    autoFocus
                  />
                  {selectedMembers.length > 0 && (
                    <View style={st.chipsRow}>
                      {selectedMembers.map(m => (
                        <TouchableOpacity
                          key={m.id} style={st.chip}
                          onPress={() => toggleMember(m)}>
                          <Text style={st.chipText}>{m.display_name || m.username}</Text>
                          <Text style={st.chipX}> ✕</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </>
              )}

              <View style={st.searchRow}>
                <Text style={{ fontSize: 15, opacity: 0.5 }}>🔍</Text>
                <TextInput
                  style={st.searchInput}
                  placeholder="Search friends..."
                  placeholderTextColor="#9B8FAD"
                  value={friendSearch}
                  onChangeText={setFriendSearch}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus={modalMode === 'dm'}
                />
              </View>

              {filteredFriends.length === 0 && friendSearch.trim() ? (
                <Text style={st.noResults}>No friends matching "{friendSearch}"</Text>
              ) : null}

              {filteredFriends.map(f => {
                const isSelected = selectedMembers.find(m => m.id === f.id)
                const letter = (f.display_name || f.username || '?')[0].toUpperCase()
                return (
                  <TouchableOpacity
                    key={f.id}
                    style={st.friendRow}
                    onPress={() => modalMode === 'dm' ? handleStartDM(f) : toggleMember(f)}
                    disabled={starting}
                    activeOpacity={0.7}>
                    <View style={st.friendAvatar}>
                      <Text style={st.friendAvatarText}>{letter}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={st.friendName}>{f.display_name || f.username}</Text>
                      <Text style={st.friendSub}>@{f.username}</Text>
                    </View>
                    {modalMode === 'dm' && (
                      starting
                        ? <ActivityIndicator color="#C9956C" size="small" />
                        : <Text style={st.actionText}>Message →</Text>
                    )}
                    {modalMode === 'group' && (
                      <View style={[
                        st.checkbox,
                        isSelected && { backgroundColor: '#C9956C', borderColor: '#C9956C' }
                      ]}>
                        {isSelected && <Text style={{ color: '#1A1118', fontWeight: '800', fontSize: 12 }}>✓</Text>}
                      </View>
                    )}
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1A1118' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderColor: '#3D2E52',
  },
  backBtn: { minWidth: 50 },
  backBtnText: { color: '#C9956C', fontSize: 16, fontWeight: '600' },
  headerTitle: { color: '#F5EEF8', fontSize: 18, fontWeight: '800' },
  newBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#C9956C', alignItems: 'center', justifyContent: 'center',
  },
  newBtnText: { color: '#1A1118', fontSize: 22, fontWeight: '600', lineHeight: 28 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { color: '#F5EEF8', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptySub: { color: '#9B8FAD', fontSize: 14, marginBottom: 24 },
  startBtn: { backgroundColor: '#C9956C', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  startBtnText: { color: '#1A1118', fontWeight: '700', fontSize: 15 },
  row: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
    backgroundColor: '#2D2040', borderRadius: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#3D2E52',
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#3D2E52', alignItems: 'center', justifyContent: 'center', marginRight: 16,
  },
  avatarText: { color: '#C9956C', fontSize: 20, fontWeight: '800' },
  rowText: { flex: 1 },
  rowTitle: { color: '#F5EEF8', fontSize: 16, fontWeight: '700', marginBottom: 2 },
  rowSubtitle: { color: '#9B8FAD', fontSize: 13 },
  groupPill: { backgroundColor: '#3D2E52', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  groupPillText: { color: '#9B8FAD', fontSize: 10, fontWeight: '700' },
  chevron: { color: '#9B8FAD', fontSize: 24 },
  modalSafe: { flex: 1, backgroundColor: '#1A1118' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderColor: '#3D2E52',
  },
  modalCancel: { color: '#9B8FAD', fontSize: 16, minWidth: 60 },
  modalTitle: { color: '#F5EEF8', fontSize: 17, fontWeight: '700' },
  modeRow: { flexDirection: 'row', margin: 16, marginBottom: 0, gap: 8 },
  modePill: {
    flex: 1, alignItems: 'center', paddingVertical: 9,
    borderRadius: 12, borderWidth: 1.5,
    borderColor: '#3D2E52', backgroundColor: '#2D2040',
  },
  modePillActive: { borderColor: '#C9956C', backgroundColor: '#C9956C20' },
  modePillText: { color: '#9B8FAD', fontWeight: '700', fontSize: 14 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#2D2040', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: '#3D2E52', gap: 8, marginBottom: 12,
  },
  searchInput: { flex: 1, color: '#F5EEF8', fontSize: 15 },
  groupNameInput: {
    backgroundColor: '#2D2040', borderWidth: 1, borderColor: '#3D2E52',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    color: '#F5EEF8', fontSize: 16, fontWeight: '600', marginBottom: 12,
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#C9956C20', borderWidth: 1,
    borderColor: '#C9956C60', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  chipText: { color: '#C9956C', fontSize: 13, fontWeight: '600' },
  chipX: { color: '#C9956C', fontSize: 13 },
  noResults: { color: '#9B8FAD', textAlign: 'center', marginTop: 20, fontStyle: 'italic' },
  friendRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, borderBottomWidth: 1, borderColor: '#3D2E52',
  },
  friendAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#3D2E52', alignItems: 'center', justifyContent: 'center',
  },
  friendAvatarText: { color: '#C9956C', fontSize: 18, fontWeight: '800' },
  friendName: { color: '#F5EEF8', fontSize: 15, fontWeight: '600' },
  friendSub: { color: '#9B8FAD', fontSize: 12, marginTop: 1 },
  actionText: { color: '#C9956C', fontSize: 13, fontWeight: '700' },
  checkbox: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: '#3D2E52',
    alignItems: 'center', justifyContent: 'center',
  },
})