import { Ionicons } from '@expo/vector-icons'
import * as Linking from 'expo-linking'
import { Tabs, router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { supabase } from '../../lib/supabase'

function handleDeepLink(url: string) {
  const parsed = Linking.parse(url)
  const [section, id] = (parsed.path ?? '').split('/').filter(Boolean)
  if (!id) return
  if (section === 'space')     router.push(`/join/space/${id}` as any)
  if (section === 'scrapbook') router.push(`/join/scrapbook/${id}` as any)
  if (section === 'travel')    router.push(`/join/travel/${id}` as any)
}

export default function RootLayout() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    Linking.getInitialURL().then(url => { if (url) handleDeepLink(url) })
    const sub = Linking.addEventListener('url', ({ url }) => handleDeepLink(url))

    checkSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT') {
          router.replace('/(auth)/login' as any)
          return
        }
        if (event === 'SIGNED_IN' && session?.user) {
          await redirect(session.user.id)
        }
      }
    )
    return () => {
      sub.remove()
      subscription.unsubscribe()
    }
  }, [])

  async function checkSession() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      router.replace('/(auth)/login' as any)
      setReady(true)
      return
    }
    await redirect(session.user.id)
    setReady(true)
  }

  async function redirect(userId: string) {
    const { data } = await supabase
      .from('users')
      .select('onboarding_complete, username')
      .eq('id', userId)
      .maybeSingle()

    if (!data || data.onboarding_complete === false || data.onboarding_complete === null) {
      router.replace('/onboarding' as any)
    } else if (!data.username) {
      // Existing accounts without a username — pick one first
      router.replace('/username-setup' as any)
    }
    // else: all good, fall through and render tabs
  }

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: '#1A1118', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#C9956C" size="large" />
      </View>
    )
  }

  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: { backgroundColor: '#221A2C', borderTopColor: '#3D2E52', borderTopWidth: 1 },
      tabBarActiveTintColor: '#C9956C',
      tabBarInactiveTintColor: '#9B8FAD',
    }}>
      <Tabs.Screen name="index"     options={{ title: 'Home',      tabBarIcon: ({ color, size }) => <Ionicons name="home"     size={size} color={color} /> }} />
      <Tabs.Screen name="space"     options={{ title: 'Space',     tabBarIcon: ({ color, size }) => <Ionicons name="heart"    size={size} color={color} /> }} />
      <Tabs.Screen name="scrapbook" options={{ title: 'Scrapbook', tabBarIcon: ({ color, size }) => <Ionicons name="images"   size={size} color={color} /> }} />
      <Tabs.Screen name="trips"     options={{ title: 'Trips',     tabBarIcon: ({ color, size }) => <Ionicons name="airplane" size={size} color={color} /> }} />
      <Tabs.Screen name="friends"   options={{ title: 'Friends',   tabBarIcon: ({ color, size }) => <Ionicons name="people"   size={size} color={color} /> }} />
      <Tabs.Screen name="settings"  options={{ title: 'Settings',  tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} /> }} />
    </Tabs>
  )
}