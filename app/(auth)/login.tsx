import { router } from 'expo-router'
import { useState } from 'react'
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import { supabase } from '../../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    if (!email.trim() || !password) { Alert.alert('Fill in all fields'); return }
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) Alert.alert('Sign in failed', error.message)
    setLoading(false)
  }

  async function handleForgotPassword() {
    if (!email.trim()) { Alert.alert('Enter your email first'); return }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim())
    if (error) Alert.alert('Error', error.message)
    else Alert.alert('Reset link sent ✉️', `Check ${email.trim()} for a password reset link.`)
  }

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={s.card}>
        <Text style={s.logo}>Anchor</Text>
        <Text style={s.tagline}>Whatever your mind tells you.</Text>

        <TextInput
          style={s.input}
          placeholder="Email"
          placeholderTextColor="#9B8FAD"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />

        <View style={s.passwordRow}>
          <TextInput
            style={[s.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Password"
            placeholderTextColor="#9B8FAD"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoComplete="password"
          />
          <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPassword(v => !v)}>
            <Text style={{ fontSize: 18 }}>{showPassword ? '🙈' : '👁️'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={s.forgotBtn} onPress={handleForgotPassword}>
          <Text style={s.forgotText}>Forgot password?</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.btn} onPress={handleLogin} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>Sign in</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push('/(auth)/signup' as any)}>
          <Text style={s.link}>
            Don't have an account? <Text style={{ color: '#C9956C' }}>Sign up</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1A1118', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380 },
  logo: { fontSize: 42, fontWeight: '800', color: '#C9956C', textAlign: 'center', marginBottom: 6, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  tagline: { fontSize: 14, color: '#9B8FAD', textAlign: 'center', marginBottom: 40 },
  input: { backgroundColor: '#2D2040', borderWidth: 1, borderColor: '#3D2E52', borderRadius: 12, padding: 14, color: '#F5EEF8', fontSize: 15, marginBottom: 12 },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  eyeBtn: { padding: 14, backgroundColor: '#2D2040', borderRadius: 12, borderWidth: 1, borderColor: '#3D2E52' },
  forgotBtn: { alignSelf: 'flex-end', marginBottom: 16, marginTop: 4 },
  forgotText: { color: '#B8A9D9', fontSize: 13 },
  btn: { backgroundColor: '#C9956C', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  link: { color: '#9B8FAD', textAlign: 'center', marginTop: 24, fontSize: 14 },
})