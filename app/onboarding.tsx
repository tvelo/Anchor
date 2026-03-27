import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import {
  Animated, Dimensions, FlatList, Platform, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'

const { width: SW } = Dimensions.get('window')

const SLIDES = [
  {
    emoji: '✦',
    title: 'Welcome to Anchor',
    subtitle: 'A private space to collect, create, and share memories with the people who matter most.',
    color: '#C9956C',
    bg: '#2D1F14',
  },
  {
    emoji: '🔒',
    title: 'Lock your travels',
    subtitle: 'Upload memories on a trip — no one sees them until you unlock the capsule together. The reveal is the moment.',
    color: '#7B6EF6',
    bg: '#1A1528',
  },
  {
    emoji: '📖',
    title: 'Build scrapbooks together',
    subtitle: 'Add photos, text, and stickers to shared pages. Share them to your social feed for others to swipe through.',
    color: '#5EBA8A',
    bg: '#0E1F18',
  },
  {
    emoji: '👥',
    title: 'Your social, your way',
    subtitle: 'Follow friends, keep posts private or public. Your content is yours — not sold to advertisers.',
    color: '#B8A9D9',
    bg: '#1A1528',
  },
]

export default function Onboarding() {
  const [index, setIndex] = useState(0)
  const flatRef = useRef<FlatList>(null)
  const fadeAnim = useRef(new Animated.Value(1)).current

  const goTo = (i: number) => {
    Haptics.selectionAsync()
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start()
    setIndex(i)
    flatRef.current?.scrollToIndex({ index: i, animated: true })
  }

  const handleFinish = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('users')
          .update({ onboarding_complete: true })
          .eq('id', user.id)
      }
    } catch {}
    router.replace('/(tabs)' as any)
  }

  const slide = SLIDES[index]
  const isLast = index === SLIDES.length - 1

  return (
    <SafeAreaView style={[s.root, { backgroundColor: slide.bg }]} edges={['top', 'bottom']}>
      {/* Skip */}
      <TouchableOpacity style={s.skipBtn} onPress={handleFinish}>
        <Text style={s.skipText}>Skip</Text>
      </TouchableOpacity>

      {/* Slides (horizontal scroll, hidden) */}
      <FlatList
        ref={flatRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, i) => String(i)}
        renderItem={() => <View style={{ width: SW }} />}
        style={{ position: 'absolute', opacity: 0 }}
      />

      {/* Content */}
      <Animated.View style={[s.content, { opacity: fadeAnim }]}>
        <View style={[s.emojiWrap, { backgroundColor: slide.color + '20', borderColor: slide.color + '40' }]}>
          <Text style={[s.emoji, { color: slide.color }]}>{slide.emoji}</Text>
        </View>
        <Text style={[s.title, { color: '#F0EDE8' }]}>{slide.title}</Text>
        <Text style={[s.subtitle, { color: 'rgba(240,237,232,0.65)' }]}>{slide.subtitle}</Text>
      </Animated.View>

      {/* Dots */}
      <View style={s.dotsRow}>
        {SLIDES.map((_, i) => (
          <TouchableOpacity key={i} onPress={() => goTo(i)}>
            <View style={[s.dot, {
              backgroundColor: i === index ? slide.color : 'rgba(255,255,255,0.2)',
              width: i === index ? 24 : 8,
            }]} />
          </TouchableOpacity>
        ))}
      </View>

      {/* CTA */}
      <View style={s.footer}>
        {!isLast ? (
          <TouchableOpacity
            style={[s.btn, { backgroundColor: slide.color }]}
            onPress={() => goTo(index + 1)}>
            <Text style={s.btnText}>Next →</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[s.btn, { backgroundColor: slide.color }]}
            onPress={handleFinish}>
            <Text style={s.btnText}>Get started ✦</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  root: { flex: 1 },
  skipBtn: { position: 'absolute', top: Platform.OS === 'ios' ? 56 : 24, right: 24, zIndex: 10 },
  skipText: { color: 'rgba(240,237,232,0.45)', fontSize: 15 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  emojiWrap: { width: 100, height: 100, borderRadius: 50, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginBottom: 32 },
  emoji: { fontSize: 44, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center', marginBottom: 16, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', letterSpacing: -0.5 },
  subtitle: { fontSize: 16, textAlign: 'center', lineHeight: 24 },
  dotsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 24 },
  dot: { height: 8, borderRadius: 4, transition: 'all 0.3s' } as any,
  footer: { paddingHorizontal: 24, paddingBottom: Platform.OS === 'ios' ? 0 : 16 },
  btn: { borderRadius: 16, paddingVertical: 17, alignItems: 'center', marginBottom: 8 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 17 },
})
