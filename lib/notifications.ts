import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { supabase } from './supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Call configureNotifications() once at the top of app/_layout.tsx
// ─────────────────────────────────────────────────────────────────────────────
export function configureNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,   // required by expo-notifications 0.32+
      shouldShowList: true,     // required by expo-notifications 0.32+
    }),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Register push token and save to DB — call after login
// ─────────────────────────────────────────────────────────────────────────────
export async function registerForPushNotifications(): Promise<string | null> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }
  if (finalStatus !== 'granted') {
    console.log('[Anchor] Push permission denied')
    return null
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Anchor',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#C8A96E',
    })
  }

  try {
    const token = await Notifications.getExpoPushTokenAsync({
      projectId: '4e26065d-1f1f-4418-bda6-a6acc0358040',
    })
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('users').update({ push_token: token.data }).eq('id', user.id)
    }
    return token.data
  } catch (e) {
    console.log('[Anchor] Push token error:', e)
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Local notifications (fire immediately on this device, no server needed)
// ─────────────────────────────────────────────────────────────────────────────
export async function sendLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: data ?? {}, sound: true },
    trigger: null,
  })
}

export const notify = {
  capsuleUnlocked: (name: string) =>
    sendLocalNotification('Capsule unlocked 🔓', `"${name}" is now open — see everyone's memories!`),

  newMemoryAdded: (capsuleName: string, uploaderName: string) =>
    sendLocalNotification('New memory added 📸', `${uploaderName} added to "${capsuleName}"`),

  newMemberJoined: (capsuleName: string, memberName: string) =>
    sendLocalNotification('New traveller joined ✈️', `${memberName} joined "${capsuleName}"`),

  scrapbookUpdated: (bookName: string, editorName: string) =>
    sendLocalNotification('Scrapbook updated 📖', `${editorName} added a page to "${bookName}"`),

  uploadReminder: (capsuleName: string, daysLeft: number) =>
    sendLocalNotification('Upload reminder ⏰', `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left to add memories to "${capsuleName}"`),
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedule a future notification (fires 24h before capsule unlock)
// ─────────────────────────────────────────────────────────────────────────────
export async function scheduleUnlockReminder(capsuleName: string, unlockDate: Date) {
  const reminderDate = new Date(unlockDate.getTime() - 24 * 60 * 60 * 1000)
  if (reminderDate < new Date()) return
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Capsule unlocks tomorrow! ⏳',
      body: `"${capsuleName}" opens in less than 24 hours`,
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: reminderDate,
    },
  })
}
