import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { supabase } from '../lib/supabase'

export default function BannedScreen({ reason }: { reason?: string }) {
  return (
    <View style={s.root}>
      <Text style={s.icon}>🚫</Text>
      <Text style={s.title}>Account suspended</Text>
      <Text style={s.sub}>
        {reason || 'Your account has been suspended. Please contact support if you believe this is a mistake.'}
      </Text>
      <Text style={s.email}>anchorhelpmobile@outlook.com</Text>
      <TouchableOpacity style={s.btn} onPress={() => supabase.auth.signOut()}>
        <Text style={s.btnText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E0E12', alignItems: 'center', justifyContent: 'center', padding: 40 },
  icon: { fontSize: 64, marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '800', color: '#F0EDE8', marginBottom: 12, textAlign: 'center' },
  sub: { fontSize: 15, color: '#8A8799', textAlign: 'center', lineHeight: 22, marginBottom: 12 },
  email: { fontSize: 13, color: '#C8A96E', marginBottom: 32 },
  btn: { backgroundColor: '#2A2A38', borderRadius: 12, paddingHorizontal: 28, paddingVertical: 13 },
  btnText: { color: '#8A8799', fontWeight: '600', fontSize: 15 },
})