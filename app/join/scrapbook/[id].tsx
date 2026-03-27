import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { supabase } from '../../../lib/supabase'

export default function JoinScrapbook() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [status, setStatus] = useState<'loading' | 'joining' | 'done' | 'error'>('loading')
  const [message, setMessage] = useState('Loading...')

  useEffect(() => {
    if (id) handleJoin()
  }, [id])

  const handleJoin = async () => {
    setStatus('joining')
    setMessage('Joining scrapbook...')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setStatus('error')
        setMessage('You need to be logged in to join.')
        return
      }

      // Check scrapbook exists
      const { data: book, error: bookErr } = await supabase
        .from('scrapbooks')
        .select('id, name, canvas_id')
        .eq('id', id)
        .maybeSingle()

      if (bookErr || !book) {
        setStatus('error')
        setMessage('Scrapbook not found or link has expired.')
        return
      }

      // Check not already a member
      const { data: existing } = await supabase
        .from('scrapbook_members')
        .select('id')
        .eq('scrapbook_id', id)
        .eq('user_id', user.id)
        .maybeSingle()

      if (!existing) {
        const { error: insertErr } = await supabase
          .from('scrapbook_members')
          .insert({ scrapbook_id: id, user_id: user.id, can_edit: false, invited_by: user.id })

        if (insertErr) {
          setStatus('error')
          setMessage('Failed to join. Please try again.')
          return
        }
      }

      setStatus('done')
      setMessage(`You joined "${book.name}"! ✦`)

      // Redirect to scrapbook tab after a beat
      setTimeout(() => {
        router.replace('/(tabs)/scrapbook')
      }, 1500)
    } catch (e: any) {
      setStatus('error')
      setMessage(e.message || 'Something went wrong.')
    }
  }

  const icon = status === 'done' ? '📖' : status === 'error' ? '⚠️' : '✦'
  const color = status === 'error' ? '#E05C5C' : '#C8A96E'

  return (
    <View style={styles.root}>
      {status === 'loading' || status === 'joining'
        ? <ActivityIndicator color="#C8A96E" size="large" style={{ marginBottom: 20 }} />
        : <Text style={[styles.icon]}>{icon}</Text>
      }
      <Text style={[styles.message, { color }]}>{message}</Text>
      {status === 'error' && (
        <Text style={styles.sub} onPress={() => router.replace('/(tabs)/scrapbook')}>
          Go to Scrapbook →
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E0E12', alignItems: 'center', justifyContent: 'center', padding: 40 },
  icon: { fontSize: 56, marginBottom: 20 },
  message: { fontSize: 18, fontWeight: '700', textAlign: 'center', lineHeight: 26 },
  sub: { marginTop: 20, color: '#8A8799', fontSize: 14, textDecorationLine: 'underline' },
})
