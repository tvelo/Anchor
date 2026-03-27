import { Stack } from 'expo-router'

export default function JoinLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="space/[id]" />
      <Stack.Screen name="scrapbook/[id]" />
      <Stack.Screen name="travel/[id]" />
    </Stack>
  )
}
