import { AudioManagerProvider } from '../lib/AudioManager'
import { ThemeProvider } from '../lib/ThemeContext'
import { configureNotifications, registerForPushNotifications } from '../lib/notifications'
import { supabase } from '../lib/supabase'
import { Stack } from 'expo-router'
import { useEffect, useState } from 'react'
import BannedScreen from '../components/BannedScreen'

// Configure notification appearance — must be called before any notification fires
configureNotifications()

export default function RootLayout() {
  const [banStatus, setBanStatus] = useState<{ banned: boolean; reason?: string } | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    initApp()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        checkBan(session.user.id)
        registerForPushNotifications() // register each time they log in (token may rotate)
      } else {
        setBanStatus(null)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function initApp() {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await checkBan(user.id)
      // Don't block app start on push registration — it can hang in Expo Go
      registerForPushNotifications().catch(() => {})
    }
    setReady(true)
  }

  async function checkBan(userId: string) {
    const { data } = await supabase
      .from('anchor_bans')
      .select('reason, expires_at')
      .eq('user_id', userId)
      .maybeSingle()
    if (!data) { setBanStatus(null); return }
    if (data.expires_at && new Date(data.expires_at) < new Date()) { setBanStatus(null); return }
    setBanStatus({ banned: true, reason: data.reason ?? undefined })
  }

  if (!ready) return null

  if (banStatus?.banned) {
    return <BannedScreen reason={banStatus.reason} />
  }

  return (
    <AudioManagerProvider>
      <ThemeProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="plus" options={{ presentation: 'modal' }} />
          <Stack.Screen name="join" />
        </Stack>
      </ThemeProvider>
    </AudioManagerProvider>
  )
}
