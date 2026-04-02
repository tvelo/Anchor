import React, { useEffect, useRef } from 'react'
import {
  Animated,
  Dimensions,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'

const { width: SW, height: SH } = Dimensions.get('window')
const CONFETTI_COUNT = 30
const COLORS = ['#C9956C', '#B8A9D9', '#6BBED4', '#F5C842', '#EF4444', '#22C55E', '#EC4899', '#FFFFFF']
const EMOJIS = ['🎉', '✨', '🎊', '🔓', '💛', '⭐', '🎈']

// Static per-particle config (not state, not hooks — just plain data)
const PARTICLE_CONFIG = Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
  color: COLORS[i % COLORS.length],
  emoji: Math.random() > 0.6 ? EMOJIS[i % EMOJIS.length] : null,
  startX: Math.random() * SW,
  endX: (Math.random() - 0.5) * SW * 1.5,
  size: 8 + Math.random() * 10,
  delay: Math.random() * 600,
  duration: 1800 + Math.random() * 1200,
}))

interface Props {
  visible: boolean
  capsuleName: string
  mediaUrls: string[]
  onDismiss: () => void
}

export default function UnlockCelebration({ visible, capsuleName, mediaUrls, onDismiss }: Props) {
  // All Animated.Values at top level — no hooks inside useMemo/useEffect
  const fadeIn = useRef(new Animated.Value(0)).current
  const scaleIn = useRef(new Animated.Value(0.7)).current
  const particleY = useRef(PARTICLE_CONFIG.map(() => new Animated.Value(-20))).current
  const particleX = useRef(PARTICLE_CONFIG.map(() => new Animated.Value(0))).current
  const particleOpacity = useRef(PARTICLE_CONFIG.map(() => new Animated.Value(0))).current
  const particleRotation = useRef(PARTICLE_CONFIG.map(() => new Animated.Value(0))).current

  useEffect(() => {
    if (!visible) {
      // Reset
      fadeIn.setValue(0)
      scaleIn.setValue(0.7)
      particleY.forEach(v => v.setValue(-20))
      particleX.forEach(v => v.setValue(0))
      particleOpacity.forEach(v => v.setValue(0))
      particleRotation.forEach(v => v.setValue(0))
      return
    }

    // Animate overlay in
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(scaleIn, { toValue: 1, tension: 80, friction: 8, useNativeDriver: true }),
    ]).start()

    // Animate confetti particles
    PARTICLE_CONFIG.forEach((cfg, i) => {
      Animated.sequence([
        Animated.delay(cfg.delay),
        Animated.parallel([
          Animated.timing(particleY[i], {
            toValue: SH + 40,
            duration: cfg.duration,
            useNativeDriver: true,
          }),
          Animated.timing(particleX[i], {
            toValue: cfg.endX,
            duration: cfg.duration,
            useNativeDriver: true,
          }),
          Animated.timing(particleOpacity[i], {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(particleRotation[i], {
            toValue: (Math.random() > 0.5 ? 1 : -1) * (2 + Math.random() * 4),
            duration: cfg.duration,
            useNativeDriver: true,
          }),
        ]),
      ]).start()
    })
  }, [visible])

  if (!visible) return null

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      {/* Confetti layer */}
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        {PARTICLE_CONFIG.map((cfg, i) => {
          const rotate = particleRotation[i].interpolate({
            inputRange: [-10, 10],
            outputRange: ['-720deg', '720deg'],
          })
          return (
            <Animated.View
              key={i}
              style={{
                position: 'absolute',
                left: cfg.startX,
                top: 0,
                opacity: particleOpacity[i],
                transform: [
                  { translateY: particleY[i] },
                  { translateX: particleX[i] },
                  { rotate },
                ],
              }}>
              {cfg.emoji ? (
                <Text style={{ fontSize: cfg.size + 4 }}>{cfg.emoji}</Text>
              ) : (
                <View style={{
                  width: cfg.size,
                  height: cfg.size * 0.5,
                  backgroundColor: cfg.color,
                  borderRadius: 2,
                  opacity: 0.85,
                }} />
              )}
            </Animated.View>
          )
        })}
      </View>

      {/* Content overlay */}
      <Animated.View style={[styles.overlay, { opacity: fadeIn }]}>
        <Animated.View style={[styles.card, { transform: [{ scale: scaleIn }] }]}>
          <Text style={styles.lockIcon}>🔓</Text>
          <Text style={styles.title}>Capsule Unlocked!</Text>
          <Text style={styles.capsuleName}>{capsuleName}</Text>
          <Text style={styles.subtitle}>All memories are now revealed ✨</Text>

          {mediaUrls.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.previewRow}>
              {mediaUrls.slice(0, 5).map((url, idx) => (
                <Image
                  key={idx}
                  source={{ uri: url }}
                  style={styles.previewImg}
                />
              ))}
            </ScrollView>
          )}

          <TouchableOpacity style={styles.btn} onPress={onDismiss}>
            <Text style={styles.btnText}>See All Memories →</Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#16161C',
    borderRadius: 28,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(200,169,110,0.4)',
    width: '100%',
    maxWidth: 360,
  },
  lockIcon: { fontSize: 56, marginBottom: 12 },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: '#F0EDE8',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  capsuleName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#C8A96E',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#8A8799',
    textAlign: 'center',
    marginBottom: 20,
  },
  previewRow: {
    gap: 8,
    paddingBottom: 4,
    marginBottom: 20,
  },
  previewImg: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: '#2A2A38',
  },
  btn: {
    backgroundColor: '#C8A96E',
    borderRadius: 16,
    paddingHorizontal: 28,
    paddingVertical: 14,
    width: '100%',
    alignItems: 'center',
  },
  btnText: {
    color: '#0E0E12',
    fontWeight: '800',
    fontSize: 16,
  },
})