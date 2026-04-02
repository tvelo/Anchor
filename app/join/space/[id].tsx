import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { notifyMembers } from '../../../lib/network'
import { supabase } from '../../../lib/supabase'

export default function JoinSpace() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [status, setStatus] = useState<'loading' | 'joining' | 'done' | 'error'>('loading')
  const [message, setMessage] = useState('Loading...')

  useEffect(() => {
    if (id) handleJoin()
  }, [id])

  const handleJoin = async () => {
    setStatus('joining')
    setMessage('Joining space...')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setStatus('error')
        setMessage('You need to be logged in to join.')
        return
      }

      // Check space exists
      const { data: space, error: spaceErr } = await supabase
        .from('canvases')
        .select('id, name')
        .eq('id', id)
        .maybeSingle()

      if (spaceErr || !space) {
        setStatus('error')
        setMessage('Space not found or link has expired.')
        return
      }

      // Check not already a member
      const { data: existing } = await supabase
        .from('space_members')
        .select('id')
        .eq('space_id', id)
        .eq('user_id', user.id)
        .maybeSingle()

      if (!existing) {
        const { error: insertErr } = await supabase
          .from('space_members')
          .insert({ space_id: id, user_id: user.id, role: 'member' })

        if (insertErr) {
          // Try partner_id update as fallback (for single-partner canvas model)
          const { error: updateErr } = await supabase
            .from('canvases')
            .update({ partner_id: user.id })
            .eq('id', id)
            .is('partner_id', null)

          if (updateErr) {
            setStatus('error')
            setMessage('Failed to join. Please try again.')
            return
          }
        }

        // Notify space owner
        const { data: canvas } = await supabase.from('canvases').select('owner_id').eq('id', id).maybeSingle()
        if (canvas?.owner_id) {
          const { data: prof } = await supabase.from('social_profiles').select('display_name').eq('id', user.id).maybeSingle()
          notifyMembers({ type: 'space_join', target_user_id: canvas.owner_id, actor_id: user.id, actor_name: prof?.display_name ?? 'Someone', title: 'New member ✦', body: `${prof?.display_name ?? 'Someone'} joined "${space.name}"` }).catch(() => {})
        }
      }

      setStatus('done')
      setMessage(`You joined "${space.name}"! ✦`)

      setTimeout(() => {
        router.replace('/(tabs)/space')
      }, 1500)
    } catch (e: any) {
      setStatus('error')
      setMessage(e.message || 'Something went wrong.')
    }
  }

  const icon = status === 'done' ? '✦' : status === 'error' ? '⚠️' : '✦'
  const color = status === 'error' ? '#E05C5C' : '#C8A96E'

  return (
    <View style={styles.root}>
      {status === 'loading' || status === 'joining'
        ? <ActivityIndicator color="#C8A96E" size="large" style={{ marginBottom: 20 }} />
        : <Text style={styles.icon}>{icon}</Text>
      }
      <Text style={[styles.message, { color }]}>{message}</Text>
      {status === 'error' && (
        <Text style={styles.sub} onPress={() => router.replace('/(tabs)/space')}>
          Go to Space →
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
