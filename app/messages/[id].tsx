import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useEffect, useRef, useState } from 'react'
import {
  ActionSheetIOS, ActivityIndicator, Alert,
  KeyboardAvoidingView, Modal, Platform,
  ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import EmojiPicker from '../../components/EmojiPicker'
import { supabase } from '../../lib/supabase'

type Message = {
  id: string
  sender_id: string
  content: string
  type: string
  metadata: any
  created_at: string
  pending?: boolean
}

type Profile = {
  id: string
  display_name: string | null
  username: string | null
}

export default function ConversationScreen() {
  // ── Safely coerce id to plain string (Expo Router can return string[]) ──
  const { id: rawId } = useLocalSearchParams<{ id: string }>()
  const id = Array.isArray(rawId) ? rawId[0] : rawId

  const router = useRouter()

  const [userId, setUserId] = useState('')
  const [otherUserId, setOtherUserId] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [isGroup, setIsGroup] = useState(false)

  const [defaultName, setDefaultName] = useState('')
  const [chatName, setChatName] = useState('')

  const [reactingToId, setReactingToId] = useState<string | null>(null)
  const [showNicknameModal, setShowNicknameModal] = useState(false)
  const [nicknameInput, setNicknameInput] = useState('')

  // ── Typing & seen state ───────────────────────────────────────────────────
  const [otherUserTyping, setOtherUserTyping] = useState(false)
  const [otherLastRead, setOtherLastRead] = useState<string | null>(null)

  const scrollViewRef = useRef<ScrollView>(null)
  const inputRef = useRef<TextInput>(null)
  const inputValueRef = useRef('')
  const seenIds = useRef<Set<string>>(new Set())
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Auth ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user?.id) setUserId(data.user.id)
    })
  }, [])

  // ── Mark as read ──────────────────────────────────────────────────────────
  const markAsRead = async () => {
    if (!userId || !id) return
    await supabase
      .from('conversation_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', id)
      .eq('user_id', userId)
  }

  // ── Load chat ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId || !id) return

    const loadChat = async () => {
      setLoading(true)

      try {
        // Resolve conversation name
        const { data: conv } = await supabase
          .from('conversations')
          .select('id, type, name')
          .eq('id', id)
          .single()

        if (conv?.type === 'group') {
          setIsGroup(true)
          const name = conv.name || 'Group'
          setDefaultName(name)
          setChatName(name)
        } else {
          const { data: memberRows } = await supabase
            .from('conversation_members')
            .select('user_id')
            .eq('conversation_id', id)

          const otherId = memberRows?.find((m: any) => m.user_id !== userId)?.user_id
          if (otherId) {
            setOtherUserId(otherId)
            const { data: otherUser } = await supabase
              .from('users')
              .select('id, display_name, username')
              .eq('id', otherId)
              .single()
            const name = otherUser?.display_name || otherUser?.username || 'Chat'
            setDefaultName(name)
            setChatName(name)
          } else {
            setDefaultName('Chat')
            setChatName('Chat')
          }
        }

        // Load other user's last_read_at for seen receipts
        const { data: memberReadData } = await supabase
          .from('conversation_members')
          .select('user_id, last_read_at')
          .eq('conversation_id', id)

        const otherRead = memberReadData?.find((m: any) => m.user_id !== userId)?.last_read_at
        setOtherLastRead(otherRead || null)

        // Load messages
        const { data: msgs } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', id)
          .order('created_at', { ascending: true })

        if (msgs?.length) {
          msgs.forEach((m: any) => seenIds.current.add(m.id))
          setMessages(msgs)

          const senderIds = [...new Set(msgs.map((m: any) => m.sender_id))] as string[]
          const { data: profs } = await supabase
            .from('users')
            .select('id, display_name, username')
            .in('id', senderIds)

          if (profs) {
            const map: Record<string, Profile> = {}
            profs.forEach((p: any) => { map[p.id] = p })
            setProfiles(map)
          }
        }
      } catch (e) {
        console.log('[Conversation] loadChat error:', e)
      }

      setLoading(false)
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: false }), 120)

      // Mark as read on open
      await markAsRead()

      // ── Realtime channel with presence for typing ──────────────────────
      const channel = supabase
        .channel(`conv:${id}`, {
          config: { presence: { key: userId } },
        })
        // New messages
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` },
          async (payload) => {
            const newMsg = payload.new as Message
            if (seenIds.current.has(newMsg.id)) return
            seenIds.current.add(newMsg.id)
            setMessages(prev => [...prev, newMsg])

            // Load profile if unknown
            setProfiles(prev => {
              if (prev[newMsg.sender_id]) return prev
              supabase
                .from('users').select('id, display_name, username')
                .eq('id', newMsg.sender_id)
                .single()
                .then(({ data: p }) => {
                  if (p) setProfiles(pp => ({ ...pp, [p.id]: p }))
                })
              return prev
            })

            setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 80)

            // Mark as read when new message arrives
            await markAsRead()
          }
        )
        // Message updates (reactions etc.)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` },
          (payload) => {
            setMessages(prev =>
              prev.map(m => m.id === payload.new.id ? { ...m, ...payload.new } : m)
            )
          }
        )
        // Seen receipts — watch conversation_members for last_read_at updates
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${id}` },
          (payload) => {
            if (payload.new.user_id !== userId) {
              setOtherLastRead(payload.new.last_read_at || null)
            }
          }
        )
        // Typing indicators via presence
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState<{ typing: boolean }>()
          const otherTyping = Object.entries(state)
            .filter(([key]) => key !== userId)
            .some(([, presences]) => (presences as any)?.[0]?.typing === true)
          setOtherUserTyping(otherTyping)
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await channel.track({ typing: false })
          }
        })

      channelRef.current = channel
    }

    loadChat()

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    }
  }, [userId, id])

  // ── Typing handler ────────────────────────────────────────────────────────
  const handleInputChange = (t: string) => {
    inputValueRef.current = t

    if (channelRef.current) {
      channelRef.current.track({ typing: true })
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(async () => {
      if (channelRef.current) {
        await channelRef.current.track({ typing: false })
      }
    }, 2000)
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    const text = inputValueRef.current.trim()
    if (!text || !userId || sending) return
    if (!id || typeof id !== 'string') {
      console.warn('[Conversation] invalid conversation id, aborting send:', id)
      return
    }

    // Stop typing indicator immediately on send
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    if (channelRef.current) channelRef.current.track({ typing: false })

    inputRef.current?.clear()
    inputValueRef.current = ''
    setSending(true)

    const tempId = `temp-${Date.now()}`
    seenIds.current.add(tempId)

    setMessages(prev => [...prev, {
      id: tempId,
      sender_id: userId,
      content: text,
      type: 'text',
      metadata: { reactions: {} },
      created_at: new Date().toISOString(),
      pending: true,
    }])
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 80)

    try {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: id,
          sender_id: userId,
          content: text,
          type: 'text',
          metadata: { reactions: {} },
        })
        .select()
        .single()

      if (error) throw error

      seenIds.current.add(data.id)
      setMessages(prev => prev.map(m => m.id === tempId ? { ...data, pending: false } : m))

      supabase.from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', id)
        .then(() => {})
    } catch (e: any) {
      setMessages(prev => prev.filter(m => m.id !== tempId))
      seenIds.current.delete(tempId)
      inputRef.current?.setNativeProps({ text })
      inputValueRef.current = text
      console.log('[Conversation] send error:', e)
      Alert.alert('Could not send', 'Your message failed to send. Please try again.')
    }

    setSending(false)
  }

  // ── Reactions ─────────────────────────────────────────────────────────────
  const handleReaction = async (messageId: string, emoji: string) => {
    const msg = messages.find(m => m.id === messageId)
    if (!msg) return
    const reactions = { ...(msg.metadata?.reactions || {}) }
    if (reactions[userId] === emoji) delete reactions[userId]
    else reactions[userId] = emoji
    await supabase.from('messages')
      .update({ metadata: { ...msg.metadata, reactions } })
      .eq('id', messageId)
  }

  // ── Nickname ──────────────────────────────────────────────────────────────
  const openNicknameModal = () => {
    setNicknameInput(chatName === defaultName ? '' : chatName)
    setShowNicknameModal(true)
  }

  const saveNickname = () => {
    const trimmed = nicknameInput.trim()
    setChatName(trimmed || defaultName)
    setShowNicknameModal(false)
  }

  // ── Options ───────────────────────────────────────────────────────────────
  const handleOptions = () => {
    const dmOptions = ['Edit nickname', 'Pin chat', 'Unfriend', 'Block', 'Report', 'Cancel']
    const groupOptions = ['Edit nickname', 'Pin chat', 'Report', 'Cancel']
    const options = isGroup ? groupOptions : dmOptions

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: options.length - 1,
          destructiveButtonIndex: 2,
        },
        (idx) => {
          const picked = options[idx]
          if (picked === 'Edit nickname') openNicknameModal()
          else if (picked === 'Pin chat') Alert.alert('Pinned ✓', 'Chat pinned to the top.')
          else if (picked === 'Unfriend') confirmUnfriend()
          else if (picked === 'Block') confirmBlock()
          else if (picked === 'Report') confirmReport()
        }
      )
    } else {
      Alert.alert('Options', '', [
        { text: 'Edit nickname', onPress: openNicknameModal },
        { text: 'Pin chat', onPress: () => Alert.alert('Pinned ✓', 'Chat pinned.') },
        ...(!isGroup ? [
          { text: 'Unfriend', style: 'destructive' as const, onPress: confirmUnfriend },
          { text: 'Block', style: 'destructive' as const, onPress: confirmBlock },
        ] : []),
        { text: 'Report', style: 'destructive' as const, onPress: confirmReport },
        { text: 'Cancel', style: 'cancel' as const },
      ])
    }
  }

  const confirmUnfriend = () => {
    if (!otherUserId) return
    Alert.alert('Unfriend?', 'This will remove them from your friends.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unfriend', style: 'destructive', onPress: async () => {
          await supabase.from('friends').delete()
            .or(`and(requester_id.eq.${userId},addressee_id.eq.${otherUserId}),and(requester_id.eq.${otherUserId},addressee_id.eq.${userId})`)
          router.back()
        },
      },
    ])
  }

  const confirmBlock = () => {
    Alert.alert('Block user?', "They won't be able to message you or find your profile.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block', style: 'destructive', onPress: async () => {
          await supabase.from('friends').delete()
            .or(`and(requester_id.eq.${userId},addressee_id.eq.${otherUserId}),and(requester_id.eq.${otherUserId},addressee_id.eq.${userId})`)
          Alert.alert('Blocked', 'User has been blocked.')
          router.back()
        },
      },
    ])
  }

  const confirmReport = () => {
    Alert.alert('Report', "What's the issue?", [
      { text: 'Spam', onPress: () => Alert.alert('Reported', 'Thanks, we\'ll review this.') },
      { text: 'Harassment', onPress: () => Alert.alert('Reported', 'Thanks, we\'ll review this.') },
      { text: 'Inappropriate content', onPress: () => Alert.alert('Reported', 'Thanks, we\'ll review this.') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // ── Seen receipt: last message I sent that the other user has read ─────────
  const sentMessages = messages.filter(m => m.sender_id === userId && !m.pending)
  const lastSentMessage = sentMessages[sentMessages.length - 1]
  const lastSentIsSeen =
    !!otherLastRead &&
    !!lastSentMessage &&
    new Date(otherLastRead) >= new Date(lastSentMessage.created_at)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={st.safe} edges={['top', 'bottom']}>

      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity style={st.backBtn} onPress={() => router.back()}>
          <Text style={st.backBtnText}>‹ Back</Text>
        </TouchableOpacity>

        <TouchableOpacity style={st.headerCenter} onPress={openNicknameModal} activeOpacity={0.7}>
          <Text style={st.headerTitle} numberOfLines={1}>
            {chatName || defaultName || '…'}
          </Text>
          {chatName && defaultName && chatName !== defaultName && (
            <Text style={st.headerSub} numberOfLines={1}>{defaultName}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={st.optionsBtn}
          onPress={handleOptions}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={st.optionsDots}>•••</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>

        {loading ? (
          <View style={st.center}><ActivityIndicator color="#C9956C" /></View>
        ) : (
          <ScrollView
            ref={scrollViewRef}
            style={st.messagesList}
            contentContainerStyle={{ paddingBottom: 20 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive">

            {messages.length === 0 ? (
              <Text style={st.emptyText}>Say hello 👋</Text>
            ) : (
              messages.map((msg, i) => {
                const isMe = msg.sender_id === userId
                const prof = profiles[msg.sender_id]
                const name = prof?.display_name || prof?.username || 'Unknown'
                const prevMsg = i > 0 ? messages[i - 1] : null
                const isNewSender = prevMsg?.sender_id !== msg.sender_id
                const isLastSent = lastSentMessage?.id === msg.id

                return (
                  <View
                    key={msg.id}
                    style={[
                      st.msgRow,
                      isMe ? st.msgRight : st.msgLeft,
                      { marginTop: isNewSender ? 14 : 3 },
                    ]}>
                    {!isMe && isNewSender && (
                      <Text style={st.senderName}>{name}</Text>
                    )}
                    <View>
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onLongPress={() => setReactingToId(msg.id)}
                        style={[
                          st.bubble,
                          isMe ? st.bubbleRight : st.bubbleLeft,
                          msg.pending && { opacity: 0.5 },
                        ]}>
                        <Text style={[st.msgText, { color: isMe ? '#1A1118' : '#F5EEF8' }]}>
                          {msg.content}
                        </Text>
                      </TouchableOpacity>

                      {msg.metadata?.reactions && Object.keys(msg.metadata.reactions).length > 0 && (
                        <View style={[st.reactionBadge, isMe ? { right: 0 } : { left: 0 }]}>
                          {Array.from(new Set(Object.values(msg.metadata.reactions)))
                            .slice(0, 3).map((e: any, idx) => (
                              <Text key={idx} style={{ fontSize: 10 }}>{e}</Text>
                            ))}
                          <Text style={st.reactionCount}>
                            {Object.keys(msg.metadata.reactions).length}
                          </Text>
                        </View>
                      )}

                      {reactingToId === msg.id && (
                        <EmojiPicker
                          onSelect={(emoji) => {
                            handleReaction(msg.id, emoji)
                            setReactingToId(null)
                          }}
                          onClose={() => setReactingToId(null)}
                        />
                      )}
                    </View>

                    {/* Time + seen receipt */}
                    <View style={[st.timeRow, isMe && { alignSelf: 'flex-end' }]}>
                      <Text style={st.timeText}>
                        {msg.pending ? 'Sending…' : formatTime(msg.created_at)}
                      </Text>
                      {isMe && isLastSent && lastSentIsSeen && !msg.pending && (
                        <Text style={st.seenText}>Seen</Text>
                      )}
                    </View>
                  </View>
                )
              })
            )}

            {/* Typing indicator */}
            {otherUserTyping && (
              <View style={[st.msgRow, st.msgLeft, { marginTop: 6 }]}>
                <View style={[st.bubble, st.bubbleLeft, st.typingBubble]}>
                  <Text style={st.typingDots}>• • •</Text>
                </View>
              </View>
            )}

          </ScrollView>
        )}

        {/* Input bar */}
        <View style={st.inputRow}>
          <TextInput
            ref={inputRef}
            style={st.input}
            placeholder="Type a message..."
            placeholderTextColor="#9B8FAD"
            onChangeText={handleInputChange}
            multiline
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[st.sendBtn, sending && { opacity: 0.4 }]}
            onPress={handleSend}
            disabled={sending}>
            {sending
              ? <ActivityIndicator color="#1A1118" size="small" />
              : <Text style={st.sendIcon}>↑</Text>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Nickname modal */}
      <Modal
        visible={showNicknameModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowNicknameModal(false)}>
        <View style={st.overlay}>
          <View style={st.nicknameBox}>
            <Text style={st.nicknameTitle}>Edit nickname</Text>
            <Text style={st.nicknameSub}>
              Only visible to you. Leave blank to reset to their name.
            </Text>
            <TextInput
              style={st.nicknameInput}
              placeholder={defaultName || 'Enter a nickname…'}
              placeholderTextColor="#9B8FAD"
              value={nicknameInput}
              onChangeText={setNicknameInput}
              autoFocus
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={saveNickname}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <TouchableOpacity
                style={[st.nicknameBtn, { backgroundColor: '#3D2E52' }]}
                onPress={() => setShowNicknameModal(false)}>
                <Text style={[st.nicknameBtnText, { color: '#9B8FAD' }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.nicknameBtn} onPress={saveNickname}>
                <Text style={st.nicknameBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
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
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderColor: '#3D2E52',
  },
  backBtn: { minWidth: 56 },
  backBtnText: { color: '#C9956C', fontSize: 16, fontWeight: '600' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#F5EEF8', fontSize: 16, fontWeight: '800' },
  headerSub: { color: '#9B8FAD', fontSize: 11, marginTop: 1 },
  optionsBtn: { minWidth: 56, alignItems: 'flex-end' },
  optionsDots: { color: '#9B8FAD', fontSize: 16, fontWeight: '800', letterSpacing: 2 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  messagesList: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  emptyText: { color: '#9B8FAD', textAlign: 'center', marginTop: 40, fontStyle: 'italic' },
  msgRow: { maxWidth: '80%' },
  msgLeft: { alignSelf: 'flex-start' },
  msgRight: { alignSelf: 'flex-end' },
  senderName: { color: '#9B8FAD', fontSize: 10, marginLeft: 4, marginBottom: 2 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleLeft: { backgroundColor: '#3D2E52', borderBottomLeftRadius: 4 },
  bubbleRight: { backgroundColor: '#C9956C', borderBottomRightRadius: 4 },
  msgText: { fontSize: 15, lineHeight: 20 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  timeText: { color: '#9B8FAD55', fontSize: 9 },
  seenText: { color: '#C9956C99', fontSize: 9, fontWeight: '600' },
  typingBubble: { paddingVertical: 8, paddingHorizontal: 16 },
  typingDots: { color: '#9B8FAD', fontSize: 16, letterSpacing: 3 },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 12, paddingVertical: 10,
    gap: 8, borderTopWidth: 1, borderColor: '#3D2E52',
    backgroundColor: '#1A1118',
  },
  input: {
    flex: 1, backgroundColor: '#2D2040', borderRadius: 20,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
    color: '#F5EEF8', fontSize: 15,
    maxHeight: 120, minHeight: 40,
    borderWidth: 1, borderColor: '#3D2E52',
  },
  sendBtn: {
    backgroundColor: '#C9956C', width: 40, height: 40,
    borderRadius: 20, alignItems: 'center', justifyContent: 'center',
  },
  sendIcon: { color: '#1A1118', fontSize: 20, fontWeight: '800' },
  reactionBadge: {
    position: 'absolute', bottom: -8,
    backgroundColor: '#3D2E52', borderWidth: 1, borderColor: '#C9956C80',
    borderRadius: 10, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 6, paddingVertical: 2, gap: 2, zIndex: 10,
  },
  reactionCount: { color: '#F5EEF8', fontSize: 10, fontWeight: '700', marginLeft: 2 },
  overlay: {
    flex: 1, backgroundColor: '#000000AA',
    justifyContent: 'center', alignItems: 'center', padding: 28,
  },
  nicknameBox: {
    backgroundColor: '#2D2040', borderRadius: 20,
    padding: 24, width: '100%',
    borderWidth: 1, borderColor: '#3D2E52',
  },
  nicknameTitle: { color: '#F5EEF8', fontSize: 17, fontWeight: '800', marginBottom: 6 },
  nicknameSub: { color: '#9B8FAD', fontSize: 13, lineHeight: 18, marginBottom: 16 },
  nicknameInput: {
    backgroundColor: '#1A1118', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    color: '#F5EEF8', fontSize: 15,
    borderWidth: 1, borderColor: '#3D2E52', marginBottom: 8,
  },
  nicknameBtn: {
    flex: 1, backgroundColor: '#C9956C',
    borderRadius: 12, paddingVertical: 12, alignItems: 'center',
  },
  nicknameBtnText: { color: '#1A1118', fontWeight: '700', fontSize: 15 },
})