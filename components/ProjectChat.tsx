import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { supabase } from '../lib/supabase'
import EmojiPicker from './EmojiPicker'


type Message = {
  id: string
  user_id: string
  content: string
  type: string
  metadata: any
  created_at: string
}

type Profile = {
  first_name: string | null
  last_name: string | null
  avatar_url: string | null
}

type ProjectChatProps = {
  visible: boolean
  onClose: () => void
  projectType: 'space' | 'scrapbook' | 'capsule'
  projectId: string
  currentUserId: string
}

export default function ProjectChat({ visible, onClose, projectType, projectId, currentUserId }: ProjectChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [reactingToId, setReactingToId] = useState<string | null>(null)
  const scrollViewRef = useRef<ScrollView>(null)

  useEffect(() => {
    if (!visible || !projectId) return
    let channel: any

    const loadChat = async () => {
      setLoading(true)
      // Load messages
      const { data: msgs } = await supabase
        .from('project_messages')
        .select('*')
        .eq('project_type', projectType)
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })
      
      if (msgs) {
        setMessages(msgs)
        // Load profiles for users
        const userIds = [...new Set(msgs.map(m => m.user_id))] as string[]
        if (userIds.length > 0) {
          const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name, avatar_url').in('id', userIds)
          if (profs) {
            const map: Record<string, Profile> = {}
            profs.forEach(p => { map[p.id] = p })
            setProfiles(map)
          }
        }
      }
      setLoading(false)

      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: false }), 100)

      // Subscribe to new messages
      channel = supabase.channel(`chat_${projectId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_messages', filter: `project_id=eq.${projectId}` }, async (payload) => {
        const newMsg = payload.new as Message
        setMessages(prev => {
          if (prev.some(m => m.id === newMsg.id)) return prev
          return [...prev, newMsg]
        })
        // Load profile if missing
        if (!profiles[newMsg.user_id]) {
          const { data: p } = await supabase.from('profiles').select('id, first_name, last_name, avatar_url').eq('id', newMsg.user_id).single()
          if (p) setProfiles(prev => ({ ...prev, [p.id]: p }))
        }
        setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100)
      })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'project_messages', filter: `project_id=eq.${projectId}` }, async (payload) => {
           setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...m, ...payload.new } : m))
        })
        .subscribe()
    }

    loadChat()

    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [visible, projectId, projectType])

  const handleReaction = async (message_id: string, emoji: string) => {
    const msg = messages.find(m => m.id === message_id)
    if (!msg) return
    
    const reactions = { ...(msg.metadata?.reactions || {}) }
    if (reactions[currentUserId] === emoji) {
      delete reactions[currentUserId]
    } else {
      reactions[currentUserId] = emoji
    }
    
    await supabase.from('project_messages').update({ 
      metadata: { ...msg.metadata, reactions } 
    }).eq('id', message_id)
  }

  const handleSend = async () => {
    if (!input.trim()) return
    const currentInput = input.trim()
    setInput('')
    
    const { data, error } = await supabase.from('project_messages').insert({
      project_type: projectType,
      project_id: projectId,
      user_id: currentUserId,
      content: currentInput,
      type: 'text',
    }).select('*').single()
    
    if (error) {
      console.error('Send error', error)
      setInput(currentInput)
      Alert.alert('Message failed', error.message ?? 'Check your connection and try again.')
    } else if (data) {
      setMessages(prev => [...prev, data as Message])
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100)
    }
  }

  function formatTime(iso: string) {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={st.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={st.sheet}>
          <View style={st.header}>
            <Text style={st.title}>Chat</Text>
            <TouchableOpacity onPress={onClose} style={st.closeBtn}>
              <Text style={st.closeIcon}>✕</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={st.loadingWrap}><ActivityIndicator color="#C9956C" /></View>
          ) : (
            <ScrollView style={st.messagesList} ref={scrollViewRef} contentContainerStyle={{ paddingBottom: 16 }}>
              {messages.length === 0 ? (
                <Text style={st.emptyText}>Be the first to send a message!</Text>
              ) : (
                messages.map((msg, i) => {
                  const isMe = msg.user_id === currentUserId
                  const prof = profiles[msg.user_id]
                  const name = prof?.first_name || 'Unknown'
                  
                  const prevMsg = i > 0 ? messages[i - 1] : null
                  const isBrandNewSender = prevMsg?.user_id !== msg.user_id
                  
                  return (
                    <View key={msg.id} style={[st.msgRow, isMe ? st.msgRight : st.msgLeft, { marginTop: isBrandNewSender ? 12 : 4 }]}>
                      {!isMe && isBrandNewSender && <Text style={st.senderName}>{name}</Text>}
                      
                      <View style={{ position: 'relative' }}>
                        <TouchableOpacity 
                          activeOpacity={0.9}
                          onLongPress={() => setReactingToId(msg.id)}
                          style={[st.bubble, isMe ? st.bubbleRight : st.bubbleLeft]}
                        >
                          <Text style={[st.msgText, isMe ? { color: '#000' } : { color: '#F5EEF8' }]}>{msg.content}</Text>
                        </TouchableOpacity>

                        {msg.metadata?.reactions && Object.keys(msg.metadata.reactions).length > 0 && (
                          <View style={[st.reactionBadge, isMe ? { right: 0 } : { left: 0 }]}>
                            {Array.from(new Set(Object.values(msg.metadata.reactions))).slice(0, 3).map((e: any, idx) => (
                              <Text key={idx} style={{ fontSize: 10 }}>{e}</Text>
                            ))}
                            <Text style={st.reactionCount}>{Object.keys(msg.metadata.reactions).length}</Text>
                          </View>
                        )}

                        {reactingToId === msg.id && (
                          <EmojiPicker 
                            onSelect={(emoji) => handleReaction(msg.id, emoji)}
                            onClose={() => setReactingToId(null)}
                          />
                        )}
                      </View>
                      
                      <Text style={st.timeText}>{formatTime(msg.created_at)}</Text>
                    </View>
                  )
                })
              )}
            </ScrollView>
          )}

          <View style={st.inputRow}>
            <TextInput
              style={st.input}
              placeholder="Type a message..."
              placeholderTextColor="#9B8FAD"
              value={input}
              onChangeText={setInput}
              multiline
            />
            <TouchableOpacity style={st.sendBtn} onPress={handleSend} disabled={!input.trim()}>
              <Text style={[st.sendIcon, !input.trim() && { opacity: 0.3 }]}>↑</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const st = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#1A1118',
    height: '80%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1, borderColor: '#3D2E52', borderBottomWidth: 0,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1, borderColor: '#3D2E52',
    backgroundColor: '#2D2040'
  },
  title: { color: '#F5EEF8', fontSize: 16, fontWeight: '800' },
  closeBtn: { padding: 4 },
  closeIcon: { color: '#9B8FAD', fontSize: 18, fontWeight: '800' },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  messagesList: { flex: 1, padding: 16 },
  emptyText: { color: '#9B8FAD', textAlign: 'center', marginTop: 40, fontStyle: 'italic' },
  
  msgRow: { maxWidth: '80%' },
  msgLeft: { alignSelf: 'flex-start' },
  msgRight: { alignSelf: 'flex-end' },
  senderName: { color: '#9B8FAD', fontSize: 10, marginLeft: 4, marginBottom: 2 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleLeft: { backgroundColor: '#3D2E52', borderBottomLeftRadius: 4 },
  bubbleRight: { backgroundColor: '#C9956C', borderBottomRightRadius: 4 },
  msgText: { fontSize: 15, lineHeight: 20 },
  timeText: { color: '#9B8FAD80', fontSize: 9, alignSelf: 'flex-end', marginTop: 2 },
  
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    padding: 16, paddingBottom: 32, gap: 8,
    borderTopWidth: 1, borderColor: '#3D2E52',
    backgroundColor: '#221A2C'
  },
  input: {
    flex: 1, backgroundColor: '#1A1118', borderRadius: 20,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
    color: '#F5EEF8', fontSize: 15,
    maxHeight: 120, minHeight: 40
  },
  sendBtn: {
    backgroundColor: '#C9956C', width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2
  },
  sendIcon: { color: '#1A1118', fontSize: 20, fontWeight: '800' },
  reactionBadge: {
    position: 'absolute',
    bottom: -8,
    backgroundColor: '#3D2E52',
    borderWidth: 1,
    borderColor: '#C9956C80',
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 2,
    zIndex: 10,
  },
  reactionCount: { color: '#F5EEF8', fontSize: 10, fontWeight: '700', marginLeft: 2 }
})
