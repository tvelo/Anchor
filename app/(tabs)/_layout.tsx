import { Ionicons } from '@expo/vector-icons'
import * as Linking from 'expo-linking'
import { router, Tabs } from 'expo-router'
import { useEffect } from 'react'

function handleDeepLink(url: string) {
  const parsed = Linking.parse(url)
  const [section, id] = (parsed.path ?? '').split('/').filter(Boolean)
  if (!id) return
  if (section === 'space')     router.push(`/join/space/${id}` as any)
  if (section === 'scrapbook') router.push(`/join/scrapbook/${id}` as any)
  if (section === 'travel')    router.push(`/join/travel/${id}` as any)
}

export default function TabLayout() {
  useEffect(() => {
    Linking.getInitialURL().then(url => { if (url) handleDeepLink(url) })
    const sub = Linking.addEventListener('url', ({ url }) => handleDeepLink(url))
    return () => sub.remove()
  }, [])

  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: { backgroundColor: '#221A2C', borderTopColor: '#3D2E52', borderTopWidth: 1 },
      tabBarActiveTintColor: '#C9956C',
      tabBarInactiveTintColor: '#9B8FAD',
    }}>
      <Tabs.Screen name="index"     options={{ title: 'Home',      tabBarIcon: ({ color, size }) => <Ionicons name="home"     size={size} color={color} /> }} />
      <Tabs.Screen name="social"    options={{ title: 'Socials',   tabBarIcon: ({ color, size }) => <Ionicons name="people"   size={size} color={color} /> }} />
      <Tabs.Screen name="space"     options={{ title: 'Space',     tabBarIcon: ({ color, size }) => <Ionicons name="heart"    size={size} color={color} /> }} />
      <Tabs.Screen name="scrapbook" options={{ title: 'Scrapbook', tabBarIcon: ({ color, size }) => <Ionicons name="images"   size={size} color={color} /> }} />
      <Tabs.Screen name="trips"     options={{ title: 'Trips',     tabBarIcon: ({ color, size }) => <Ionicons name="airplane" size={size} color={color} /> }} />
      <Tabs.Screen name="settings"  options={{ title: 'Settings',  tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} /> }} />
    </Tabs>
  )
}