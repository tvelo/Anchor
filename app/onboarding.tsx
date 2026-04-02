import * as Haptics from 'expo-haptics'
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  Alert, Animated, Dimensions, FlatList, KeyboardAvoidingView,
  Linking, Platform, ScrollView, StyleSheet, Switch, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'

const { width: SW } = Dimensions.get('window')

// ─── Carousel theme ────────────────────────────────────────────────────────────
const SLIDES = [
  {
    emoji: '❤️',
    title: 'Your private space',
    subtitle: 'A shared canvas just for you and the people who matter most. Pin photos, notes, countdowns, and more.',
    color: '#C9956C',
    bg: '#2D1F14',
  },
  {
    emoji: '📖',
    title: 'Build memories together',
    subtitle: 'Create beautiful scrapbooks with drag-and-drop photos, text, stickers, and borders. One page at a time.',
    color: '#5EBA8A',
    bg: '#0E1F18',
  },
  {
    emoji: '📱',
    title: 'Always close',
    subtitle: 'Add a widget to your home screen and see your space at a glance — updated live, no need to open the app.',
    color: '#B8A9D9',
    bg: '#1A1528',
  },
]

// ─── Setup wizard theme ────────────────────────────────────────────────────────
const ACCENT  = '#C9956C'
const BG      = '#1A1118'
const SURFACE = '#221A2C'
const HIGH    = '#2D2040'
const BORDER  = '#3D2E52'
const TEXT    = '#F5EEF8'
const MUTED   = '#9B8FAD'

const TOTAL_STEPS = 5

// ─── Phase 1: Intro Carousel ──────────────────────────────────────────────────
function IntroCarousel({ onFinish }: { onFinish: () => void }) {
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

  const slide = SLIDES[index]
  const isLast = index === SLIDES.length - 1

  return (
    <SafeAreaView style={[cs.root, { backgroundColor: slide.bg }]} edges={['top', 'bottom']}>
      {/* Skip */}
      <TouchableOpacity style={cs.skipBtn} onPress={onFinish}>
        <Text style={cs.skipText}>Skip</Text>
      </TouchableOpacity>

      {/* Hidden pager */}
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
      <Animated.View style={[cs.content, { opacity: fadeAnim }]}>
        <View style={[cs.emojiWrap, { backgroundColor: slide.color + '20', borderColor: slide.color + '40' }]}>
          <Text style={[cs.emoji, { color: slide.color }]}>{slide.emoji}</Text>
        </View>
        <Text style={[cs.title, { color: '#F0EDE8' }]}>{slide.title}</Text>
        <Text style={[cs.subtitle, { color: 'rgba(240,237,232,0.65)' }]}>{slide.subtitle}</Text>
      </Animated.View>

      {/* Dots */}
      <View style={cs.dotsRow}>
        {SLIDES.map((_, i) => (
          <TouchableOpacity key={i} onPress={() => goTo(i)}>
            <View style={[cs.dot, {
              backgroundColor: i === index ? slide.color : 'rgba(255,255,255,0.2)',
              width: i === index ? 24 : 8,
            }]} />
          </TouchableOpacity>
        ))}
      </View>

      {/* CTA */}
      <View style={cs.footer}>
        {!isLast ? (
          <TouchableOpacity
            style={[cs.btn, { backgroundColor: slide.color }]}
            onPress={() => goTo(index + 1)}>
            <Text style={cs.btnText}>Next →</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[cs.btn, { backgroundColor: slide.color }]}
            onPress={() => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
              onFinish()
            }}>
            <Text style={cs.btnText}>Get started ✦</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  )
}

// ─── Step dots ─────────────────────────────────────────────────────────────────
function StepDots({ current }: { current: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, marginBottom: 32 }}>
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <View key={i} style={[
          s.dot,
          i === current && s.dotActive,
          i < current && s.dotDone,
        ]} />
      ))}
    </View>
  )
}

// ─── Step 1: Profile name ──────────────────────────────────────────────────────
function StepProfile({ initialName, onNext }: {
  initialName: string
  onNext: (displayName: string) => void
}) {
  const [displayName, setDisplayName] = useState(initialName)
  const inputRef = useRef<TextInput>(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 400) }, [])

  return (
    <View style={s.stepWrap}>
      <Text style={s.stepEmoji}>✦</Text>
      <Text style={s.stepTitle}>Set up your profile</Text>
      <Text style={s.stepSub}>Let's get you ready in a few quick steps.</Text>

      <View style={s.fieldGroup}>
        <Text style={s.fieldLabel}>Your display name</Text>
        <TextInput
          ref={inputRef}
          style={s.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="How you want to appear to others"
          placeholderTextColor={MUTED}
          returnKeyType="done"
          maxLength={40}
        />
        <Text style={s.fieldHint}>This is what partners and friends see.</Text>
      </View>

      <TouchableOpacity
        style={[s.btn, !displayName.trim() && { opacity: 0.4 }]}
        disabled={!displayName.trim()}
        onPress={() => onNext(displayName.trim())}>
        <Text style={s.btnText}>Continue →</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Step 2: Social profile ────────────────────────────────────────────────────
function StepSocial({ userId, displayName, onNext, onSkip }: {
  userId: string
  displayName: string
  onNext: () => void
  onSkip: () => void
}) {
  const defaultUsername = displayName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)
  const [username, setUsername] = useState(defaultUsername)
  const [bio, setBio] = useState('')
  const [usernameErr, setUsernameErr] = useState('')
  const [saving, setSaving] = useState(false)

  const validate = (v: string) => {
    const clean = v.toLowerCase().replace(/[^a-z0-9_]/g, '')
    setUsername(clean)
    setUsernameErr(clean.length < 3 ? 'Min 3 characters' : '')
  }

  const handleCreate = async () => {
    if (username.length < 3) { setUsernameErr('Min 3 characters'); return }
    setSaving(true)
    const { data: exists } = await supabase
      .from('social_profiles').select('id').eq('username', username).maybeSingle()
    if (exists && exists.id !== userId) { setUsernameErr('Username taken'); setSaving(false); return }
    const { error } = await supabase.from('social_profiles').upsert({
      id: userId,
      username,
      display_name: displayName,
      bio: bio.trim() || null,
      avatar_url: null,
      privacy: 'public',
    })
    setSaving(false)
    if (error) { Alert.alert('Error', error.message); return }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    onNext()
  }

  return (
    <View style={s.stepWrap}>
      <Text style={s.stepEmoji}>💬</Text>
      <Text style={s.stepTitle}>Your social profile</Text>
      <Text style={s.stepSub}>How people find and follow you on Anchor Socials.</Text>

      <View style={s.fieldGroup}>
        <Text style={s.fieldLabel}>Username</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: HIGH,
          borderWidth: 1, borderColor: usernameErr ? '#EF4444' : BORDER,
          borderRadius: 12, paddingLeft: 14 }}>
          <Text style={{ color: MUTED, fontSize: 15 }}>@</Text>
          <TextInput
            style={[s.input, { flex: 1, backgroundColor: 'transparent',
              borderWidth: 0, borderRadius: 0, paddingLeft: 4 }]}
            value={username}
            onChangeText={validate}
            placeholder="yourname"
            placeholderTextColor={MUTED}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={30}
          />
        </View>
        {usernameErr ? <Text style={s.errText}>{usernameErr}</Text> : null}
      </View>

      <View style={s.fieldGroup}>
        <Text style={s.fieldLabel}>Bio <Text style={{ color: MUTED, fontWeight: '400' }}>(optional)</Text></Text>
        <TextInput
          style={[s.input, { height: 80, textAlignVertical: 'top' }]}
          value={bio}
          onChangeText={setBio}
          placeholder="Tell people a little about yourself..."
          placeholderTextColor={MUTED}
          multiline
          maxLength={150}
        />
      </View>

      <TouchableOpacity
        style={[s.btn, (username.length < 3 || saving) && { opacity: 0.5 }]}
        disabled={username.length < 3 || saving}
        onPress={handleCreate}>
        <Text style={s.btnText}>{saving ? 'Creating…' : 'Create profile →'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.btnSec} onPress={onSkip}>
        <Text style={s.btnSecText}>Skip for now</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Step 3: Notifications ─────────────────────────────────────────────────────
function StepNotifications({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [newMemory, setNewMemory] = useState(true)
  const [unlocked, setUnlocked] = useState(true)
  const [partnerActivity, setPartnerActivity] = useState(true)
  const [reminders, setReminders] = useState(false)
  const [requesting, setRequesting] = useState(false)

  const handleEnable = async () => {
    setRequesting(true)
    const { status } = await Notifications.requestPermissionsAsync()
    setRequesting(false)
    if (status !== 'granted') {
      Alert.alert(
        'Notifications blocked',
        'You can enable them later in device Settings.',
        [
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
          { text: 'Continue anyway', onPress: onNext },
        ]
      )
      return
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    onNext()
  }

  const notifs = [
    { label: 'New memory added',   sub: 'When someone uploads to your capsule', val: newMemory,       set: setNewMemory },
    { label: 'Capsule unlocked',   sub: 'When a time-locked capsule opens',     val: unlocked,        set: setUnlocked },
    { label: 'Partner activity',   sub: 'Widgets and pages added to your space',val: partnerActivity, set: setPartnerActivity },
    { label: 'Upload reminders',   sub: 'Gentle nudges before unlock dates',    val: reminders,       set: setReminders },
  ]

  return (
    <View style={s.stepWrap}>
      <Text style={s.stepEmoji}>🔔</Text>
      <Text style={s.stepTitle}>Stay in the loop</Text>
      <Text style={s.stepSub}>Choose what you want to be notified about. You can change these any time.</Text>

      <View style={s.notifCard}>
        {notifs.map((n, i) => (
          <View key={n.label} style={[s.notifRow, i < notifs.length - 1 && { borderBottomWidth: 1, borderBottomColor: BORDER }]}>
            <View style={{ flex: 1 }}>
              <Text style={s.notifLabel}>{n.label}</Text>
              <Text style={s.notifSub}>{n.sub}</Text>
            </View>
            <Switch
              value={n.val}
              onValueChange={n.set}
              trackColor={{ false: BORDER, true: ACCENT + '55' }}
              thumbColor={n.val ? ACCENT : MUTED}
              ios_backgroundColor={BORDER}
            />
          </View>
        ))}
      </View>

      <TouchableOpacity style={[s.btn, requesting && { opacity: 0.6 }]} disabled={requesting} onPress={handleEnable}>
        <Text style={s.btnText}>{requesting ? 'Requesting…' : 'Enable notifications'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.btnSec} onPress={onSkip}>
        <Text style={s.btnSecText}>Skip</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Step 4: First space ───────────────────────────────────────────────────────
function StepSpace({ userId, onNext, onSkip }: {
  userId: string; onNext: () => void; onSkip: () => void
}) {
  const [spaceName, setSpaceName] = useState('')
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    if (!spaceName.trim()) return
    setCreating(true)
    try {
      const { data } = await supabase
        .from('canvases')
        .insert({ name: spaceName.trim(), owner_id: userId,
          background_type: 'color', background_value: '#1A1118', theme: 'none' })
        .select('*').single()
      if (data) {
        await supabase.from('space_members')
          .insert({ space_id: data.id, user_id: userId, role: 'owner' })
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      }
    } catch (e: any) { Alert.alert('Error', e.message) }
    setCreating(false)
    onNext()
  }

  return (
    <View style={s.stepWrap}>
      <Text style={s.stepEmoji}>❤️</Text>
      <Text style={s.stepTitle}>Create your first space</Text>
      <Text style={s.stepSub}>A private canvas for you and the people you love. Invite them after.</Text>

      <View style={s.fieldGroup}>
        <Text style={s.fieldLabel}>Space name</Text>
        <TextInput
          style={s.input}
          value={spaceName}
          onChangeText={setSpaceName}
          placeholder="e.g. Our Space, Us ✦"
          placeholderTextColor={MUTED}
          returnKeyType="done"
          maxLength={40}
          autoFocus
        />
      </View>

      <View style={[s.infoBox, { marginBottom: 20 }]}>
        <Text style={s.infoText}>
          💡 You can invite people to your space after you're set up — just tap Invite on the Space tab.
        </Text>
      </View>

      <TouchableOpacity
        style={[s.btn, (!spaceName.trim() || creating) && { opacity: 0.4 }]}
        disabled={!spaceName.trim() || creating}
        onPress={handleCreate}>
        <Text style={s.btnText}>{creating ? 'Creating…' : 'Create space →'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.btnSec} onPress={onSkip}>
        <Text style={s.btnSecText}>Do this later</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Step 5: Done ──────────────────────────────────────────────────────────────
function StepDone({ name, onFinish }: { name: string; onFinish: () => void }) {
  const scaleAnim   = useRef(new Animated.Value(0.8)).current
  const opacityAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, tension: 120, friction: 8, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start()
  }, [])

  return (
    <View style={[s.stepWrap, { justifyContent: 'center', alignItems: 'center', flex: 1 }]}>
      <Animated.View style={[{ alignItems: 'center', gap: 16 }, {
        opacity: opacityAnim,
        transform: [{ scale: scaleAnim }],
      }]}>
        <Text style={{ fontSize: 72 }}>🎉</Text>
        <Text style={[s.stepTitle, { textAlign: 'center', fontSize: 28 }]}>
          You're all set{name ? `, ${name.split(' ')[0]}` : ''}!
        </Text>
        <Text style={[s.stepSub, { textAlign: 'center', fontSize: 15, maxWidth: 280 }]}>
          Your Anchor is ready. Start collecting the moments that matter.
        </Text>
        <Text style={{ fontSize: 22, letterSpacing: 4, marginTop: 8 }}>✨ 📖 ✈️ ❤️ 💫</Text>
      </Animated.View>

      <TouchableOpacity style={[s.btn, { position: 'absolute', bottom: 0, left: 0, right: 0 }]} onPress={onFinish}>
        <Text style={s.btnText}>Open Anchor →</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Phase 2: Setup Wizard ─────────────────────────────────────────────────────
function SetupWizard() {
  const [step, setStep] = useState(0)
  const [userId, setUserId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const slideAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.replace('/(auth)/login' as any); return }
      setUserId(user.id)
      const dn = user.user_metadata?.display_name || user.email?.split('@')[0] || ''
      setDisplayName(dn)
    })
  }, [])

  const goToStep = (n: number) => {
    Animated.timing(slideAnim, { toValue: -SW, duration: 200, useNativeDriver: true }).start(() => {
      setStep(n)
      slideAnim.setValue(SW)
      Animated.spring(slideAnim, { toValue: 0, tension: 120, friction: 14, useNativeDriver: true }).start()
    })
  }

  const next = () => goToStep(step + 1)

  const finish = async () => {
    await supabase.from('users').update({ onboarding_complete: true }).eq('id', userId)
    router.replace('/(tabs)' as any)
  }

  const handleProfileNext = async (name: string) => {
    setDisplayName(name)
    await supabase.from('users').update({ display_name: name }).eq('id', userId)
    next()
  }

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={s.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>

          <StepDots current={step} />

          <Animated.View style={[{ flex: 1, width: '100%' }, { transform: [{ translateX: slideAnim }] }]}>
            {step === 0 && <StepProfile initialName={displayName} onNext={handleProfileNext} />}
            {step === 1 && <StepSocial userId={userId} displayName={displayName} onNext={next} onSkip={next} />}
            {step === 2 && <StepNotifications onNext={next} onSkip={next} />}
            {step === 3 && <StepSpace userId={userId} onNext={next} onSkip={next} />}
            {step === 4 && <StepDone name={displayName} onFinish={finish} />}
          </Animated.View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

// ─── Root: gates between Phase 1 and Phase 2 ──────────────────────────────────
export default function Onboarding() {
  const [phase, setPhase] = useState<'intro' | 'setup'>('intro')
  const phaseAnim = useRef(new Animated.Value(1)).current

  const advanceToSetup = () => {
    Animated.timing(phaseAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
      setPhase('setup')
      Animated.timing(phaseAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start()
    })
  }

  return (
    <Animated.View style={{ flex: 1, opacity: phaseAnim }}>
      {phase === 'intro'
        ? <IntroCarousel onFinish={advanceToSetup} />
        : <SetupWizard />
      }
    </Animated.View>
  )
}

// ─── Carousel styles ───────────────────────────────────────────────────────────
const cs = StyleSheet.create({
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

// ─── Setup wizard styles ───────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  container: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 32 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: BORDER },
  dotActive: { width: 24, backgroundColor: ACCENT },
  dotDone: { backgroundColor: ACCENT + '55' },
  stepWrap: { flex: 1, width: '100%', gap: 0 },
  stepEmoji: { fontSize: 48, marginBottom: 16, textAlign: 'center' },
  stepTitle: { fontSize: 26, fontWeight: '800', color: TEXT,
    marginBottom: 10, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  stepSub: { fontSize: 14, color: MUTED, lineHeight: 21, marginBottom: 28 },
  fieldGroup: { marginBottom: 18 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: MUTED, marginBottom: 8 },
  fieldHint: { fontSize: 12, color: BORDER, marginTop: 6 },
  input: { backgroundColor: HIGH, borderWidth: 1, borderColor: BORDER,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    color: TEXT, fontSize: 15 },
  errText: { color: '#EF4444', fontSize: 12, marginTop: 5 },
  btn: { backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  btnSec: { backgroundColor: 'transparent', borderRadius: 14, paddingVertical: 13,
    alignItems: 'center', marginTop: 4 },
  btnSecText: { color: MUTED, fontSize: 15 },
  notifCard: { backgroundColor: SURFACE, borderRadius: 16, borderWidth: 1,
    borderColor: BORDER, overflow: 'hidden', marginBottom: 20 },
  notifRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingVertical: 13, gap: 12 },
  notifLabel: { fontSize: 14, fontWeight: '600', color: TEXT, marginBottom: 2 },
  notifSub: { fontSize: 11, color: MUTED },
  infoBox: { backgroundColor: SURFACE, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: BORDER },
  infoText: { fontSize: 13, color: MUTED, lineHeight: 19 },
})