import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { supabase } from '../../../lib/supabase'

export default function JoinTrip() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [status, setStatus] = useState<'loading' | 'joining' | 'done' | 'error'>('loading')
  const [message, setMessage] = useState('Loading...')

  useEffect(() => {
    if (id) handleJoin()
  }, [id])

  const handleJoin = async () => {
    setStatus('joining')
    setMessage('Joining travel capsule...')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setStatus('error')
        setMessage('You need to be logged in to join.')
        return
      }

      const { data: capsule, error: capErr } = await supabase
        .from('travel_capsules')
        .select('id, name')
        .eq('id', id)
        .maybeSingle()

      if (capErr || !capsule) {
        setStatus('error')
        setMessage('Capsule not found or link has expired.')
        return
      }

      const { data: existing } = await supabase
        .from('travel_capsule_members')
        .select('id')
        .eq('capsule_id', id)
        .eq('user_id', user.id)
        .maybeSingle()

      if (!existing) {
        const { error: insertErr } = await supabase
          .from('travel_capsule_members')
          .insert({ capsule_id: id, user_id: user.id, is_paid: false })

        if (insertErr) {
          setStatus('error')
          setMessage('Failed to join. Please try again.')
          return
        }
      }

      setStatus('done')
      setMessage(`You joined "${capsule.name}"! ✈️`)

      setTimeout(() => {
        router.replace('/(tabs)/trips')
      }, 1500)
    } catch (e: any) {
      setStatus('error')
      setMessage(e.message || 'Something went wrong.')
    }
  }

  const icon = status === 'done' ? '✈️' : status === 'error' ? '⚠️' : '✦'
  const color = status === 'error' ? '#E05C5C' : '#C8A96E'

  return (
    <View style={styles.root}>
      {status === 'loading' || status === 'joining'
        ? <ActivityIndicator color="#C8A96E" size="large" style={{ marginBottom: 20 }} />
        : <Text style={styles.icon}>{icon}</Text>
      }
      <Text style={[styles.message, { color }]}>{message}</Text>
      {status === 'error' && (
        <Text style={styles.sub} onPress={() => router.replace('/(tabs)/trips')}>
          Go to Trips →
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
