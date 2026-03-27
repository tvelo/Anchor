import React, { useEffect, useRef } from 'react'
import { Animated, StyleSheet, type ViewStyle } from 'react-native'

interface Props {
  width?: number | string
  height?: number
  borderRadius?: number
  style?: ViewStyle
}

export function SkeletonCard({ width = '100%', height = 80, borderRadius = 12, style }: Props) {
  const opacity = useRef(new Animated.Value(0.4)).current

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ]),
    )
    anim.start()
    return () => anim.stop()
  }, [])

  return (
    <Animated.View
      style={[s.card, { width: width as any, height, borderRadius, opacity }, style]}
      accessibilityRole="none"
      accessibilityLabel="Loading"
    />
  )
}

const s = StyleSheet.create({
  card: { backgroundColor: '#3D2E52' },
})
