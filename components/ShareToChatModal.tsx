import React, { useState, useEffect } from 'react'
import { Modal, View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { supabase } from '../lib/supabase'

type Conversation = {
  id: string
  name: string | null
  displayTitle?: string
}

type ShareToChatModalProps = {
  visible: boolean
  onClose: () => void
  currentUserId: string
  sharePayload: {
    type: 'widget_share' | 'scrapbook_share' | 'trip_share'
    content: string
    metadata: any
  }
}

export default function ShareToChatModal({ visible, onClose, currentUserId, sharePayload }: ShareToChatModalProps) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (visible && currentUserId) {
      loadChats()
    }
  }, [visible, currentUserId])

  async function loadChats() {
    setLoading(true)
    const { data: members } = await supabase.from('conversation_members').select('conversation_id').eq('user_id', currentUserId)
    if (!members?.length) { setLoading(false); return }
    const cIds = members.map(m => m.conversation_id)
    
    const { data: convs } = await supabase.from('conversations').select('*').in('id', cIds)
    if (!convs) { setLoading(false); return }

    const { data: allMembers } = await supabase.from('conversation_members').select('conversation_id, user_id').in('conversation_id', cIds)
    const { data: profiles } = await supabase.from('users').select('id, display_name').in('id', [...new Set(allMembers?.map(m => m.user_id) || [])])
    
    const profileMap: Record<string, any> = {}
    profiles?.forEach(p => { profileMap[p.id] = p })

    const assembled = convs.map(c => {
      let title = c.name
      if (!title && allMembers) {
        const otherMember = allMembers.find(m => m.conversation_id === c.id && m.user_id !== currentUserId)
        if (otherMember) {
          title = profileMap[otherMember.user_id]?.display_name || 'Unknown User'
        } else {
          title = 'Just You'
        }
      }
      return { ...c, displayTitle: title }
    })

    setConversations(assembled)
    setLoading(false)
  }

  async function handleShare(conversationId: string) {
    onClose()
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      user_id: currentUserId,
      content: sharePayload.content,
      type: sharePayload.type,
      metadata: sharePayload.metadata
    })
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={st.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={st.sheet}>
          <View style={st.header}>
            <Text style={st.title}>Share to Chat</Text>
            <TouchableOpacity onPress={onClose} style={st.closeBtn}>
              <Text style={st.closeIcon}>✕</Text>
            </TouchableOpacity>
          </View>
          
          {loading ? (
            <View style={st.center}><ActivityIndicator color="#C9956C" /></View>
          ) : conversations.length === 0 ? (
            <View style={st.center}>
              <Text style={st.emptyText}>No chats found.</Text>
            </View>
          ) : (
            <FlatList
              data={conversations}
              keyExtractor={c => c.id}
              contentContainerStyle={{ padding: 16 }}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={st.row}
                  onPress={() => handleShare(item.id)}
                >
                  <Text style={st.rowTitle}>{item.displayTitle}</Text>
                  <Text style={st.sendText}>Send</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const st = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#1A1118',
    height: '60%',
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#9B8FAD', fontSize: 14, fontStyle: 'italic' },
  
  row: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, backgroundColor: '#2D2040', 
    borderRadius: 16, marginBottom: 8,
    borderWidth: 1, borderColor: '#3D2E52'
  },
  rowTitle: { color: '#F5EEF8', fontSize: 16, fontWeight: '600' },
  sendText: { color: '#C9956C', fontSize: 14, fontWeight: '700' }
})
