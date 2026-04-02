import * as Notifications from 'expo-notifications'
import { AudioManagerProvider } from '../lib/AudioManager'
import { ThemeProvider } from '../lib/ThemeContext'
import { configureNotifications, registerForPushNotifications, scheduleDailyPromptNotification } from '../lib/notifications'
import { supabase } from '../lib/supabase'
import { Stack, router, useSegments } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import BannedScreen from '../components/BannedScreen'

configureNotifications()

export default function RootLayout() {
  const [banStatus, setBanStatus] = useState<{ banned: boolean; reason?: string } | null>(null)
  const [ready, setReady] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null)
  const segments = useSegments()
  const mounted = useRef(false)

  // Auth redirect logic — runs after layout is mounted
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    if (isLoggedIn === null) return
    const inAuthGroup = segments[0] === '(auth)'
    if (!isLoggedIn && !inAuthGroup) {
      router.replace('/(auth)/login')
    } else if (isLoggedIn && inAuthGroup) {
      router.replace('/(tabs)')
    }
  }, [isLoggedIn, segments])

  // Notification tap handler — navigate to relevant screen
  useEffect(() => {
    const receivedSub = Notifications.addNotificationReceivedListener(() => {
      // Foreground notification — handler shows it automatically
    })
    const responseSub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as Record<string, any>
      const type = data?.type as string
      if (type === 'capsule_media' || type === 'capsule_unlock' || type === 'new_member') {
        router.push('/(tabs)/trips')
      } else if (type === 'scrapbook_page') {
        router.push('/(tabs)/scrapbook')
      } else if (type === 'social_like' || type === 'social_comment' || type === 'social_follow') {
        router.push('/(tabs)' as any)
      } else if (type === 'space_join') {
        router.push('/(tabs)/space')
      } else if (type === 'new_message' && data?.conversation_id) {
        router.push(`/messages/${data.conversation_id}`)
      } else {
        router.push('/notifications')
      }
    })
    return () => { receivedSub.remove(); responseSub.remove() }
  }, [])

  useEffect(() => {
    initApp()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsLoggedIn(!!session?.user)
      if (session?.user) {
        checkBan(session.user.id)
        registerForPushNotifications().catch(() => {})
        scheduleDailyPromptNotification().catch(() => {})
      } else {
        setBanStatus(null)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function initApp() {
    const { data: { user } } = await supabase.auth.getUser()
    setIsLoggedIn(!!user)
    if (user) {
      await checkBan(user.id)
      registerForPushNotifications().catch(() => {})
      scheduleDailyPromptNotification().catch(() => {})
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
          <Stack.Screen name="notifications" />
          <Stack.Screen name="messages" />
          <Stack.Screen name="join" />
        </Stack>
      </ThemeProvider>
    </AudioManagerProvider>
  )
}
