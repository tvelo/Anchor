import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
    ActivityIndicator, Alert, Animated, Platform,
    ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'
import { useTheme } from '../lib/ThemeContext'
import { supabase } from '../lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// RevenueCat integration
// Install: npx expo install react-native-purchases
// Then configure in app.json plugins (see SETUP note at bottom)
// ─────────────────────────────────────────────────────────────────────────────
let Purchases: any = null
try {
  Purchases = require('react-native-purchases').default
} catch {
  // RevenueCat not installed yet — purchase will show setup alert
}

const PLUS_FEATURES = [
  { emoji: '📖', title: 'Unlimited scrapbooks',    sub: 'Create as many memory books as you want' },
  { emoji: '✈️', title: 'Unlimited travel capsules', sub: 'No cap on trips or members' },
  { emoji: '🖼️', title: 'More uploads per capsule', sub: 'Up to 50 photos & videos per trip' },
  { emoji: '❤️', title: 'Unlimited spaces',         sub: 'Share canvases with more people' },
  { emoji: '🎵', title: 'Background music',          sub: 'Add soundtracks to any scrapbook' },
  { emoji: '✦',  title: 'Early access',              sub: 'Get new features before anyone else' },
]

export default function AnchorPlusScreen() {
  const { colors: C } = useTheme()
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [isPurchased, setIsPurchased] = useState(false)
  const [userId, setUserId] = useState('')
  const pulseAnim = useRef(new Animated.Value(1)).current
  const fadeAnim  = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start()
    checkStatus()
    startPulse()
  }, [])

  function startPulse() {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.03, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 1200, useNativeDriver: true }),
      ])
    ).start()
  }

  const checkStatus = async () => {
    setChecking(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setChecking(false); return }
    setUserId(user.id)
    const { data } = await supabase.from('anchor_plus').select('id').eq('user_id', user.id).maybeSingle()
    setIsPurchased(!!data)
    setChecking(false)
  }

  const handlePurchase = async () => {
    if (!Purchases) {
      Alert.alert(
        'Payment coming soon',
        'In-app purchase is being set up. To get Anchor Plus during beta, contact anchorsupprtmobile@outlook.com.',
        [{ text: 'Email us', onPress: () => {} }, { text: 'OK' }]
      )
      return
    }
    setLoading(true)
    try {
      // Configure RevenueCat (replace with your API key from app.RevenueCat.com)
      await Purchases.configure({ apiKey: Platform.OS === 'ios' ? 'YOUR_RC_IOS_KEY' : 'YOUR_RC_ANDROID_KEY' })
      const offerings = await Purchases.getOfferings()
      const pkg = offerings.current?.availablePackages?.[0]
      if (!pkg) { Alert.alert('Not available', 'Purchase not available right now. Try again later.'); setLoading(false); return }

      const { customerInfo } = await Purchases.purchasePackage(pkg)
      const hasAccess = customerInfo.entitlements.active['anchor_plus']

      if (hasAccess) {
        // Record in our DB
        await supabase.from('anchor_plus').upsert({
          user_id: userId,
          purchase_id: customerInfo.originalAppUserId,
        })
        setIsPurchased(true)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        Alert.alert('Welcome to Anchor Plus! ✦', 'All features are now unlocked.', [
          { text: 'Let\'s go!', onPress: () => router.back() },
        ])
      }
    } catch (e: any) {
      if (e?.userCancelled) {
        // user cancelled, no alert
      } else {
        Alert.alert('Purchase failed', e.message || 'Something went wrong. Please try again.')
      }
    }
    setLoading(false)
  }

  const handleRestore = async () => {
    if (!Purchases) { Alert.alert('Not available', 'Restore is not set up yet.'); return }
    setLoading(true)
    try {
      await Purchases.configure({ apiKey: Platform.OS === 'ios' ? 'YOUR_RC_IOS_KEY' : 'YOUR_RC_ANDROID_KEY' })
      const customerInfo = await Purchases.restorePurchases()
      const hasAccess = customerInfo.entitlements.active['anchor_plus']
      if (hasAccess) {
        await supabase.from('anchor_plus').upsert({ user_id: userId })
        setIsPurchased(true)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        Alert.alert('Restored! ✦', 'Your Anchor Plus access has been restored.')
      } else {
        Alert.alert('Nothing to restore', 'No previous purchase found for this account.')
      }
    } catch (e: any) {
      Alert.alert('Restore failed', e.message || 'Could not restore purchases.')
    }
    setLoading(false)
  }

  if (checking) {
    return (
      <View style={[s.root, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    )
  }

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      {/* Close button */}
      <TouchableOpacity style={s.closeBtn} onPress={() => router.back()}>
        <Text style={{ color: C.textMuted, fontSize: 17 }}>✕</Text>
      </TouchableOpacity>

      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

          {/* Hero */}
          <View style={s.hero}>
            <Animated.View style={[s.heroBadge, { backgroundColor: C.accentSoft, borderColor: C.accent + '40', transform: [{ scale: pulseAnim }] }]}>
              <Text style={s.heroBadgeEmoji}>✦</Text>
            </Animated.View>
            <Text style={[s.heroTitle, { color: C.textPrimary }]}>Anchor Plus</Text>
            <Text style={[s.heroSub, { color: C.textSecondary }]}>
              {isPurchased
                ? 'You have Anchor Plus — all features unlocked ✓'
                : 'Unlock everything. One payment, forever yours.'}
            </Text>
          </View>

          {/* Price card */}
          {!isPurchased && (
            <View style={[s.priceCard, { backgroundColor: C.surface, borderColor: C.accent + '50' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
                <Text style={[s.currency, { color: C.accent }]}>£</Text>
                <Text style={[s.price, { color: C.accent }]}>5.99</Text>
              </View>
              <Text style={[s.priceLabel, { color: C.textSecondary }]}>one-time · no subscription · no renewals</Text>
            </View>
          )}

          {/* Active badge */}
          {isPurchased && (
            <View style={[s.activeBadge, { backgroundColor: '#5EBA8A20', borderColor: '#5EBA8A50' }]}>
              <Text style={{ color: '#5EBA8A', fontSize: 15, fontWeight: '700' }}>✓ Active on this account</Text>
            </View>
          )}

          {/* Features */}
          <View style={[s.featuresCard, { backgroundColor: C.surface, borderColor: C.border }]}>
            <Text style={[s.featuresTitle, { color: C.textSecondary }]}>WHAT YOU GET</Text>
            {PLUS_FEATURES.map((f, i) => (
              <View key={f.title} style={[s.featureRow, i < PLUS_FEATURES.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border }]}>
                <View style={[s.featureIcon, { backgroundColor: C.accentSoft }]}>
                  <Text style={{ fontSize: 20 }}>{f.emoji}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.featureTitle, { color: C.textPrimary }]}>{f.title}</Text>
                  <Text style={[s.featureSub, { color: C.textMuted }]}>{f.sub}</Text>
                </View>
                {isPurchased && <Text style={{ color: '#5EBA8A', fontSize: 16 }}>✓</Text>}
              </View>
            ))}
          </View>

          {/* CTA */}
          {!isPurchased && (
            <>
              <TouchableOpacity
                style={[s.buyBtn, loading && { opacity: 0.7 }]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); handlePurchase() }}
                disabled={loading}>
                {loading
                  ? <ActivityIndicator color="#1A1118" />
                  : <>
                      <Text style={s.buyBtnText}>Get Anchor Plus</Text>
                      <Text style={s.buyBtnSub}>£5.99 · one-time · {Platform.OS === 'ios' ? 'Apple Pay or card' : 'Google Pay or card'}</Text>
                    </>
                }
              </TouchableOpacity>

              <TouchableOpacity style={s.restoreBtn} onPress={handleRestore} disabled={loading}>
                <Text style={[s.restoreBtnText, { color: C.textMuted }]}>Restore previous purchase</Text>
              </TouchableOpacity>

              <Text style={[s.legal, { color: C.textMuted }]}>
                Payment processed securely via {Platform.OS === 'ios' ? 'Apple' : 'Google'}. One-time purchase — no recurring charges. Contact anchorsupprtmobile@outlook.com for support.
              </Text>
            </>
          )}

          {isPurchased && (
            <TouchableOpacity style={[s.buyBtn, { backgroundColor: '#5EBA8A' }]} onPress={() => router.back()}>
              <Text style={s.buyBtnText}>Continue using Anchor ✦</Text>
            </TouchableOpacity>
          )}

        </ScrollView>
      </Animated.View>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP NOTE:
// 1. npx expo install react-native-purchases
// 2. Add to app.json plugins: ["react-native-purchases"]
// 3. Sign up at https://app.revenuecat.com (free)
// 4. Create an App, add your iOS/Android store app
// 5. Create a Product in App Store Connect / Play Console: one-time £5.99
//    Product ID: "anchor_plus"
// 6. Create an Entitlement in RevenueCat: "anchor_plus"
// 7. Create an Offering and attach the product
// 8. Replace YOUR_RC_IOS_KEY / YOUR_RC_ANDROID_KEY above with your RC API keys
// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },
  closeBtn: { position: 'absolute', top: Platform.OS === 'ios' ? 56 : 24, right: 20, zIndex: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.2)', alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 24, paddingTop: Platform.OS === 'ios' ? 80 : 48, paddingBottom: 48 },

  hero: { alignItems: 'center', marginBottom: 28, gap: 10 },
  heroBadge: { width: 80, height: 80, borderRadius: 40, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  heroBadgeEmoji: { fontSize: 36, color: '#C9956C' },
  heroTitle: { fontSize: 34, fontWeight: '900', letterSpacing: -0.5, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  heroSub: { fontSize: 15, textAlign: 'center', lineHeight: 22, maxWidth: 280 },

  priceCard: { borderRadius: 20, borderWidth: 1.5, padding: 20, alignItems: 'center', gap: 6, marginBottom: 16 },
  currency: { fontSize: 22, fontWeight: '800', marginBottom: 6 },
  price: { fontSize: 56, fontWeight: '900', lineHeight: 60, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  priceLabel: { fontSize: 13, textAlign: 'center' },

  activeBadge: { borderRadius: 14, borderWidth: 1, paddingVertical: 12, alignItems: 'center', marginBottom: 16 },

  featuresCard: { borderRadius: 18, borderWidth: 1, overflow: 'hidden', marginBottom: 24 },
  featuresTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  featureRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  featureIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  featureTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  featureSub: { fontSize: 12, lineHeight: 16 },

  buyBtn: { backgroundColor: '#C9956C', borderRadius: 16, paddingVertical: 18, alignItems: 'center', gap: 4, marginBottom: 12 },
  buyBtnText: { color: '#1A1118', fontWeight: '900', fontSize: 17 },
  buyBtnSub: { color: '#1A1118', fontSize: 12, opacity: 0.7 },
  restoreBtn: { alignItems: 'center', paddingVertical: 12, marginBottom: 16 },
  restoreBtnText: { fontSize: 14 },
  legal: { fontSize: 11, textAlign: 'center', lineHeight: 17 },
})