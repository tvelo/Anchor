import { router } from 'expo-router'
import { useRef, useState } from 'react'
import {
    ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
    StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import { supabase } from '../lib/supabase'

export default function UsernameSetup() {
  const [username, setUsername] = useState('')
  const [available, setAvailable] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const valid = /^[a-z0-9_]{3,20}$/.test(username)

  function handleChange(val: string) {
    const clean = val.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)
    setUsername(clean)
    setAvailable(null)
    if (clean.length < 3) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => checkAvail(clean), 500)
  }

  async function checkAvail(uname: string) {
    setChecking(true)
    const { data } = await supabase.from('users').select('id').eq('username', uname).maybeSingle()
    setAvailable(!data)
    setChecking(false)
  }

  async function handleSave() {
    if (!valid || !available) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }
    const { error } = await supabase.from('users').update({ username }).eq('id', user.id)
    if (error) {
      Alert.alert('Error', error.message)
      setSaving(false)
      return
    }
    router.replace('/(tabs)' as any)
  }

  const canSave = valid && available === true && !checking

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={s.card}>
        <Text style={s.logo}>Anchor</Text>
        <Text style={s.title}>Pick your @username</Text>
        <Text style={s.sub}>
          This is your unique handle — friends search for you by this.{'\n'}
          Your display name (nickname) stays separate.
        </Text>

        <View style={s.inputRow}>
          <Text style={s.at}>@</Text>
          <TextInput
            style={s.input}
            placeholder="username"
            placeholderTextColor="#9B8FAD"
            value={username}
            onChangeText={handleChange}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
          {checking && <ActivityIndicator color="#C9956C" size="small" />}
          {!checking && available === true && <Text style={{ color: '#5EBA8A', fontSize: 18 }}>✓</Text>}
          {!checking && available === false && <Text style={{ color: '#E05C5C', fontSize: 18 }}>✗</Text>}
        </View>

        {username.length > 0 && username.length < 3 && (
          <Text style={[s.hint, { color: '#9B8FAD' }]}>At least 3 characters</Text>
        )}
        {username.length >= 3 && !valid && (
          <Text style={[s.hint, { color: '#E05C5C' }]}>Only lowercase letters, numbers, underscores</Text>
        )}
        {valid && available === false && (
          <Text style={[s.hint, { color: '#E05C5C' }]}>@{username} is already taken</Text>
        )}
        {valid && available === true && (
          <Text style={[s.hint, { color: '#5EBA8A' }]}>@{username} is available!</Text>
        )}

        <TouchableOpacity
          style={[s.btn, !canSave && { opacity: 0.45 }]}
          onPress={handleSave}
          disabled={!canSave || saving}>
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>Continue</Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1A1118', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380 },
  logo: { fontSize: 36, fontWeight: '800', color: '#C9956C', textAlign: 'center', marginBottom: 8, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  title: { fontSize: 22, fontWeight: '800', color: '#F5EEF8', textAlign: 'center', marginBottom: 10 },
  sub: { fontSize: 13, color: '#9B8FAD', textAlign: 'center', lineHeight: 20, marginBottom: 32 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#2D2040', borderWidth: 1, borderColor: '#3D2E52',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, marginBottom: 8,
  },
  at: { color: '#9B8FAD', fontSize: 17, fontWeight: '600' },
  input: { flex: 1, color: '#F5EEF8', fontSize: 16 },
  hint: { fontSize: 12, marginBottom: 16, marginLeft: 2 },
  btn: { backgroundColor: '#C9956C', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 12 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
})