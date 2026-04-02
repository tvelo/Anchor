import { router } from 'expo-router'
import { useRef, useState } from 'react'
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import { supabase } from '../../lib/supabase'

const RULES = [
  { key: 'length', label: 'At least 8 characters',     test: (p: string) => p.length >= 8 },
  { key: 'upper',  label: 'One uppercase letter (A–Z)', test: (p: string) => /[A-Z]/.test(p) },
  { key: 'lower',  label: 'One lowercase letter (a–z)', test: (p: string) => /[a-z]/.test(p) },
  { key: 'digit',  label: 'One number (0–9)',            test: (p: string) => /[0-9]/.test(p) },
]
function score(p: string) { return RULES.filter(r => r.test(p)).length }

function StrengthBar({ password }: { password: string }) {
  if (!password) return null
  const s = score(password)
  const colors = ['', '#E05C5C', '#E09B5C', '#C9956C', '#5EBA8A']
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong']
  return (
    <View style={{ marginTop: 8, marginBottom: 4 }}>
      <View style={{ flexDirection: 'row', gap: 4, marginBottom: 5 }}>
        {[1, 2, 3, 4].map(i => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= s ? colors[s] : '#3D2E52' }} />
        ))}
      </View>
      <Text style={{ fontSize: 11, color: colors[s], fontWeight: '600' }}>{labels[s]}</Text>
    </View>
  )
}

function PasswordRules({ password }: { password: string }) {
  if (!password) return null
  return (
    <View style={r.box}>
      {RULES.map(rule => {
        const ok = rule.test(password)
        return (
          <View key={rule.key} style={r.row}>
            <Text style={[r.icon, { color: ok ? '#5EBA8A' : '#9B8FAD' }]}>{ok ? '✓' : '○'}</Text>
            <Text style={[r.label, { color: ok ? '#5EBA8A' : '#9B8FAD' }]}>{rule.label}</Text>
          </View>
        )
      })}
    </View>
  )
}

const r = StyleSheet.create({
  box: { backgroundColor: '#2D2040', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#3D2E52', marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  icon: { fontSize: 13, width: 16 },
  label: { fontSize: 12 },
})

export default function Signup() {
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null)
  const [checkingUsername, setCheckingUsername] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [passwordFocused, setPasswordFocused] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const passwordScore = score(password)
  const allRulesPassed = passwordScore === 4
  const usernameValid = /^[a-z0-9_]{3,20}$/.test(username)

  function handleUsernameChange(val: string) {
    const clean = val.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)
    setUsername(clean)
    setUsernameAvailable(null)
    if (clean.length < 3) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => checkUsernameAvail(clean), 500)
  }

  async function checkUsernameAvail(uname: string) {
    setCheckingUsername(true)
    const { data } = await supabase.from('users').select('id').eq('username', uname).maybeSingle()
    setUsernameAvailable(!data)
    setCheckingUsername(false)
  }

  function usernameStatus() {
    if (!username || username.length < 3) return null
    if (!usernameValid) return { ok: false, msg: 'Only lowercase letters, numbers, underscores (3–20 chars)' }
    if (checkingUsername) return null
    if (usernameAvailable === true) return { ok: true, msg: '@' + username + ' is available ✓' }
    if (usernameAvailable === false) return { ok: false, msg: '@' + username + ' is already taken' }
    return null
  }

  async function handleSignup() {
    if (!name.trim() || !username || !email.trim() || !password) {
      Alert.alert('Fill in all fields'); return
    }
    if (!usernameValid) {
      Alert.alert('Invalid username', 'Only lowercase letters, numbers, and underscores (3–20 chars).'); return
    }
    if (!usernameAvailable) {
      Alert.alert('Username taken', 'Pick a different username.'); return
    }
    if (!allRulesPassed) {
      Alert.alert('Password too weak', 'Must have 8+ characters, uppercase, lowercase, and a number.'); return
    }
    setLoading(true)
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: name.trim() } },
    })
    if (error) {
      Alert.alert('Sign up failed', error.message)
      setLoading(false)
      return
    }
    if (data.user) {
      await supabase.from('users').upsert({
        id: data.user.id,
        display_name: name.trim(),
        username: username.toLowerCase(),
        onboarding_complete: false,
      })
    }
    setLoading(false)
    if (data.session) {
      router.replace('/onboarding' as any)
    } else {
      Alert.alert(
        'Check your email ✉️',
        `We sent a confirmation link to ${email.trim()}. After confirming, sign in and we'll get you set up.`,
        [{ text: 'Go to Sign In', onPress: () => router.replace('/(auth)/login' as any) }]
      )
    }
  }

  const status = usernameStatus()

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={s.logo}>Anchor</Text>
        <Text style={s.tagline}>Create your space</Text>

        {/* Display name (nickname) */}
        <TextInput style={s.input} placeholder="Display name (nickname)" placeholderTextColor="#9B8FAD"
          value={name} onChangeText={setName} autoComplete="name" />

        {/* Unique username */}
        <View style={{ width: '100%', maxWidth: 380 }}>
          <View style={[s.input, s.usernameRow]}>
            <Text style={s.atSign}>@</Text>
            <TextInput
              style={s.usernameInput}
              placeholder="username"
              placeholderTextColor="#9B8FAD"
              value={username}
              onChangeText={handleUsernameChange}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {checkingUsername && <ActivityIndicator color="#C9956C" size="small" />}
            {!checkingUsername && usernameAvailable === true && <Text style={{ color: '#5EBA8A', fontSize: 16 }}>✓</Text>}
            {!checkingUsername && usernameAvailable === false && <Text style={{ color: '#E05C5C', fontSize: 16 }}>✗</Text>}
          </View>
          {status && (
            <Text style={[s.usernameHint, { color: status.ok ? '#5EBA8A' : '#E05C5C' }]}>{status.msg}</Text>
          )}
          {!status && username.length > 0 && (
            <Text style={s.usernameHint}>Friends will find you by your @username</Text>
          )}
        </View>

        <TextInput style={s.input} placeholder="Email" placeholderTextColor="#9B8FAD"
          value={email} onChangeText={setEmail} autoCapitalize="none"
          keyboardType="email-address" autoComplete="email" />

        <View style={s.passwordRow}>
          <TextInput
            style={[s.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Password" placeholderTextColor="#9B8FAD"
            value={password} onChangeText={setPassword}
            secureTextEntry={!showPassword}
            onFocus={() => setPasswordFocused(true)}
            onBlur={() => setPasswordFocused(false)}
            autoComplete="new-password"
          />
          <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPassword(v => !v)}>
            <Text style={{ fontSize: 18 }}>{showPassword ? '🙈' : '👁️'}</Text>
          </TouchableOpacity>
        </View>

        <StrengthBar password={password} />
        {(passwordFocused || (password.length > 0 && !allRulesPassed)) && (
          <PasswordRules password={password} />
        )}

        <TouchableOpacity
          style={[s.btn, (!allRulesPassed || !usernameAvailable) && s.btnDisabled]}
          onPress={handleSignup} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Create account</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push('/(auth)/login' as any)}>
          <Text style={s.link}>Already have an account? <Text style={{ color: '#C9956C' }}>Sign in</Text></Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1A1118' },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo: { fontSize: 42, fontWeight: '800', color: '#C9956C', textAlign: 'center', marginBottom: 6, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  tagline: { fontSize: 14, color: '#9B8FAD', textAlign: 'center', marginBottom: 40 },
  input: { width: '100%', maxWidth: 380, backgroundColor: '#2D2040', borderWidth: 1, borderColor: '#3D2E52', borderRadius: 12, padding: 14, color: '#F5EEF8', fontSize: 15, marginBottom: 12 },
  usernameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  atSign: { color: '#9B8FAD', fontSize: 16, fontWeight: '600' },
  usernameInput: { flex: 1, color: '#F5EEF8', fontSize: 15 },
  usernameHint: { fontSize: 12, marginBottom: 12, marginLeft: 4, color: '#9B8FAD' },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%', maxWidth: 380 },
  eyeBtn: { padding: 14, backgroundColor: '#2D2040', borderRadius: 12, borderWidth: 1, borderColor: '#3D2E52' },
  btn: { width: '100%', maxWidth: 380, backgroundColor: '#C9956C', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  link: { color: '#9B8FAD', textAlign: 'center', marginTop: 24, fontSize: 14 },
})