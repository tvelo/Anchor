import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import { Platform } from 'react-native'

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

const storage =
  Platform.OS === 'web'
    ? {
      getItem: (key: string): string | null =>
        typeof window !== 'undefined' ? localStorage.getItem(key) : null,
      setItem: (key: string, value: string): void => {
        if (typeof window !== 'undefined') localStorage.setItem(key, value)
      },
      removeItem: (key: string): void => {
        if (typeof window !== 'undefined') localStorage.removeItem(key)
      },
    }
    : AsyncStorage

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
})