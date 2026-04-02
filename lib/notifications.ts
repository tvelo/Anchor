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

// ─────────────────────────────────────────────────────────────────────────────
// Schedule the daily prompt notification (fires daily at a specific time)
// ─────────────────────────────────────────────────────────────────────────────
export async function scheduleDailyPromptNotification() {
  // First, cancel existing daily prompt notifications to avoid duplicates
  const scheduled = await Notifications.getAllScheduledNotificationsAsync()
  for (const n of scheduled) {
    if (n.content.data?.type === 'dailyprompt') {
      await Notifications.cancelScheduledNotificationAsync(n.identifier)
    }
  }

  // Schedule for 6:00 PM daily
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Time for your daily prompt 📝',
      body: 'Tap to see today\'s question and answer together.',
      data: { type: 'dailyprompt' },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 18,
      minute: 0,
    },
  })
}
// ─────────────────────────────────────────────────────────────────────────────
// Friend notification helpers
// ─────────────────────────────────────────────────────────────────────────────
async function logNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  data: Record<string, any> = {}
) {
  await supabase.from('notification_log').insert({ user_id: userId, type, title, body, data })
}

export async function notifyFriendRequest(
  recipientId: string,
  senderDisplayName: string,
  senderUsername: string
) {
  await logNotification(
    recipientId,
    'friend_request',
    'New friend request 👋',
    `${senderDisplayName} (@${senderUsername}) sent you a friend request`,
    { type: 'friend_request', from_username: senderUsername }
  )
}

export async function notifyFriendAccepted(
  originalSenderId: string,
  acceptorDisplayName: string,
  acceptorUsername: string
) {
  await logNotification(
    originalSenderId,
    'friend_accepted',
    'Friend request accepted 🎉',
    `${acceptorDisplayName} (@${acceptorUsername}) accepted your friend request`,
    { type: 'friend_accepted', from_username: acceptorUsername }
  )
  sendLocalNotification(
    'Friend request accepted 🎉',
    `${acceptorDisplayName} accepted your friend request`
  )
}
