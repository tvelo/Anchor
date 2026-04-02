import { Audio } from 'expo-av'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import React, { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, Alert, Dimensions, Image,
  KeyboardAvoidingView, Modal, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'
import { captureRef } from 'react-native-view-shot'
import { fetchLinkPreview } from '../lib/linkPreview'
import { safeString } from '../lib/safeContent'
import { storageUploadUrl } from '../lib/storage'
import { supabase } from '../lib/supabase'
import { getLimits, useAnchorPlus } from '../lib/useAnchorPlus'
import { WIDGET_TEMPLATES, type WidgetTemplate } from '../lib/widgetTemplates'
import DailyPromptWidget from './DailyPromptWidget'
import ProjectChat from './ProjectChat'

const MIN_ZOOM = 0.15
const MAX_ZOOM = 4
const CANVAS_SIZE = 4000
const HALF = CANVAS_SIZE / 2
const { width: SW, height: SH } = Dimensions.get('window')

const MOOD_EMOJIS = ['😔', '😐', '🙂', '😍', '🤩']
const STYLE_COLORS = [
  'transparent', '#2D2040', '#1A1118', '#221A2C', '#1A2F1E',
  '#C9956C', '#B8A9D9', '#EF4444', '#3B82F6', '#22C55E',
  '#EAB308', '#EC4899', '#FFFFFF', '#F5EEF8',
]
const TEXT_COLORS = [
  '#F5EEF8', '#FFFFFF', '#C9956C', '#B8A9D9', '#EF4444',
  '#3B82F6', '#22C55E', '#EAB308', '#9B8FAD', '#1A1118',
]
const FONT_FAMILIES: { key: string; label: string }[] = [
  { key: 'default', label: 'Default' },
  { key: 'serif', label: 'Serif' },
  { key: 'monospace', label: 'Mono' },
]
const PHOTO_FRAMES: { key: string; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'polaroid', label: 'Polaroid' },
  { key: 'film', label: 'Film' },
  { key: 'shadow', label: 'Shadow' },
  { key: 'circle', label: 'Circle' },
]
const KNOCK_EMOJIS = ['✨', '💛', '🔔', '👋', '💫', '🫶', '💋', '❤️‍🔥']
const BG_COLORS = [
  '#1A1118', '#221A2C', '#0D1117', '#1A2F1E', '#2A1A1A',
  '#2A2A1A', '#1A1A2A', '#0A0A0A', '#1E1B2E', '#2D1B1B',
]

type PatternKey = 'none' | 'dots' | 'grid' | 'diagonal' | 'hearts' | 'stars' | 'waves'
const PATTERNS: { key: PatternKey; label: string; emoji: string }[] = [
  { key: 'none', label: 'Plain', emoji: '◼' },
  { key: 'dots', label: 'Dots', emoji: '⚬' },
  { key: 'grid', label: 'Grid', emoji: '⊞' },
  { key: 'diagonal', label: 'Lines', emoji: '╱' },
  { key: 'hearts', label: 'Hearts', emoji: '♡' },
  { key: 'stars', label: 'Stars', emoji: '✦' },
  { key: 'waves', label: 'Waves', emoji: '〜' },
]

const WEATHER_CODES: Record<number, string> = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️',
  51: '🌧️', 53: '🌧️', 55: '🌧️', 61: '🌧️', 63: '🌧️', 65: '🌧️',
  71: '❄️', 73: '❄️', 75: '❄️', 80: '🌦️', 81: '🌦️', 82: '🌦️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
}
function getWeatherEmoji(code: number) {
  if (WEATHER_CODES[code]) return WEATHER_CODES[code]
  if (code <= 3) return '🌤️'
  if (code <= 48) return '🌫️'
  if (code <= 67) return '🌧️'
  if (code <= 77) return '❄️'
  return '⛈️'
}

async function pickImage() {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) return null
  const opts: ImagePicker.ImagePickerOptions = { quality: 0.8 }
  // @ts-ignore
  opts.mediaTypes = (ImagePicker as any).MediaType?.Images ?? ImagePicker.MediaTypeOptions.Images
  const result = await ImagePicker.launchImageLibraryAsync(opts)
  if (result.canceled) return null
  return result.assets[0].uri
}

type WidgetType = 'photo' | 'note' | 'song' | 'countdown' | 'mood' | 'capsule' | 'weather' | 'homewidget' | 'sticker' | 'link' | 'voice' | 'photostack' | 'map' | 'poll' | 'knock' | 'dailyprompt'
type ActiveModal = null | 'note' | 'song' | 'countdown' | 'weather' | 'capsule' | 'bgmusic' | 'background' | 'homewidget' | 'sticker' | 'link' | 'templates' | 'voice' | 'photostack' | 'map' | 'poll' | 'knock' | 'dailyprompt'
type Widget = {
  id: string; canvas_id: string; type: WidgetType
  x: number; y: number; width: number; height: number
  z_index: number; content: any; style: any
}

function dedupeWidgets(ws: Widget[]): Widget[] {
  return [...new Map(ws.map(w => [w.id, w])).values()]
}

// CanvasPattern: screen-filling grid that tiles with pan+zoom
// Using modulo offset so the pattern appears infinite in all directions
// Unconditional wrapper — hooks always called here, avoiding Rules of Hooks violation
function CanvasPatternWrapper({ pattern, color, translateX, translateY, scale }: {
  pattern: PatternKey; color: string
  translateX: SharedValue<number>; translateY: SharedValue<number>; scale: SharedValue<number>
}) {
  const GRID = 60

  const offsetStyle = useAnimatedStyle(() => {
    const s = scale.value
    const spacing = GRID * s
    const ox = ((translateX.value % spacing) + spacing) % spacing
    const oy = ((translateY.value % spacing) + spacing) % spacing
    return { transform: [{ translateX: ox - spacing }, { translateY: oy - spacing }] }
  })

  const gridStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    transformOrigin: '0 0',
  }))

  return <CanvasPattern pattern={pattern} color={color} offsetStyle={offsetStyle} gridStyle={gridStyle} />
}

const CanvasPattern = React.memo(function CanvasPattern({ pattern, color, offsetStyle, gridStyle }: {
  pattern: PatternKey; color: string
  offsetStyle: any; gridStyle: any
}) {
  if (pattern === 'none') return null

  const isDark = color === '#1A1118' || color === '#0A0A0A' || color === '#0E0E12'
  const lineColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)'
  const dotColor = isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.18)'
  const emojiOpacity = isDark ? 0.18 : 0.14

  const GRID = 60
  const cols = Math.ceil(SW / GRID) + 3
  const rows = Math.ceil(SH / GRID) + 3

  if (pattern === 'dots') {
    const dots: React.ReactElement[] = []
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        dots.push(<View key={`${r}-${c}`} style={{ position: 'absolute', left: c * GRID + GRID / 2 - 2, top: r * GRID + GRID / 2 - 2, width: 4, height: 4, borderRadius: 2, backgroundColor: dotColor }} />)
    return (
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0 }, offsetStyle]} pointerEvents="none">
        <Animated.View style={[{ position: 'absolute', top: 0, left: 0 }, gridStyle]}>
          {dots}
        </Animated.View>
      </Animated.View>
    )
  }

  if (pattern === 'grid') {
    const lines: React.ReactElement[] = []
    for (let c = 0; c < cols; c++)
      lines.push(<View key={`v${c}`} style={{ position: 'absolute', left: c * GRID, top: 0, width: 1, height: rows * GRID, backgroundColor: lineColor }} />)
    for (let r = 0; r < rows; r++)
      lines.push(<View key={`h${r}`} style={{ position: 'absolute', top: r * GRID, left: 0, height: 1, width: cols * GRID, backgroundColor: lineColor }} />)
    return (
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0 }, offsetStyle]} pointerEvents="none">
        <Animated.View style={[{ position: 'absolute', top: 0, left: 0 }, gridStyle]}>
          {lines}
        </Animated.View>
      </Animated.View>
    )
  }

  if (pattern === 'diagonal') {
    const lines: React.ReactElement[] = []
    for (let c = 0; c < cols + rows; c++)
      lines.push(<View key={c} style={{ position: 'absolute', left: c * GRID - rows * GRID, top: 0, width: 1, height: (cols + rows) * GRID * 1.5, backgroundColor: lineColor, transform: [{ rotate: '45deg' }] }} />)
    return (
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0 }, offsetStyle]} pointerEvents="none">
        <Animated.View style={[{ position: 'absolute', top: 0, left: 0 }, gridStyle]}>
          {lines}
        </Animated.View>
      </Animated.View>
    )
  }

  const emojiMap: Record<string, string> = { hearts: '♡', stars: '✦', waves: '〜' }
  const emoji = emojiMap[pattern]
  if (emoji) {
    const SPACING = pattern === 'waves' ? GRID * 1.2 : GRID * 1.6
    const items: React.ReactElement[] = []
    const eRows = Math.ceil(rows * GRID / SPACING) + 2
    const eCols = Math.ceil(cols * GRID / SPACING) + 2
    for (let r = 0; r < eRows; r++)
      for (let c = 0; c < eCols; c++)
        items.push(<Text key={`${r}-${c}`} style={{ position: 'absolute', left: c * SPACING + (r % 2 === 0 ? 0 : SPACING / 2), top: r * SPACING, fontSize: pattern === 'waves' ? 22 : 16, opacity: emojiOpacity, color: isDark ? '#fff' : '#000' }}>{emoji}</Text>)
    return (
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0 }, offsetStyle]} pointerEvents="none">
        <Animated.View style={[{ position: 'absolute', top: 0, left: 0 }, gridStyle]}>
          {items}
        </Animated.View>
      </Animated.View>
    )
  }

  return null
})


// WidgetMirror: read-only content renderer for homewidget clipping
// No gestures, just the visual output of a widget
function WidgetMirror({ widget, userId, spaceId, now, playingSongWidgetId }: {
  widget: Widget; userId: string; spaceId?: string; now: number; playingSongWidgetId: string | null
}) {
  const c = widget.content || {}
  const s = widget.style || {}
  const bg = s.backgroundColor
  const textColor = s.textColor || '#F5EEF8'
  const fontSize = s.fontSize || 14
  const br = s.borderRadius ?? 12

  if (widget.type === 'photo' && c.url)
    return <Image source={{ uri: c.url }} style={{ width: '100%', height: '100%', borderRadius: br }} resizeMode="cover" />

  if (widget.type === 'note')
    return (
      <View style={{ width: '100%', height: '100%', backgroundColor: bg || 'transparent', borderRadius: br, padding: 12 }}>
        <Text style={{ color: textColor, fontSize, lineHeight: fontSize * 1.55 }}>{c.text}</Text>
      </View>
    )

  if (widget.type === 'song')
    return (
      <View style={{ width: '100%', height: '100%', flexDirection: 'row', alignItems: 'center', backgroundColor: bg || '#2D2040', borderRadius: br, padding: 10, gap: 10 }}>
        {c.albumArt ? <Image source={{ uri: c.albumArt }} style={{ width: 48, height: 48, borderRadius: 10 }} /> : null}
        <View style={{ flex: 1, overflow: 'hidden' }}>
          <Text style={{ color: textColor, fontWeight: '700', fontSize: 12 }} numberOfLines={1}>{c.songName}</Text>
          <Text style={{ color: '#9B8FAD', fontSize: 10, marginTop: 2 }} numberOfLines={1}>{c.artist}</Text>
        </View>
      </View>
    )

  if (widget.type === 'countdown') {
    const target = c.targetDate ? new Date(c.targetDate).getTime() : null
    let d = '--', h = '--', m = '--', sec = '--'
    if (target && !isNaN(target)) {
      const diff = Math.max(0, target - now); const total = Math.floor(diff / 1000)
      d = String(Math.floor(total / 86400)); h = String(Math.floor((total % 86400) / 3600)).padStart(2, '0')
      m = String(Math.floor((total % 3600) / 60)).padStart(2, '0'); sec = String(total % 60).padStart(2, '0')
    }
    return (
      <View style={{ width: '100%', height: '100%', backgroundColor: bg || '#2D2040', borderRadius: br, padding: 12, justifyContent: 'space-between' }}>
        <Text style={{ color: textColor, fontWeight: '600', fontSize: Math.max(10, fontSize - 2) }}>{c.label}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[['d', d], ['h', h], ['m', m], ['s', sec]].map(([lbl, val]) => (
            <View key={lbl} style={{ alignItems: 'center' }}>
              <Text style={{ color: textColor, fontWeight: '800', fontSize: 18 }}>{val}</Text>
              <Text style={{ color: '#9B8FAD', fontSize: 8 }}>{lbl}</Text>
            </View>
          ))}
        </View>
      </View>
    )
  }

  if (widget.type === 'mood') {
    const moods = c.moods || {}
    const myMood = (moods as any)[userId]
    const partnerMood = Object.entries(moods).find(([uid]) => uid !== userId)?.[1] as string | undefined
    return (
      <View style={{ width: '100%', height: '100%', backgroundColor: bg || '#2D2040', borderRadius: br, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' }}>
        <View style={{ alignItems: 'center', gap: 4 }}><Text style={{ fontSize: 28 }}>{myMood || '?'}</Text><Text style={{ color: '#9B8FAD', fontSize: 9 }}>You</Text></View>
        <View style={{ width: 1, height: 36, backgroundColor: '#3D2E52' }} />
        <View style={{ alignItems: 'center', gap: 4 }}><Text style={{ fontSize: 28 }}>{myMood ? (partnerMood || '?') : '🔒'}</Text><Text style={{ color: '#9B8FAD', fontSize: 9 }}>Them</Text></View>
      </View>
    )
  }

  if (widget.type === 'weather')
    return (
      <View style={{ width: '100%', height: '100%', flexDirection: 'row', alignItems: 'center', backgroundColor: bg || '#2D2040', borderRadius: br, padding: 12, gap: 10 }}>
        <Text style={{ fontSize: 32 }}>{c.emoji ?? '☁️'}</Text>
        <View>
          <Text style={{ color: textColor, fontWeight: '800', fontSize: 22 }}>{c.temperature ?? '--'}°</Text>
          <Text style={{ color: '#9B8FAD', fontSize: 11 }}>{c.city}</Text>
        </View>
      </View>
    )

  if (widget.type === 'sticker')
    return <View style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: Math.min(widget.width, widget.height) * 0.7 }}>{c.emoji}</Text></View>

  if (widget.type === 'link')
    return (
      <View style={{ width: '100%', height: '100%', backgroundColor: bg || '#2D2040', borderRadius: br, padding: 10, justifyContent: 'center', gap: 4 }}>
        {c.ogImage ? (
          <Image source={{ uri: c.ogImage }} style={{ width: '100%', height: 50, borderRadius: 6, marginBottom: 2 }} resizeMode="cover" />
        ) : (
          <Text style={{ fontSize: 16 }}>🔗</Text>
        )}
        <Text style={{ color: textColor, fontWeight: '700', fontSize: 11 }} numberOfLines={2}>{c.label || c.url}</Text>
        {c.siteName ? <Text style={{ color: '#9B8FAD', fontSize: 9 }}>{c.siteName}</Text> : null}
      </View>
    )

  if (widget.type === 'capsule') {
    const unlockTs = c.unlockDate ? new Date(c.unlockDate).getTime() : null
    const locked = unlockTs ? Date.now() < unlockTs : false
    return (
      <View style={{ width: '100%', height: '100%', backgroundColor: bg || '#2D2040', borderRadius: br, padding: 12, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        {locked ? (
          <><Text style={{ fontSize: 32 }}>🔒</Text><Text style={{ color: textColor, fontSize: 12 }}>Opens in {locked && unlockTs ? Math.ceil((unlockTs - Date.now()) / 86400000) : 0} days</Text></>
        ) : (
          <>{c.photoUrl ? <Image source={{ uri: c.photoUrl }} style={{ width: '100%', height: 70, borderRadius: 8 }} resizeMode="cover" /> : null}<Text style={{ color: textColor, fontSize: 11 }} numberOfLines={3}>{c.note}</Text></>
        )}
      </View>
    )
  }

  if (widget.type === 'dailyprompt' && spaceId) {
    return <DailyPromptWidget spaceId={spaceId} userId={userId} onPress={() => { }} backgroundColor={bg} textColor={textColor} />
  }

  return null
}

type WidgetItemProps = {
  widget: Widget
  canvasScale: SharedValue<number>
  userId: string
  now: number
  onDragEnd: (id: string, x: number, y: number) => void
  onDelete: (id: string) => void
  onStyleOpen: (id: string) => void
  onMoodTap: (id: string) => void
  playingSongWidgetId: string | null
  onSongPlay: (id: string, url: string) => void
  allWidgets: Widget[]
  hwCaptureRef?: (id: string, ref: View | null) => void
  onResize: (id: string, scale: number) => void
  onRotate: (id: string, rotation: number) => void
  onBringToFront: (id: string) => void
  recordingWidgetId: string | null
  spaceId: string
}

function WidgetItem({ widget, canvasScale, userId, now, onDragEnd, onDelete, onStyleOpen, onMoodTap, playingSongWidgetId, onSongPlay, allWidgets, hwCaptureRef, onResize, onRotate, onBringToFront, recordingWidgetId, spaceId }: WidgetItemProps) {
  const [imageLoadError, setImageLoadError] = useState<string | null>(null)
  const posX = useSharedValue(widget.x)
  const posY = useSharedValue(widget.y)
  const startX = useSharedValue(widget.x)
  const startY = useSharedValue(widget.y)
  const dragging = useSharedValue(false)

  const persistentScale = useSharedValue(widget.style?.scale ?? 1)
  const liveScale = useSharedValue(1)
  const savedLiveScale = useSharedValue(1)
  const liveRotation = useSharedValue((widget.style?.rotation ?? 0) * Math.PI / 180)
  const savedRotation = useSharedValue((widget.style?.rotation ?? 0) * Math.PI / 180)

  useEffect(() => {
    if (!dragging.value) { posX.value = widget.x; posY.value = widget.y }
    persistentScale.value = widget.style?.scale ?? 1
    liveRotation.value = (widget.style?.rotation ?? 0) * Math.PI / 180
    savedRotation.value = (widget.style?.rotation ?? 0) * Math.PI / 180
  }, [widget.x, widget.y, widget.style?.rotation, widget.style?.scale])

  // ── Single-finger drag (brings widget to front on start) ──────────────────
  const dragGesture = Gesture.Pan()
    .minPointers(1).maxPointers(1)
    .minDistance(6)
    .onStart(() => {
      startX.value = posX.value; startY.value = posY.value
      dragging.value = true
      runOnJS(Haptics.selectionAsync)()
      runOnJS(onBringToFront)(widget.id)
    })
    .onUpdate(e => {
      posX.value = startX.value + e.translationX / canvasScale.value
      posY.value = startY.value + e.translationY / canvasScale.value
    })
    .onEnd(() => { dragging.value = false; runOnJS(onDragEnd)(widget.id, posX.value, posY.value) })
    .onFinalize(() => { dragging.value = false })

  // ── Two-finger pinch → resize ──────────────────────────────────────────────
  const pinchGesture = Gesture.Pinch()
    .onStart(() => { savedLiveScale.value = liveScale.value })
    .onUpdate(e => {
      // Clamp total visual scale (persistent × live) between 0.3 and 8
      const total = persistentScale.value * savedLiveScale.value * e.scale
      const clamped = Math.max(0.3, Math.min(8, total))
      liveScale.value = clamped / persistentScale.value
    })
    .onEnd(() => {
      // Commit: fold liveScale into persistentScale, reset live to 1
      const newPersistent = Math.max(0.3, Math.min(8, persistentScale.value * liveScale.value))
      persistentScale.value = newPersistent
      liveScale.value = 1
      savedLiveScale.value = 1
      runOnJS(onResize)(widget.id, newPersistent)
      runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light)
    })


  // ── Two-finger rotate ──────────────────────────────────────────────────────
  const rotateGesture = Gesture.Rotation()
    .onStart(() => { savedRotation.value = liveRotation.value })
    .onUpdate(e => { liveRotation.value = savedRotation.value + e.rotation })
    .onEnd(() => {
      savedRotation.value = liveRotation.value
      const deg = Math.round((liveRotation.value * 180 / Math.PI) % 360)
      runOnJS(onRotate)(widget.id, deg)
      runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light)
    })

  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd(() => runOnJS(onStyleOpen)(widget.id))
  const longPress = Gesture.LongPress().minDuration(600).onStart(() => {
    runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Heavy)
    runOnJS(onDelete)(widget.id)
  })
  // For interactive widgets, long press opens style editor instead of delete
  const longPressEdit = Gesture.LongPress().minDuration(600).onStart(() => {
    runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium)
    runOnJS(onStyleOpen)(widget.id)
  })

  // For interactive widgets, disable doubleTap
  // so single taps pass through to inner TouchableOpacity handlers.
  // Long press opens style editor instead of delete (delete is inside editor).
  const INTERACTIVE_TYPES: WidgetType[] = ['knock', 'poll', 'photostack', 'voice', 'mood', 'dailyprompt']
  const isInteractive = INTERACTIVE_TYPES.includes(widget.type)

  // Pinch + Rotate run simultaneously; drag is separate (single finger)
  const twoFingerGesture = Gesture.Simultaneous(pinchGesture, rotateGesture)
  const composed = isInteractive
    ? Gesture.Race(longPressEdit, Gesture.Simultaneous(dragGesture, twoFingerGesture))
    : Gesture.Race(doubleTap, longPress, Gesture.Simultaneous(dragGesture, twoFingerGesture))

  const animStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const, left: 0, top: 0,
    zIndex: widget.z_index || 1,
    opacity: dragging.value ? 0.82 : 1,
    transform: [
      { translateX: posX.value },
      { translateY: posY.value },
      // Combined scale: persistent (saved) × live (gesture-in-progress)
      { scale: persistentScale.value * liveScale.value },
      { rotate: `${liveRotation.value}rad` },
    ],
  }))

  const c = widget.content || {}
  const s = widget.style || {}
  const bg = s.backgroundColor
  const textColor = s.textColor || '#F5EEF8'
  const fontSize = s.fontSize || 14
  const br = s.borderRadius ?? 12

  function renderContent() {
    // ── Photo widget ───────────────────────────────────────────────────────
    if (widget.type === 'photo') {
      const frame = s.frame || 'none'
      const renderImg = () => {
        if (!c.url || imageLoadError) return (
          <View style={{ flex: 1, backgroundColor: '#EF444433', borderRadius: br, alignItems: 'center', justifyContent: 'center', padding: 8 }}>
            <Text style={{ fontSize: 24 }}>⚠️</Text>
            <Text style={{ fontSize: 8, color: '#EF4444', textAlign: 'center' }}>Load Mismatch: {c.url ? 'Broken URL' : 'No URL'}</Text>
          </View>
        )
        return <Image source={{ uri: c.url }} style={{ flex: 1, width: '100%', height: '100%', borderRadius: frame === 'none' || frame === 'shadow' ? br : 0 }} resizeMode="cover" onError={(e) => setImageLoadError(e.nativeEvent.error)} />
      }

      if (frame === 'polaroid') {
        const title = c.label || ''
        return (
          <View style={{ width: '100%', height: '100%', backgroundColor: bg || '#ffffff', borderRadius: br, padding: 8, paddingBottom: 20 }}>
            <View style={{ flex: 1, backgroundColor: '#000', borderRadius: Math.max(0, br - 4), overflow: 'hidden' }}>
              {renderImg()}
            </View>
            {title ? <Text style={{ color: '#000', fontSize: 13, fontFamily: 'Caveat', textAlign: 'center', marginTop: 10 }}>{title}</Text> : null}
          </View>
        )
      }
      if (frame === 'film') {
        return (
          <View style={{ width: '100%', height: '100%', backgroundColor: '#111', borderRadius: br, flexDirection: 'row' }}>
            <View style={{ width: 14, justifyContent: 'space-evenly', alignItems: 'center', paddingVertical: 6 }}>
              {[0, 1, 2, 3, 4, 5].map(i => <View key={i} style={{ width: 8, height: 6, borderRadius: 1, backgroundColor: '#333' }} />)}
            </View>
            <View style={{ flex: 1, paddingVertical: 4, paddingRight: 4, overflow: 'hidden', borderRadius: 2 }}>
              {renderImg()}
            </View>
          </View>
        )
      }
      if (frame === 'circle') {
        const sz = Math.min(widget.width, widget.height)
        return (
          <View style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: sz - 8, height: sz - 8, borderRadius: sz, overflow: 'hidden', backgroundColor: bg || '#1A1118', borderWidth: 2, borderColor: '#3D2E52' }}>
              {renderImg()}
            </View>
          </View>
        )
      }
      // Default / shadow frame
      return renderImg()
    }
    if (widget.type === 'note') {
      const fontFam = s.fontFamily === 'serif' ? 'Georgia' : s.fontFamily === 'monospace' ? (Platform.OS === 'ios' ? 'Courier New' : 'monospace') : undefined
      const align = (s.textAlign as any) || 'left'
      return (
        <View style={{ width: '100%', height: '100%', backgroundColor: bg || c.bg || 'transparent', borderRadius: br, padding: 14 }}>
          <Text style={{ color: textColor, fontSize, lineHeight: fontSize * 1.55, fontFamily: fontFam, textAlign: align }}>{c.text}</Text>
        </View>
      )
    }
    if (widget.type === 'song') {
      const isPlaying = playingSongWidgetId === widget.id
      // Vinyl spin: shared value lives for this render only.
      // We use a ref to track the rotation SharedValue so it persists.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const vinylRot = useSharedValue(0)
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useEffect(() => {
        if (isPlaying) {
          vinylRot.value = withRepeat(withTiming(360, { duration: 3000, easing: Easing.linear }), -1, false)
        } else {
          vinylRot.value = vinylRot.value % 360
        }
      }, [isPlaying])
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const vinylStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${vinylRot.value}deg` }] }))
      return (
        <View style={{ width: '100%', height: '100%', flexDirection: 'row', alignItems: 'center', backgroundColor: bg || '#2D2040', borderRadius: br, padding: 12, gap: 12 }}>
          {c.albumArt ? (
            <Animated.View style={[{ width: 54, height: 54, borderRadius: 27, flexShrink: 0, overflow: 'hidden', borderWidth: isPlaying ? 2 : 0, borderColor: '#C9956C' }, vinylStyle]}>
              <Image source={{ uri: c.albumArt }} style={{ width: '100%', height: '100%', borderRadius: 27 }} />
            </Animated.View>
          ) : <Text style={{ fontSize: 34, flexShrink: 0 }}>🎵</Text>}
          <View style={{ flex: 1, overflow: 'hidden' }}>
            <Text style={{ color: textColor, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>{c.songName}</Text>
            <Text style={{ color: '#9B8FAD', fontSize: 11, marginTop: 2 }} numberOfLines={1}>{c.artist}</Text>
            {c.previewUrl ? (
              <Text style={{ color: '#C9956C', fontSize: 10, marginTop: 5 }}>{isPlaying ? '▶ Playing…' : '🎵 Tap to play'}</Text>
            ) : (
              <Text style={{ color: '#9B8FAD', fontSize: 10, marginTop: 5 }}>No preview</Text>
            )}
          </View>
          {c.previewUrl ? (
            <TouchableOpacity
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isPlaying ? '#C9956C' : '#C9956C33', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              onPress={() => onSongPlay(widget.id, c.previewUrl)}>
              <Text style={{ fontSize: 14 }}>{isPlaying ? '⏸' : '▶'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )
    }

    if (widget.type === 'countdown') {
      const target = c.targetDate ? new Date(c.targetDate).getTime() : null
      let d = '--', h = '--', m = '--', sec = '--'
      if (target && !isNaN(target)) {
        const diff = Math.max(0, target - now)
        const total = Math.floor(diff / 1000)
        d = String(Math.floor(total / 86400))
        h = String(Math.floor((total % 86400) / 3600)).padStart(2, '0')
        m = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
        sec = String(total % 60).padStart(2, '0')
      }
      return (
        <View style={{ width: '100%', height: '100%', backgroundColor: bg || '#2D2040', borderRadius: br, padding: 14, justifyContent: 'space-between' }}>
          <Text style={{ color: textColor, fontWeight: '600', fontSize: Math.max(11, fontSize - 1) }}>{c.label}</Text>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
            {[['d', d], ['h', h], ['m', m], ['s', sec]].map(([lbl, val]) => (
              <View key={lbl} style={{ alignItems: 'center' }}>
                <Text style={{ color: textColor, fontWeight: '800', fontSize: Math.max(fontSize + 6, 20) }}>{val}</Text>
                <Text style={{ color: '#9B8FAD', fontSize: 9, marginTop: 1 }}>{lbl}</Text>
              </View>
            ))}
          </View>
        </View>
      )
    }
    if (widget.type === 'mood') {
      const moods = c.moods || {}
      const myMood = moods[userId]
      const partnerEntry = Object.entries(moods).find(([uid]) => uid !== userId)
      const partnerMood = partnerEntry?.[1] as string | undefined
      return (
        <TouchableOpacity style={{ width: '100%', height: '100%', backgroundColor: bg || '#2D2040', borderRadius: br, padding: 14, justifyContent: 'space-between' }} onPress={() => onMoodTap(widget.id)} activeOpacity={0.85}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', flex: 1 }}>
            <View style={{ alignItems: 'center', gap: 5 }}>
              <Text style={{ fontSize: 30 }}>{myMood || '?'}</Text>
              <Text style={{ color: '#9B8FAD', fontSize: 9 }}>You</Text>
            </View>
            <View style={{ width: 1, height: 36, backgroundColor: '#3D2E52' }} />
            <View style={{ alignItems: 'center', gap: 5 }}>
              <Text style={{ fontSize: 30 }}>{myMood ? (partnerMood || '?') : '🔒'}</Text>
              <Text style={{ color: '#9B8FAD', fontSize: 9 }}>Them</Text>
            </View>
          </View>
          <Text style={{ color: '#9B8FAD', fontSize: 9, textAlign: 'center' }}>tap to set mood</Text>
        </TouchableOpacity>
      )
    }
    if (widget.type === 'capsule') {
      const unlockTs = c.unlockDate ? new Date(c.unlockDate).getTime() : null
      const locked = unlockTs ? Date.now() < unlockTs : false
      const daysLeft = locked && unlockTs ? Math.ceil((unlockTs - Date.now()) / 86400000) : 0
      return locked ? (
        <View style={{ width: '100%', height: '100%', backgroundColor: bg || '#2D2040', borderRadius: br, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Text style={{ fontSize: 34 }}>🔒</Text>
          <Text style={{ color: textColor, fontSize }}>Opens in {daysLeft} days</Text>
        </View>
      ) : (
        <View style={{ width: '100%', height: '100%', backgroundColor: bg || '#2D2040', borderRadius: br, padding: 12, overflow: 'hidden' }}>
          {c.photoUrl ? <Image source={{ uri: c.photoUrl }} style={{ width: '100%', height: 90, borderRadius: 8, marginBottom: 8 }} resizeMode="cover" /> : null}
          <Text style={{ color: textColor, fontSize: 12, lineHeight: 18 }}>{c.note}</Text>
        </View>
      )
    }
    if (widget.type === 'homewidget') {
      const intervalLabel = c.interval || '30m'
      // Find all non-homewidget widgets that overlap this box
      const overlapping = allWidgets.filter(w => {
        if (w.type === 'homewidget' || w.id === widget.id) return false
        return (
          w.x < widget.x + widget.width && w.x + w.width > widget.x &&
          w.y < widget.y + widget.height && w.y + w.height > widget.y
        )
      })
      const isEmpty = overlapping.length === 0 && !c.screenshotUrl
      return (
        // Outer frame — no background so you can see through to the canvas
        <View style={{ width: '100%', height: '100%', borderRadius: br, borderWidth: 2, borderColor: '#C9956C', borderStyle: isEmpty ? 'dashed' : 'solid' }}>
          {/* Label strip at top */}
          <View style={{ position: 'absolute', top: -20, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 }} pointerEvents="none">
            <Text style={{ color: '#C9956C', fontSize: 8, fontWeight: '800', letterSpacing: 0.5 }}>📱 WIDGET</Text>
            <Text style={{ color: '#9B8FAD', fontSize: 8 }}>↻ {intervalLabel}</Text>
          </View>
          {/* Clipping viewport — this is what gets captured */}
          <View
            ref={(r) => hwCaptureRef && hwCaptureRef(widget.id, r)}
            collapsable={false}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: br - 2, overflow: 'hidden', backgroundColor: c.bgColor || '#1A1118' }}>
            {isEmpty ? (
              // Empty hint — invisible on phone widget, just guides the user
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Text style={{ fontSize: 22, opacity: 0.25 }}>⬇️</Text>
                <Text style={{ color: 'rgba(200,169,110,0.4)', fontSize: 9, textAlign: 'center', lineHeight: 14 }}>Drag widgets here{' '}to show on phone</Text>
              </View>
            ) : (
              // Mirror all overlapping widgets, clipped to this box
              overlapping.map(w => (
                <View key={w.id} style={{
                  position: 'absolute',
                  left: w.x - widget.x,
                  top: w.y - widget.y,
                  width: w.width,
                  height: w.height,
                  transform: [{ rotate: `${w.style?.rotation ?? 0}deg` }],
                }} pointerEvents="none">
                  <WidgetMirror widget={w} userId={userId} spaceId={spaceId} now={now} playingSongWidgetId={playingSongWidgetId} />
                </View>
              ))
            )}
          </View>
        </View>
      )
    }
    if (widget.type === 'sticker') {
      return (
        <View style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' }}>
          <Text style={{ fontSize: Math.min(widget.width, widget.height) * 0.7 }}>{c.emoji || '⭐'}</Text>
        </View>
      )
    }
    if (widget.type === 'link') {
      return (
        <View style={{ width: '100%', height: '100%', backgroundColor: bg || '#2D2040', borderRadius: br, padding: 12, justifyContent: 'center', gap: 6 }}>
          {c.ogImage ? (
            <Image source={{ uri: c.ogImage }} style={{ width: '100%', height: 60, borderRadius: 8, marginBottom: 2 }} resizeMode="cover" />
          ) : (
            <Text style={{ fontSize: 20 }}>🔗</Text>
          )}
          <Text style={{ color: textColor, fontWeight: '700', fontSize: Math.max(fontSize, 12) }} numberOfLines={2}>{c.label || c.url}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {c.favicon ? <Image source={{ uri: c.favicon }} style={{ width: 12, height: 12, borderRadius: 2 }} /> : null}
            <Text style={{ color: '#C9956C', fontSize: 10 }} numberOfLines={1}>{c.siteName || c.url}</Text>
          </View>
        </View>
      )
    }
    if (widget.type === 'weather') {
      return (
        <View style={{ width: '100%', height: '100%', flexDirection: 'row', alignItems: 'center', backgroundColor: bg || '#2D2040', borderRadius: br, padding: 14, gap: 12 }}>
          <Text style={{ fontSize: s.iconSize || 34 }}>{c.emoji ?? '☁️'}</Text>
          <View>
            <Text style={{ color: textColor, fontWeight: '800', fontSize: Math.max(fontSize + 8, 22) }}>{c.temperature ?? '--'}°C</Text>
            <Text style={{ color: '#9B8FAD', fontSize: Math.max(fontSize - 2, 10) }}>{c.city}</Text>
          </View>
        </View>
      )
    }
    // ── Knock widget ───────────────────────────────────────────────────────
    if (widget.type === 'knock') {
      const knockCount = c.count || 0
      const knockEmoji = c.emoji || '✨'
      return (
        <TouchableOpacity
          activeOpacity={0.75}
          style={{ width: '100%', height: '100%', backgroundColor: bg || '#2D2040', borderRadius: br, alignItems: 'center', justifyContent: 'center', gap: 8 }}
          onPress={() => onMoodTap(widget.id)}>
          <Text style={{ fontSize: 38 }}>{knockEmoji}</Text>
          <Text style={{ color: textColor, fontWeight: '800', fontSize: 13 }}>Knock</Text>
          <Text style={{ color: '#C9956C', fontSize: 10 }}>{knockCount > 0 ? `${knockCount} knock${knockCount > 1 ? 's' : ''}` : 'tap to knock'}</Text>
        </TouchableOpacity>
      )
    }
    // ── Poll widget ────────────────────────────────────────────────────────
    if (widget.type === 'poll') {
      const options: string[] = c.options || []
      const votes: Record<string, string> = c.votes || {}
      const myVote = votes[userId]
      const counts: Record<string, number> = {}
      options.forEach(o => { counts[o] = 0 })
      Object.values(votes).forEach(v => { if (counts[v] !== undefined) counts[v]++ })
      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      return (
        <View style={{ width: '100%', height: '100%', backgroundColor: bg || '#2D2040', borderRadius: br, padding: 12, gap: 6 }}>
          <Text style={{ color: textColor, fontWeight: '700', fontSize: Math.max(fontSize, 12), marginBottom: 4 }} numberOfLines={2}>{c.question || 'Poll'}</Text>
          {options.map((opt, idx) => {
            const pct = total > 0 ? Math.round((counts[opt] / total) * 100) : 0
            const chosen = myVote === opt
            return (
              <TouchableOpacity key={`poll-${idx}`} onPress={() => onMoodTap(widget.id + ':' + opt)}
                style={{ borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: chosen ? '#C9956C' : '#3D2E52' }}>
                <View style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${pct}%`, backgroundColor: chosen ? '#C9956C22' : '#3D2E5230' }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Text style={{ color: chosen ? '#C9956C' : textColor, fontSize: 11, fontWeight: chosen ? '700' : '400' }}>{opt}</Text>
                  <Text style={{ color: '#9B8FAD', fontSize: 10 }}>{pct}%</Text>
                </View>
              </TouchableOpacity>
            )
          })}
        </View>
      )
    }
    // ── Photo Stack widget ─────────────────────────────────────────────────
    if (widget.type === 'photostack') {
      const urls: string[] = c.urls || []
      const idx: number = c.currentIndex ?? 0
      const url = urls[idx] || null
      return (
        <TouchableOpacity activeOpacity={0.9} style={{ flex: 1, width: '100%', height: '100%' }} onPress={() => onMoodTap(widget.id + ':next')}>
          {url && !imageLoadError ? (
            <Image
              source={{ uri: url }}
              style={{ flex: 1, width: '100%', height: '100%', borderRadius: br }}
              resizeMode="cover"
              onError={(e) => setImageLoadError(e.nativeEvent.error)}
            />
          ) : (
            <View style={{ flex: 1, backgroundColor: imageLoadError ? '#EF444433' : '#2D2040', borderRadius: br, alignItems: 'center', justifyContent: 'center', padding: 8 }}>
              <Text style={{ fontSize: 32 }}>{imageLoadError ? '⚠️' : '🗂️'}</Text>
              {imageLoadError && <Text style={{ fontSize: 8, color: '#EF4444', textAlign: 'center' }}>Load Failed: {url}</Text>}
            </View>
          )}
          {urls.length > 1 && (
            <View style={{ position: 'absolute', bottom: 8, right: 10, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3 }}>
              <Text style={{ color: '#fff', fontSize: 10 }}>{idx + 1}/{urls.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      )
    }
    // ── Voice Note widget ──────────────────────────────────────────────────
    if (widget.type === 'voice') {
      const hasRecording = !!c.url
      const isPlaying = playingSongWidgetId === widget.id
      const isRecording = recordingWidgetId === widget.id
      return (
        <TouchableOpacity activeOpacity={0.8}
          style={{ width: '100%', height: '100%', backgroundColor: bg || '#2D2040', borderRadius: br, alignItems: 'center', justifyContent: 'center', gap: 8 }}
          onPress={() => {
            if (isRecording) { onMoodTap(widget.id + ':record') } // stop recording
            else if (hasRecording) { onSongPlay(widget.id, c.url) }
            else { onMoodTap(widget.id + ':record') } // start recording
          }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: isRecording ? '#EF4444' : isPlaying ? '#C9956C' : hasRecording ? '#C9956C33' : '#EF444433', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 22 }}>{isRecording ? '⏺' : isPlaying ? '⏹' : hasRecording ? '🎙️' : '⏺'}</Text>
          </View>
          <Text style={{ color: textColor, fontSize: 11, fontWeight: '600' }}>{c.label || 'Voice Note'}</Text>
          <Text style={{ color: isRecording ? '#EF4444' : '#9B8FAD', fontSize: 9, fontWeight: isRecording ? '700' : '400' }}>{isRecording ? '●  recording… tap to stop' : isPlaying ? 'playing…' : hasRecording ? 'tap to play' : 'tap to record'}</Text>
        </TouchableOpacity>
      )
    }
    // ── Daily Prompt widget ────────────────────────────────────────────────
    if (widget.type === 'dailyprompt') {
      return <DailyPromptWidget spaceId={spaceId} userId={userId} onPress={() => onMoodTap(widget.id)} backgroundColor={bg} textColor={textColor} />
    }

  }

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={[animStyle, { width: widget.width, height: widget.height }]}>
        <View style={[
          { width: '100%', height: '100%', borderRadius: br, overflow: 'hidden' },
          s.borderWidth ? { borderWidth: s.borderWidth, borderColor: s.borderColor || '#3D2E52' } : {},
          s.shadow ? { shadowColor: s.shadowColor || '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: (s.shadowBlur || 10) / 2, elevation: 8 } : {},
          s.opacity != null ? { opacity: s.opacity } : {},
        ]}>
          {renderContent()}
        </View>
      </Animated.View>
    </GestureDetector>
  )
}

// ─── Main Canvas Component ────────────────────────────────────────────────────
export default function SpaceCanvas({ spaceId, onBack }: { spaceId: string; onBack: () => void }) {
  const [canvasId, setCanvasId] = useState<string | null>(null)
  const [canvasName, setCanvasName] = useState('')
  const [canvasBgColor, setCanvasBgColor] = useState('#1A1118')
  const [canvasPattern, setCanvasPattern] = useState<PatternKey>('none')
  const [widgets, setWidgets] = useState<Widget[]>([])
  const widgetsRef = useRef<Widget[]>(widgets)
  useEffect(() => { widgetsRef.current = widgets }, [widgets])
  const [userId, setUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const { isPlus } = useAnchorPlus()
  const limits = getLimits(isPlus)

  const [chatOpen, setChatOpen] = useState(false)
  const [shareWidget, setShareWidget] = useState<Widget | null>(null)

  const soundRef = useRef<Audio.Sound | null>(null)
  const [bgPlaying, setBgPlaying] = useState(false)
  const [bgSongName, setBgSongName] = useState<string | null>(null)
  const [bgSongUrl, setBgSongUrl] = useState<string | null>(null)
  const [bgVolume, setBgVolume] = useState(0.4)

  const [moodWidgetId, setMoodWidgetId] = useState<string | null>(null)
  const [styleWidgetId, setStyleWidgetId] = useState<string | null>(null)
  const [styleTab, setStyleTab] = useState<'look' | 'size'>('look')
  const [toolbarOpen, setToolbarOpen] = useState(false)
  const [activeModal, setActiveModal] = useState<ActiveModal>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')

  // Canvas pan/zoom state
  const translateX = useSharedValue(SW / 2 - HALF)
  const translateY = useSharedValue(SH / 2 - HALF)
  const savedX = useSharedValue(SW / 2 - HALF)
  const savedY = useSharedValue(SH / 2 - HALF)
  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  // Saved focal point for focal-point zoom
  const focalX = useSharedValue(0)
  const focalY = useSharedValue(0)

  const [noteText, setNoteText] = useState('')
  const [songQuery, setSongQuery] = useState('')
  const [songResults, setSongResults] = useState<any[]>([])
  const [songSearching, setSongSearching] = useState(false)
  const [countdownLabel, setCountdownLabel] = useState('')
  const [countdownDate, setCountdownDate] = useState('')
  const [weatherCity, setWeatherCity] = useState('')
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [capsuleNote, setCapsuleNote] = useState('')
  const [capsuleUnlockDate, setCapsuleUnlockDate] = useState('')
  const [selectedBgColor, setSelectedBgColor] = useState('#1A1118')
  const canvasViewRef = useRef<View>(null)
  const hwViewRefs = useRef<Record<string, View>>({})
  const captureTimersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})
  const [bgMusicQuery, setBgMusicQuery] = useState('')
  const [hwSize, setHwSize] = useState<'small' | 'medium' | 'large'>('medium')
  const [hwContent, setHwContent] = useState('')
  const [stickerEmoji, setStickerEmoji] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [bgMusicResults, setBgMusicResults] = useState<any[]>([])
  const [bgMusicSearching, setBgMusicSearching] = useState(false)
  const [playingSongWidgetId, setPlayingSongWidgetId] = useState<string | null>(null)
  const songSoundRef = useRef<any>(null)
  const recordingRef = useRef<Audio.Recording | null>(null)
  const [recordingWidgetId, setRecordingWidgetId] = useState<string | null>(null)
  const knockSavesRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [selectedPattern, setSelectedPattern] = useState<PatternKey>('none')

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: true })
  }, [])

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync()
      songSoundRef.current?.unloadAsync?.()
      const timers = captureTimersRef.current
      Object.keys(timers).forEach(id => { clearInterval(timers[id]); delete timers[id] })
    }
  }, [])

  async function playBgMusic(url: string) {
    try {
      if (soundRef.current) { await soundRef.current.unloadAsync(); soundRef.current = null }
      const { sound } = await Audio.Sound.createAsync({ uri: url }, { isLooping: true, volume: bgVolume, shouldPlay: true })
      soundRef.current = sound
      setBgPlaying(true)
    } catch (e) { console.log('Audio error', e) }
  }

  async function toggleBgPlay() {
    if (!soundRef.current) { if (bgSongUrl) await playBgMusic(bgSongUrl); return }
    const status = await soundRef.current.getStatusAsync()
    if ('isPlaying' in status) {
      if (status.isPlaying) { await soundRef.current.pauseAsync(); setBgPlaying(false) }
      else { await soundRef.current.playAsync(); setBgPlaying(true) }
    }
  }

  async function handleBgVolumeChange(v: number) {
    setBgVolume(v)
    await soundRef.current?.setVolumeAsync(v)
    if (canvasId) await supabase.from('canvases').update({ bg_song_volume: v }).eq('id', canvasId)
  }

  async function handleRemoveBgMusic() {
    if (!canvasId) return
    await soundRef.current?.unloadAsync(); soundRef.current = null
    setBgPlaying(false); setBgSongName(null); setBgSongUrl(null)
    await supabase.from('canvases').update({ bg_song_url: null, bg_song_name: null }).eq('id', canvasId)
    setActiveModal(null)
  }

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
    // Load the specific space by ID
    const { data: canvas } = await supabase.from('canvases').select('*').eq('id', spaceId).maybeSingle()
    if (!canvas) { setLoading(false); return }
    setCanvasId(canvas.id)
    setCanvasName(canvas.name)
    setNameInput(canvas.name)
    const bgColor = canvas.background_value || '#1A1118'
    const bgPattern = canvas.theme || 'none'
    setCanvasBgColor(bgColor); setCanvasPattern(bgPattern as PatternKey)
    setSelectedBgColor(bgColor); setSelectedPattern(bgPattern as PatternKey)
    if (canvas.bg_song_url) {
      setBgSongUrl(canvas.bg_song_url)
      setBgSongName(canvas.bg_song_name || 'Space music')
      if (canvas.bg_song_volume != null) setBgVolume(canvas.bg_song_volume)
      await playBgMusic(canvas.bg_song_url)
    }
    const { data: widgetData } = await supabase.from('canvas_widgets').select('*').eq('canvas_id', canvas.id)
    const loaded = dedupeWidgets((widgetData as Widget[]) || [])
    setWidgets(loaded)
    // Start capture timers for any existing home widgets
    loaded.filter(w => w.type === 'homewidget').forEach(startWidgetCapture)
    setLoading(false)
  }

  useEffect(() => { load() }, [spaceId])

  useEffect(() => {
    if (!canvasId) return
    const ch = supabase.channel(`canvas-space-${canvasId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'canvas_widgets', filter: `canvas_id=eq.${canvasId}` }, p => {
        setWidgets(prev => dedupeWidgets([...prev, p.new as Widget]))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'canvas_widgets', filter: `canvas_id=eq.${canvasId}` }, p => {
        setWidgets(prev => prev.map(w => {
          if (w.id !== p.new.id) return w
          // Don't override x/y if this widget is currently being dragged locally
          // (dragging.value is on the child WidgetItem, so we just accept remote updates
          //  since the local drag end will overwrite with the correct final position)
          return p.new as Widget
        }))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'canvas_widgets', filter: `canvas_id=eq.${canvasId}` }, p => {
        setWidgets(prev => prev.filter(w => w.id !== (p.old as Widget).id))
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [canvasId])

  async function saveSpaceName() {
    if (!canvasId || !safeString(nameInput).trim()) { setEditingName(false); return }
    const name = safeString(nameInput).trim()
    setCanvasName(name); setEditingName(false)
    await supabase.from('canvases').update({ name }).eq('id', canvasId)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }

  async function applyBackground() {
    if (!canvasId) return
    setCanvasBgColor(selectedBgColor); setCanvasPattern(selectedPattern)
    await supabase.from('canvases').update({ background_value: selectedBgColor, theme: selectedPattern }).eq('id', canvasId)
    setActiveModal(null)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }

  // ── Canvas pan (single finger only) ─────────────────────────────────────────
  const panGesture = Gesture.Pan()
    .minPointers(1).maxPointers(1)
    .onStart(() => { savedX.value = translateX.value; savedY.value = translateY.value })
    .onUpdate(e => {
      translateX.value = savedX.value + e.translationX
      translateY.value = savedY.value + e.translationY
    })
    .onEnd(() => { savedX.value = translateX.value; savedY.value = translateY.value })

  const pinchFocalX = useSharedValue(0)
  const pinchFocalY = useSharedValue(0)

  // ── Pinch to zoom (Focal-Point Aware) ───────────────────────────────────────
  const pinchGesture = Gesture.Pinch()
    .onStart((e) => {
      savedScale.value = scale.value
      savedX.value = translateX.value
      savedY.value = translateY.value
      pinchFocalX.value = e.focalX
      pinchFocalY.value = e.focalY
    })
    .onUpdate(e => {
      const nextScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, savedScale.value * e.scale))
      const deltaScale = nextScale / savedScale.value

      scale.value = nextScale
      // Canvas scales around its own centre (HALF,HALF), so subtract HALF from
      // the focal point before applying the standard focal-zoom formula.
      translateX.value = (pinchFocalX.value - HALF) * (1 - deltaScale) + savedX.value * deltaScale
      translateY.value = (pinchFocalY.value - HALF) * (1 - deltaScale) + savedY.value * deltaScale
    })
    .onEnd(() => {
      savedScale.value = scale.value
      savedX.value = translateX.value
      savedY.value = translateY.value
    })

  const canvasGesture = Gesture.Simultaneous(panGesture, pinchGesture)

  const canvasStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }))

  function centerCanvas() {
    translateX.value = SW / 2 - HALF; translateY.value = SH / 2 - HALF
    savedX.value = SW / 2 - HALF; savedY.value = SH / 2 - HALF
    scale.value = 1; savedScale.value = 1
  }

  function getSpawnPos(w: number, h: number) {
    // screenCenter = (canvasX - HALF) * scale + translateX + HALF
    // Solving for canvasX that maps to screen center:
    const cx = (SW / 2 - translateX.value - HALF) / scale.value + HALF
    const cy = (SH / 2 - translateY.value - HALF) / scale.value + HALF
    return { x: cx - w / 2, y: cy - h / 2 }
  }

  async function handleBringToFront(id: string) {
    const maxZ = widgetsRef.current.reduce((mx, w) => Math.max(mx, w.z_index || 0), 0)
    const w = widgetsRef.current.find(x => x.id === id)
    if (!w || (w.z_index || 0) >= maxZ) return
    const newZ = maxZ + 1
    setWidgets(prev => prev.map(x => x.id === id ? { ...x, z_index: newZ } : x))
    await supabase.from('canvas_widgets').update({ z_index: newZ }).eq('id', id)
  }

  // ── Home widget screenshot capture ──────────────────────────────────────────
  function intervalMs() {
    return limits.widgetRefreshMin * 60000
  }

  async function captureAndUploadWidget(hw: Widget) {
    if (!canvasId) return
    // Use the specific homewidget's clipping view — gives us just the box contents
    const viewRef = hwViewRefs.current[hw.id] || canvasViewRef.current
    if (!viewRef) return
    try {
      const uri = await captureRef(viewRef, { format: 'jpg', quality: 0.9 })
      // Upload to Supabase
      const { data: { session } } = await supabase.auth.getSession()
      const path = `${canvasId}/widget-${hw.id}-${Date.now()}.jpg`
      const fd = new FormData()
      fd.append('file', { uri, name: 'widget.jpg', type: 'image/jpeg' } as any)
      const res = await fetch(storageUploadUrl('canvas-images', path),
        { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'x-upsert': 'true' }, body: fd })
      if (!res.ok) return
      const imageUrl = supabase.storage.from('canvas-images').getPublicUrl(path).data.publicUrl
      const newContent = { ...hw.content, screenshotUrl: imageUrl, lastCapture: new Date().toISOString() }
      setWidgets(prev => prev.map(w => w.id === hw.id ? { ...w, content: newContent } : w))
      await supabase.from('canvas_widgets').update({ content: newContent }).eq('id', hw.id)
    } catch (e) { console.log('Widget capture failed', e) }
  }

  function startWidgetCapture(hw: Widget) {
    if (!spaceId) return
    if (captureTimersRef.current[hw.id]) clearInterval(captureTimersRef.current[hw.id])
    const ms = intervalMs()
    captureTimersRef.current[hw.id] = setInterval(() => captureAndUploadWidget(hw), ms)
  }

  function stopWidgetCapture(id: string) {
    if (captureTimersRef.current[id]) { clearInterval(captureTimersRef.current[id]); delete captureTimersRef.current[id] }
  }

  async function handleDragEnd(id: string, x: number, y: number) {
    // Check if this widget was dropped onto a homewidget
    const draggedWidget = widgets.find(w => w.id === id)
    if (draggedWidget && draggedWidget.type !== 'homewidget') {
      const homeWidgets = widgets.filter(w => w.type === 'homewidget' && w.id !== id)
      for (const hw of homeWidgets) {
        const overlapX = x < hw.x + hw.width && x + draggedWidget.width > hw.x
        const overlapY = y < hw.y + hw.height && y + draggedWidget.height > hw.y
        if (overlapX && overlapY) {
          // Trigger an immediate capture so the screenshot updates right away
          setTimeout(() => captureAndUploadWidget(hw), 300)
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          break
        }
      }
    }
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, x, y } : w))
    await supabase.from('canvas_widgets').update({ x, y }).eq('id', id)
  }

  function buildWidgetSummary(w: Widget): string {
    const c = w.content || {}
    switch (w.type) {
      case 'note': return c.text || ''
      case 'song': return `🎵 ${c.songName || ''} — ${c.artist || ''}`
      case 'countdown': return c.label ? `⏳ ${c.label}` : ''
      case 'mood': return `My mood: ${Object.values(c.moods || {})[0] || '?'}`
      case 'weather': return `${c.emoji || '☁️'} ${c.temperature ?? '--'}° ${c.city || ''}`
      case 'photo': return '📷 Photo'
      case 'capsule': return c.note ? `📦 ${c.note}` : '📦 Capsule'
      case 'link': return c.label || c.url || ''
      case 'sticker': return c.emoji || ''
      default: return ''
    }
  }

  function handleDelete(id: string) {
    Alert.alert('Remove widget?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('canvas_widgets').delete().eq('id', id)
          setWidgets(prev => prev.filter(w => w.id !== id))
          if (styleWidgetId === id) setStyleWidgetId(null)
        }
      },
    ])
  }


  function handleStyleOpen(id: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setStyleWidgetId(id); setStyleTab('look')
  }

  async function updateWidgetStyle(id: string, updates: Record<string, any>) {
    const w = widgets.find(x => x.id === id)
    if (!w) return
    const newStyle = { ...w.style, ...updates }
    setWidgets(prev => prev.map(x => x.id === id ? { ...x, style: newStyle } : x))
    await supabase.from('canvas_widgets').update({ style: newStyle }).eq('id', id)
  }

  async function updateWidgetSize(id: string, width: number, height: number) {
    setWidgets(prev => prev.map(x => x.id === id ? { ...x, width, height } : x))
    await supabase.from('canvas_widgets').update({ width, height }).eq('id', id)
  }

  async function updateWidgetContent(id: string, updates: Record<string, any>) {
    const w = widgets.find(x => x.id === id)
    if (!w) return
    const newContent = { ...w.content, ...updates }
    setWidgets(prev => prev.map(x => x.id === id ? { ...x, content: newContent } : x))
    await supabase.from('canvas_widgets').update({ content: newContent }).eq('id', id)
  }

  async function insertWidget(type: WidgetType, content: any, w = 280, h = 180) {
    if (!canvasId || !userId) return
    const pos = getSpawnPos(w, h)
    const nextZ = widgets.reduce((mx, x) => Math.max(mx, x.z_index || 0), 0) + 1
    const { data, error } = await supabase.from('canvas_widgets')
      .insert({ canvas_id: canvasId, type, x: pos.x, y: pos.y, width: w, height: h, z_index: nextZ, content, style: {} })
      .select('*').single()
    if (!error && data) {
      setWidgets(prev => dedupeWidgets([...prev, data as Widget]))
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    }
    closeModal()
  }

  async function applyTemplate(template: WidgetTemplate) {
    if (!canvasId || !userId) return
    closeModal()
    let nextZ = widgets.reduce((mx, x) => Math.max(mx, x.z_index || 0), 0) + 1
    const newWidgets: Widget[] = []
    for (const tw of template.widgets) {
      const { data, error } = await supabase.from('canvas_widgets')
        .insert({ canvas_id: canvasId, type: tw.type, x: tw.x, y: tw.y, width: tw.width, height: tw.height, z_index: nextZ++, content: tw.content, style: tw.style ?? {} })
        .select('*').single()
      if (!error && data) newWidgets.push(data as Widget)
    }
    if (newWidgets.length > 0) {
      setWidgets(prev => dedupeWidgets([...prev, ...newWidgets]))
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    }
  }

  function closeModal() {
    setActiveModal(null)
    setNoteText(''); setSongQuery(''); setSongResults([])
    setCountdownLabel(''); setCountdownDate('')
    setWeatherCity(''); setCapsuleNote(''); setCapsuleUnlockDate('')
  }

  function closeToolbar() { setToolbarOpen(false) }
  function openModal(m: ActiveModal) { closeToolbar(); setTimeout(() => setActiveModal(m), 120) }

  async function uploadImage(uri: string, pathPrefix: string, isAudio = false): Promise<string | null> {
    if (!canvasId) return null
    try {
      let ext = uri.split('.').pop() || ''
      if (ext === uri || ext.length > 10 || ext.includes('/')) {
        ext = isAudio ? 'm4a' : 'jpg'
      }
      const mime = isAudio ? (ext === 'm4a' ? 'audio/m4a' : `audio/${ext}`) : 'image/jpeg'
      const path = `${canvasId}/${pathPrefix}-${Date.now()}.${ext}`
      const formData = new FormData()
      formData.append('file', { uri, name: `${pathPrefix}.${ext}`, type: mime } as any)
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(
        storageUploadUrl('canvas-images', path),
        { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'x-upsert': 'true' }, body: formData }
      )
      if (!response.ok) { Alert.alert('Upload failed', await response.text()); return null }
      const { data } = supabase.storage.from('canvas-images').getPublicUrl(path)
      Alert.alert('Debug URL', `Uploaded to:\n${data.publicUrl}`)
      return data.publicUrl
    } catch (e: any) { Alert.alert('Upload failed', e.message); return null }
  }

  async function handleAddPhoto() {
    closeToolbar()
    const uri = await pickImage(); if (!uri) return
    const url = await uploadImage(uri, 'photo'); if (!url) return
    await insertWidget('photo', { url }, 260, 200)
  }

  async function handleReplaceImage(id: string) {
    const uri = await pickImage(); if (!uri) return
    const url = await uploadImage(uri, 'replace'); if (!url) return
    const widget = widgets.find(w => w.id === id); if (!widget) return
    const field = widget.type === 'photo' ? 'url' : widget.type === 'capsule' ? 'photoUrl' : 'albumArt'
    const newContent = { ...widget.content, [field]: url }
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, content: newContent } : w))
    await supabase.from('canvas_widgets').update({ content: newContent }).eq('id', id)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }

  async function handleBgMusicSearch() {
    if (!bgMusicQuery.trim()) return
    setBgMusicSearching(true)
    try {
      const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(bgMusicQuery)}&media=music&limit=8`)
      const json = await res.json()
      setBgMusicResults(json.results ?? [])
    } catch { Alert.alert('Search failed') }
    setBgMusicSearching(false)
  }

  async function handleSongWidgetPlay(widgetId: string, previewUrl: string) {
    // If same widget, toggle
    if (playingSongWidgetId === widgetId) {
      try { await songSoundRef.current?.pauseAsync() } catch { }
      setPlayingSongWidgetId(null)
      return
    }
    // Stop previous
    try { await songSoundRef.current?.unloadAsync() } catch { }
    songSoundRef.current = null
    setPlayingSongWidgetId(widgetId)
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false })
      const { sound } = await Audio.Sound.createAsync({ uri: previewUrl }, { isLooping: false, volume: 1.0, shouldPlay: true })
      songSoundRef.current = sound
      sound.setOnPlaybackStatusUpdate((s: any) => {
        if (s.didJustFinish) setPlayingSongWidgetId(null)
      })
    } catch (err: any) {
      Alert.alert('Playback failed', `Could not load audio. Error: ${err.message}\nURL: ${previewUrl}`)
      setPlayingSongWidgetId(null)
    }
  }

  async function handleSongSearch() {
    if (!songQuery.trim()) return
    setSongSearching(true)
    try {
      const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(songQuery)}&media=music&limit=8`)
      const json = await res.json()
      setSongResults(json.results ?? [])
    } catch { Alert.alert('Search failed') }
    setSongSearching(false)
  }

  async function handleAddCountdown() {
    if (!countdownLabel.trim() || !countdownDate) { Alert.alert('Fill in all fields'); return }
    await insertWidget('countdown', { label: safeString(countdownLabel).trim(), targetDate: safeString(countdownDate).trim() }, 260, 140)
  }

  async function handleAddWeather() {
    if (!weatherCity.trim()) return
    setWeatherLoading(true)
    try {
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(weatherCity.trim())}&count=1`)
      const geoJson = await geoRes.json()
      const loc = geoJson.results?.[0]
      if (!loc) { Alert.alert('City not found'); setWeatherLoading(false); return }
      const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weathercode`)
      const wJson = await wRes.json()
      const temp = Math.round(wJson.current?.temperature_2m ?? 0)
      const emoji = getWeatherEmoji(wJson.current?.weathercode ?? 0)
      await insertWidget('weather', { city: weatherCity.trim(), temperature: temp, emoji }, 220, 120)
    } catch { Alert.alert('Could not fetch weather') }
    setWeatherLoading(false)
  }

  async function handleAddCapsule() {
    if (!capsuleNote.trim() || !capsuleUnlockDate) { Alert.alert('Fill in all fields'); return }
    let photoUrl = null
    const uri = await pickImage()
    if (uri) photoUrl = await uploadImage(uri, 'capsule')
    await insertWidget('capsule', { photoUrl, note: capsuleNote.trim(), unlockDate: capsuleUnlockDate }, 260, 220)
  }

  async function handleSetMood(widgetId: string, emoji: string) {
    const widget = widgets.find(w => w.id === widgetId)
    if (!widget || !userId) return
    const newContent = { ...widget.content, moods: { ...(widget.content?.moods || {}), [userId]: emoji } }
    setWidgets(prev => prev.map(w => w.id === widgetId ? { ...w, content: newContent } : w))
    await supabase.from('canvas_widgets').update({ content: newContent }).eq('id', widgetId)
    setMoodWidgetId(null)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }

  // Extended tap handler for compound widget types (knock, poll option, photostack next)
  async function handleWidgetTap(compoundId: string) {
    // compoundId may be "widgetId" or "widgetId:action"
    const [widgetId, action] = compoundId.split(':')
    const widget = widgets.find(w => w.id === widgetId)
    if (!widget) {
      // fallback: treat as mood widget
      setMoodWidgetId(compoundId)
      return
    }
    if (widget.type === 'mood') { setMoodWidgetId(widgetId); return }
    if (widget.type === 'dailyprompt') { setActiveModal('dailyprompt'); return }
    if (widget.type === 'knock') {
      const fresh = widgetsRef.current.find(w => w.id === widgetId)
      const currentCount = fresh?.content?.count || 0
      const newCount = currentCount + 1
      const newContent = { ...(fresh?.content || widget.content), count: newCount, lastKnock: new Date().toISOString() }

      // Update local state immediately for instant feedback
      setWidgets(prev => prev.map(w => w.id === widgetId ? { ...w, content: newContent } : w))
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)

      // Debounce the Supabase update to prevent realtime stream clashes when spamming
      if (knockSavesRef.current[widgetId]) clearTimeout(knockSavesRef.current[widgetId])
      knockSavesRef.current[widgetId] = setTimeout(async () => {
        const toSave = widgetsRef.current.find(w => w.id === widgetId)?.content || newContent
        await supabase.from('canvas_widgets').update({ content: toSave }).eq('id', widgetId)
      }, 500)
      return
    }
    if (widget.type === 'poll' && action) {
      // action is the option string
      const newVotes = { ...(widget.content?.votes || {}), [userId]: action }
      const newContent = { ...widget.content, votes: newVotes }
      setWidgets(prev => prev.map(w => w.id === widgetId ? { ...w, content: newContent } : w))
      await supabase.from('canvas_widgets').update({ content: newContent }).eq('id', widgetId)
      Haptics.selectionAsync()
      return
    }
    if (widget.type === 'photostack' && action === 'next') {
      const urls: string[] = widget.content?.urls || []
      const idx = widget.content?.currentIndex ?? 0
      const newIdx = urls.length > 0 ? (idx + 1) % urls.length : 0
      const newContent = { ...widget.content, currentIndex: newIdx }
      setWidgets(prev => prev.map(w => w.id === widgetId ? { ...w, content: newContent } : w))
      Haptics.selectionAsync()
      return
    }
    if (widget.type === 'voice' && action === 'record') {
      // If already recording for this widget, stop and save
      if (recordingRef.current && recordingWidgetId === widgetId) {
        try {
          await recordingRef.current.stopAndUnloadAsync()
          await Audio.setAudioModeAsync({ allowsRecordingIOS: false })
          const uri = recordingRef.current.getURI()
          recordingRef.current = null
          setRecordingWidgetId(null)
          if (!uri) return
          const url = await uploadImage(uri, 'voicenote', true)
          if (!url) return
          const newContent = { ...widget.content, url, recordedAt: new Date().toISOString() }
          setWidgets(prev => prev.map(w => w.id === widgetId ? { ...w, content: newContent } : w))
          await supabase.from('canvas_widgets').update({ content: newContent }).eq('id', widgetId)
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        } catch (e: any) { Alert.alert('Save failed', e.message) }
        return
      }
      // Start a new recording
      try {
        // Stop any existing recording first
        if (recordingRef.current) {
          await recordingRef.current.stopAndUnloadAsync()
          recordingRef.current = null
          setRecordingWidgetId(null)
        }
        const perm = await Audio.requestPermissionsAsync()
        if (!perm.granted) { Alert.alert('Microphone permission needed'); return }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true })
        const recording = new Audio.Recording()
        await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY)
        await recording.startAsync()
        recordingRef.current = recording
        setRecordingWidgetId(widgetId)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        // Auto-stop after 30 seconds
        setTimeout(async () => {
          if (recordingRef.current && recordingWidgetId === widgetId) {
            try {
              await recordingRef.current.stopAndUnloadAsync()
              await Audio.setAudioModeAsync({ allowsRecordingIOS: false })
              const uri = recordingRef.current.getURI()
              recordingRef.current = null
              setRecordingWidgetId(null)
              if (!uri) return
              const freshW = widgetsRef.current.find(w => w.id === widgetId)
              const url = await uploadImage(uri, 'voicenote', true)
              if (!url) return
              const newContent = { ...(freshW?.content || {}), url, recordedAt: new Date().toISOString() }
              setWidgets(prev => prev.map(w => w.id === widgetId ? { ...w, content: newContent } : w))
              await supabase.from('canvas_widgets').update({ content: newContent }).eq('id', widgetId)
            } catch { /* already stopped */ }
          }
        }, 30000)
      } catch (e: any) { Alert.alert('Recording failed', e.message) }
      return
    }
  }

  // Poll creation state
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOpt1, setPollOpt1] = useState('')
  const [pollOpt2, setPollOpt2] = useState('')
  const [pollOpt3, setPollOpt3] = useState('')

  async function handleAddPoll() {
    if (!pollQuestion.trim() || !pollOpt1.trim() || !pollOpt2.trim()) { Alert.alert('Need a question and at least 2 options'); return }
    const options = [pollOpt1.trim(), pollOpt2.trim(), pollOpt3.trim()].filter(Boolean)
    await insertWidget('poll', { question: pollQuestion.trim(), options, votes: {} }, 260, 200)
    setPollQuestion(''); setPollOpt1(''); setPollOpt2(''); setPollOpt3('')
  }

  async function handleAddPhotoStack() {
    closeToolbar()
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) { Alert.alert('Permission needed'); return }
    const opts: ImagePicker.ImagePickerOptions = { quality: 0.8, allowsMultipleSelection: true } as any
    const result = await ImagePicker.launchImageLibraryAsync(opts)
    if (result.canceled || !result.assets.length) return
    const urls: string[] = []
    for (const asset of result.assets.slice(0, 5)) {
      const url = await uploadImage(asset.uri, 'stack')
      if (url) urls.push(url)
    }
    if (!urls.length) return
    await insertWidget('photostack', { urls, currentIndex: 0 }, 280, 240)
  }

  const styleWidget = widgets.find(w => w.id === styleWidgetId) ?? null
  const TEXT_TYPES: WidgetType[] = ['note', 'countdown', 'mood', 'weather', 'capsule']

  if (loading) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaView style={st.safe}>
          <View style={st.center}><ActivityIndicator color="#C9956C" size="large" /></View>
        </SafeAreaView>
      </GestureHandlerRootView>
    )
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: canvasBgColor }}>
        <SafeAreaView style={{ backgroundColor: '#221A2C' }} edges={['top']}>
          <View style={st.header}>
            {/* Back button */}
            <TouchableOpacity style={st.iconBtn} onPress={() => { soundRef.current?.unloadAsync(); onBack() }}>
              <Text style={{ fontSize: 18, color: '#C9956C' }}>←</Text>
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              {editingName ? (
                <TextInput style={st.nameInput} value={nameInput} onChangeText={setNameInput} onBlur={saveSpaceName} onSubmitEditing={saveSpaceName} autoFocus returnKeyType="done" />
              ) : (
                <TouchableOpacity onPress={() => { setNameInput(canvasName); setEditingName(true) }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={st.headerTitle}>{canvasName || 'Space'}</Text>
                    <Text style={{ fontSize: 11, color: '#9B8FAD' }}>✎</Text>
                  </View>
                </TouchableOpacity>
              )}
              <Text style={st.headerSub}>{widgets.length} items · pinch zoom · drag pan</Text>
            </View>

            <TouchableOpacity style={[st.iconBtn, bgSongName && { backgroundColor: '#C9956C22', borderColor: '#C9956C' }]} onPress={() => setActiveModal('bgmusic')}>
              <Text style={{ fontSize: 14 }}>{bgPlaying ? '🎵' : '🎧'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.iconBtn} onPress={() => setChatOpen(true)}>
              <Text style={{ fontSize: 14 }}>💬</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.iconBtn} onPress={() => { setSelectedBgColor(canvasBgColor); setSelectedPattern(canvasPattern); setActiveModal('background') }}>
              <View style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: canvasBgColor, borderWidth: 1, borderColor: '#9B8FAD' }} />
            </TouchableOpacity>
            <TouchableOpacity style={st.iconBtn} onPress={async () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); await load() }}
              accessibilityRole="button" accessibilityLabel="Refresh space">
              <Text style={{ fontSize: 14 }}>↻</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.iconBtn} onPress={centerCanvas}>
              <Text style={{ fontSize: 14 }}>⌂</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        <GestureDetector gesture={canvasGesture}>
          <View ref={canvasViewRef} style={{ flex: 1, overflow: 'hidden', backgroundColor: canvasBgColor }} collapsable={false}>
            <CanvasPatternWrapper pattern={canvasPattern} color={canvasBgColor} translateX={translateX} translateY={translateY} scale={scale} />
            <Animated.View style={[{ position: 'absolute', width: CANVAS_SIZE, height: CANVAS_SIZE }, canvasStyle]}>
              {widgets.map(w => (
                <WidgetItem key={w.id} widget={w} canvasScale={scale} userId={userId} spaceId={spaceId} now={now}
                  onDragEnd={handleDragEnd} onDelete={handleDelete} onStyleOpen={handleStyleOpen}
                  onMoodTap={(id) => handleWidgetTap(id)}
                  playingSongWidgetId={playingSongWidgetId}
                  onSongPlay={handleSongWidgetPlay}
                  allWidgets={widgets}
                  hwCaptureRef={(id, ref) => { if (ref) hwViewRefs.current[id] = ref; else delete hwViewRefs.current[id] }}
                  onBringToFront={handleBringToFront}
                  recordingWidgetId={recordingWidgetId}
                  onResize={async (id, newScale) => {
                    setWidgets(prev => prev.map(x => x.id === id ? { ...x, style: { ...(x.style || {}), scale: newScale } } : x))
                    const w = widgetsRef.current.find(x => x.id === id)
                    if (w) await supabase.from('canvas_widgets').update({ style: { ...(w.style || {}), scale: newScale } }).eq('id', id)
                  }}
                  onRotate={async (id, deg) => {
                    setWidgets(prev => prev.map(x => x.id === id ? { ...x, style: { ...(x.style || {}), rotation: deg } } : x))
                    const w = widgetsRef.current.find(x => x.id === id)
                    if (w) await supabase.from('canvas_widgets').update({ style: { ...(w.style || {}), rotation: deg } }).eq('id', id)
                  }} />
              ))}
            </Animated.View>
            {widgets.length === 0 && !toolbarOpen && (
              <View style={{ position: 'absolute', top: SH / 2 - 160, width: SW, alignItems: 'center', zIndex: 0 }} pointerEvents="box-none">
                <Text style={{ fontSize: 32, marginBottom: 16 }}>✦</Text>
                <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 6 }}>Space is empty</Text>
                <Text style={{ color: '#9B8FAD', fontSize: 13, marginBottom: 24 }}>Choose a starting point or tap + to create</Text>

                <View style={{ flexDirection: 'row', gap: 14, paddingHorizontal: 20 }}>
                  <TouchableOpacity style={st.templateCard} onPress={() => applyTemplate(WIDGET_TEMPLATES.find(t => t.id === 'memories')!)} activeOpacity={0.8}>
                    <Text style={{ fontSize: 32, marginBottom: 12 }}>❤️</Text>
                    <Text style={{ color: '#C9956C', fontWeight: '800', fontSize: 13, textAlign: 'center' }}>Memories</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={st.templateCard} onPress={() => applyTemplate(WIDGET_TEMPLATES.find(t => t.id === 'countdown')!)} activeOpacity={0.8}>
                    <Text style={{ fontSize: 32, marginBottom: 12 }}>⏳</Text>
                    <Text style={{ color: '#6BBED4', fontWeight: '800', fontSize: 13, textAlign: 'center' }}>Event</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={st.templateCard} onPress={() => applyTemplate(WIDGET_TEMPLATES.find(t => t.id === 'music')!)} activeOpacity={0.8}>
                    <Text style={{ fontSize: 32, marginBottom: 12 }}>🎵</Text>
                    <Text style={{ color: '#B8A9D9', fontWeight: '800', fontSize: 13, textAlign: 'center' }}>Music Wall</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </GestureDetector>

        <SafeAreaView style={{ backgroundColor: '#221A2C', borderTopWidth: 1, borderTopColor: '#3D2E52' }} edges={['bottom']}>
          <TouchableOpacity style={st.toolbarToggle} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setToolbarOpen(o => !o) }}>
            <Text style={st.toolbarChevron}>{toolbarOpen ? '⌄' : '⌃'}</Text>
            <Text style={st.toolbarToggleText}>{toolbarOpen ? 'Close' : '+ Add to space'}</Text>
          </TouchableOpacity>
          {toolbarOpen && (
            <View style={st.toolbarGrid}>
              {[
                { label: 'Photo', emoji: '📷', action: handleAddPhoto },
                { label: 'Note', emoji: '📝', action: () => openModal('note') },
                { label: 'Song', emoji: '🎵', action: () => openModal('song') },
                { label: 'Countdown', emoji: '⏳', action: () => openModal('countdown') },
                { label: 'Mood', emoji: '💛', action: async () => { closeToolbar(); await insertWidget('mood', { moods: {} }, 220, 140) } },
                { label: 'Capsule', emoji: '📦', action: () => openModal('capsule') },
                { label: 'Widget', emoji: '📱', action: () => openModal('homewidget') },
                { label: 'Sticker', emoji: '🌟', action: () => openModal('sticker') },
                { label: 'Link', emoji: '🔗', action: () => openModal('link') },
                { label: 'Weather', emoji: '☁️', action: () => openModal('weather') },
                { label: 'Templates', emoji: '📐', action: () => openModal('templates') },
                { label: 'Knock', emoji: '✨', action: async () => { closeToolbar(); await insertWidget('knock', { count: 0 }, 160, 140) } },
                { label: 'Poll', emoji: '✋', action: () => openModal('poll') },
                { label: 'Stack', emoji: '🗂️', action: handleAddPhotoStack },
                { label: 'Prompt', emoji: '📝', action: async () => { closeToolbar(); await insertWidget('dailyprompt', {}, 280, 180) } },
                { label: 'Voice', emoji: '🎙️', action: async () => { closeToolbar(); await insertWidget('voice', { label: 'Voice Note', url: null }, 160, 140) } },
              ].map(btn => (
                <TouchableOpacity key={btn.label} style={st.toolbarBtn} onPress={btn.action}>
                  <Text style={{ fontSize: 22 }}>{btn.emoji}</Text>
                  <Text style={st.toolbarLabel}>{btn.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </SafeAreaView>
      </View>

      {moodWidgetId && (
        <View style={st.moodPickerOuter} pointerEvents="box-none">
          <View style={st.moodPicker}>
            <Text style={{ fontSize: 12, color: '#9B8FAD', marginBottom: 8 }}>How are you feeling?</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {MOOD_EMOJIS.map(e => (
                <TouchableOpacity key={e} onPress={() => handleSetMood(moodWidgetId, e)} style={{ padding: 6 }}>
                  <Text style={{ fontSize: 30 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity onPress={() => setMoodWidgetId(null)} style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 12, color: '#9B8FAD' }}>close</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {styleWidgetId && styleWidget && (
        <View style={[StyleSheet.absoluteFillObject, { zIndex: 100 }]}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setStyleWidgetId(null)} />
          <View style={st.styleSheet}>
            <View style={st.sheetHandle} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 8 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#F5EEF8' }}>Customise · {styleWidget.type}</Text>
              <TouchableOpacity onPress={() => setStyleWidgetId(null)}><Text style={{ color: '#9B8FAD', fontSize: 22 }}>×</Text></TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#3D2E52', paddingHorizontal: 20 }}>
              {(['look', 'size'] as const).map(tab => (
                <TouchableOpacity key={tab} onPress={() => setStyleTab(tab)}
                  style={{ paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: styleTab === tab ? '#C9956C' : 'transparent' }}>
                  <Text style={{ fontSize: 13, color: styleTab === tab ? '#C9956C' : '#9B8FAD', fontWeight: styleTab === tab ? '600' : '400', textTransform: 'capitalize' }}>{tab}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false} bounces>
              <View style={{ padding: 16 }}>
                {styleTab === 'look' && (
                  <>
                    {/* ── UNIVERSAL: Background colour ── */}
                    <Text style={st.styleLabel}>Background</Text>
                    <View style={st.colorGrid}>
                      {STYLE_COLORS.map(color => (
                        <TouchableOpacity key={color} onPress={() => updateWidgetStyle(styleWidgetId, { backgroundColor: color })}
                          style={[st.colorSwatch, { backgroundColor: color === 'transparent' ? '#2D2040' : color }, styleWidget.style?.backgroundColor === color && st.colorSwatchSelected]}>
                          {color === 'transparent' && <Text style={{ fontSize: 11, color: '#666' }}>∅</Text>}
                        </TouchableOpacity>
                      ))}
                    </View>

                    {/* ── PHOTO: Frame style ── */}
                    {styleWidget.type === 'photo' && (
                      <>
                        <Text style={[st.styleLabel, { marginTop: 14 }]}>Frame</Text>
                        <View style={st.btnRow}>
                          {PHOTO_FRAMES.map(f => (
                            <TouchableOpacity key={f.key} onPress={() => updateWidgetStyle(styleWidgetId, { frame: f.key })}
                              style={[st.choiceBtn, (styleWidget.style?.frame || 'none') === f.key && st.choiceBtnActive]}>
                              <Text style={[st.choiceBtnText, (styleWidget.style?.frame || 'none') === f.key && { color: '#fff' }]}>{f.label}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <TouchableOpacity style={st.replaceBtn} onPress={() => handleReplaceImage(styleWidgetId)}>
                          <Text style={st.replaceBtnText}>📷  Replace image</Text>
                        </TouchableOpacity>
                      </>
                    )}

                    {/* ── SONG: Album art + layout ── */}
                    {styleWidget.type === 'song' && (
                      <>
                        <Text style={[st.styleLabel, { marginTop: 14 }]}>Album art shape</Text>
                        <View style={st.btnRow}>
                          {[{ key: 'square', label: 'Square' }, { key: 'vinyl', label: 'Vinyl' }].map(f => (
                            <TouchableOpacity key={f.key} onPress={() => updateWidgetStyle(styleWidgetId, { albumShape: f.key })}
                              style={[st.choiceBtn, (styleWidget.style?.albumShape || 'square') === f.key && st.choiceBtnActive]}>
                              <Text style={[st.choiceBtnText, (styleWidget.style?.albumShape || 'square') === f.key && { color: '#fff' }]}>{f.label}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <TouchableOpacity style={st.replaceBtn} onPress={() => handleReplaceImage(styleWidgetId)}>
                          <Text style={st.replaceBtnText}>📷  Replace album art</Text>
                        </TouchableOpacity>
                      </>
                    )}

                    {/* ── NOTE: Font family + alignment ── */}
                    {styleWidget.type === 'note' && (
                      <>
                        <Text style={[st.styleLabel, { marginTop: 14 }]}>Font</Text>
                        <View style={st.btnRow}>
                          {FONT_FAMILIES.map(f => (
                            <TouchableOpacity key={f.key} onPress={() => updateWidgetStyle(styleWidgetId, { fontFamily: f.key })}
                              style={[st.choiceBtn, (styleWidget.style?.fontFamily || 'default') === f.key && st.choiceBtnActive]}>
                              <Text style={[st.choiceBtnText, (styleWidget.style?.fontFamily || 'default') === f.key && { color: '#fff' }]}>{f.label}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <Text style={[st.styleLabel, { marginTop: 14 }]}>Alignment</Text>
                        <View style={st.btnRow}>
                          {['left', 'center', 'right'].map(a => (
                            <TouchableOpacity key={a} onPress={() => updateWidgetStyle(styleWidgetId, { textAlign: a })}
                              style={[st.choiceBtn, (styleWidget.style?.textAlign || 'left') === a && st.choiceBtnActive]}>
                              <Text style={[st.choiceBtnText, (styleWidget.style?.textAlign || 'left') === a && { color: '#fff' }]}>{a === 'left' ? '◀' : a === 'center' ? '◆' : '▶'}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </>
                    )}

                    {/* ── TEXT TYPES: Text colour + size ── */}
                    {TEXT_TYPES.includes(styleWidget.type) && (
                      <>
                        <Text style={[st.styleLabel, { marginTop: 14 }]}>Text colour</Text>
                        <View style={st.colorGrid}>
                          {TEXT_COLORS.map(color => (
                            <TouchableOpacity key={color} onPress={() => updateWidgetStyle(styleWidgetId, { textColor: color })}
                              style={[st.colorSwatch, { backgroundColor: color }, styleWidget.style?.textColor === color && st.colorSwatchSelected]} />
                          ))}
                        </View>
                        <Text style={[st.styleLabel, { marginTop: 14 }]}>Font size</Text>
                        <View style={st.btnRow}>
                          {[10, 12, 14, 16, 20, 24, 30].map(sz => (
                            <TouchableOpacity key={sz} onPress={() => updateWidgetStyle(styleWidgetId, { fontSize: sz })}
                              style={[st.choiceBtn, (styleWidget.style?.fontSize || 14) === sz && st.choiceBtnActive]}>
                              <Text style={[st.choiceBtnText, (styleWidget.style?.fontSize || 14) === sz && { color: '#fff' }]}>{sz}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </>
                    )}

                    {/* ── KNOCK: Emoji picker ── */}
                    {styleWidget.type === 'knock' && (
                      <>
                        <Text style={[st.styleLabel, { marginTop: 14 }]}>Knock icon</Text>
                        <View style={st.btnRow}>
                          {KNOCK_EMOJIS.map(e => (
                            <TouchableOpacity key={e} onPress={() => updateWidgetContent(styleWidgetId, { emoji: e })}
                              style={[st.choiceBtn, { paddingHorizontal: 8 }, (styleWidget.content?.emoji || '✨') === e && st.choiceBtnActive]}>
                              <Text style={{ fontSize: 18 }}>{e}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <TouchableOpacity style={[st.replaceBtn, { marginTop: 14 }]} onPress={() => updateWidgetContent(styleWidgetId, { count: 0 })}>
                          <Text style={[st.replaceBtnText, { color: '#EF4444' }]}>🔄  Reset knock counter</Text>
                        </TouchableOpacity>
                      </>
                    )}

                    {/* ── HOMEWIDGET: Manual refresh ── */}
                    {styleWidget.type === 'homewidget' && (
                      <TouchableOpacity style={[st.replaceBtn, { marginTop: 14 }]} onPress={() => {
                        captureAndUploadWidget(styleWidget)
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                        setStyleWidgetId(null)
                      }}>
                        <Text style={st.replaceBtnText}>🔄  Refresh phone widget now</Text>
                      </TouchableOpacity>
                    )}

                    {/* ── COUNTDOWN: Display style ── */}
                    {styleWidget.type === 'countdown' && (
                      <>
                        <Text style={[st.styleLabel, { marginTop: 14 }]}>Display style</Text>
                        <View style={st.btnRow}>
                          {[{ key: 'digital', label: 'Digital' }, { key: 'compact', label: 'Compact' }, { key: 'label', label: 'Label' }].map(f => (
                            <TouchableOpacity key={f.key} onPress={() => updateWidgetStyle(styleWidgetId, { countdownStyle: f.key })}
                              style={[st.choiceBtn, (styleWidget.style?.countdownStyle || 'digital') === f.key && st.choiceBtnActive]}>
                              <Text style={[st.choiceBtnText, (styleWidget.style?.countdownStyle || 'digital') === f.key && { color: '#fff' }]}>{f.label}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </>
                    )}

                    {/* ── VOICE: Label edit ── */}
                    {styleWidget.type === 'voice' && (
                      <>
                        <Text style={[st.styleLabel, { marginTop: 14 }]}>Label</Text>
                        <TextInput
                          style={[st.input, { marginTop: 4 }]}
                          placeholder="Voice note label"
                          placeholderTextColor="#9B8FAD"
                          value={styleWidget.content?.label || ''}
                          onChangeText={t => updateWidgetContent(styleWidgetId, { label: t })}
                        />
                        {styleWidget.content?.url && (
                          <TouchableOpacity style={[st.replaceBtn, { marginTop: 14 }]} onPress={() => updateWidgetContent(styleWidgetId, { url: null, recordedAt: null })}>
                            <Text style={[st.replaceBtnText, { color: '#EF4444' }]}>🗑️  Delete recording</Text>
                          </TouchableOpacity>
                        )}
                      </>
                    )}

                    {/* ── POLL: Show percentages toggle ── */}
                    {styleWidget.type === 'poll' && (
                      <>
                        <Text style={[st.styleLabel, { marginTop: 14 }]}>Show percentages</Text>
                        <View style={st.btnRow}>
                          {['Yes', 'No'].map(v => (
                            <TouchableOpacity key={v} onPress={() => updateWidgetStyle(styleWidgetId, { showPercent: v === 'Yes' })}
                              style={[st.choiceBtn, (styleWidget.style?.showPercent !== false) === (v === 'Yes') && st.choiceBtnActive]}>
                              <Text style={[st.choiceBtnText, (styleWidget.style?.showPercent !== false) === (v === 'Yes') && { color: '#fff' }]}>{v}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <TouchableOpacity style={[st.replaceBtn, { marginTop: 14 }]} onPress={() => updateWidgetContent(styleWidgetId, { votes: {} })}>
                          <Text style={[st.replaceBtnText, { color: '#EF4444' }]}>🔄  Reset all votes</Text>
                        </TouchableOpacity>
                      </>
                    )}

                    {/* ── PHOTO STACK: Add photos ── */}
                    {styleWidget.type === 'photostack' && (
                      <>
                        <Text style={[st.styleLabel, { marginTop: 14 }]}>Photos ({(styleWidget.content?.urls || []).length}/5)</Text>
                        <TouchableOpacity style={st.replaceBtn} onPress={async () => {
                          const uri = await pickImage(); if (!uri) return
                          const url = await uploadImage(uri, 'stack-add'); if (!url) return
                          const currentUrls = [...(styleWidget.content?.urls || [])]
                          if (currentUrls.length >= 5) { Alert.alert('Max 5 photos'); return }
                          currentUrls.push(url)
                          updateWidgetContent(styleWidgetId, { urls: currentUrls })
                        }}>
                          <Text style={st.replaceBtnText}>📷  Add a photo</Text>
                        </TouchableOpacity>
                        {(styleWidget.content?.urls || []).length > 0 && (
                          <TouchableOpacity style={[st.replaceBtn, { marginTop: 8 }]} onPress={() => {
                            const urls = [...(styleWidget.content?.urls || [])]
                            urls.pop()
                            updateWidgetContent(styleWidgetId, { urls, currentIndex: 0 })
                          }}>
                            <Text style={[st.replaceBtnText, { color: '#EF4444' }]}>🗑️  Remove last photo</Text>
                          </TouchableOpacity>
                        )}
                      </>
                    )}

                    {/* ── CAPSULE: Replace photo ── */}
                    {styleWidget.type === 'capsule' && (
                      <TouchableOpacity style={st.replaceBtn} onPress={() => handleReplaceImage(styleWidgetId)}>
                        <Text style={st.replaceBtnText}>📷  Replace capsule photo</Text>
                      </TouchableOpacity>
                    )}

                    {/* ── UNIVERSAL: Corner radius ── */}
                    <Text style={[st.styleLabel, { marginTop: 14 }]}>Corner radius</Text>
                    <View style={st.btnRow}>
                      {[0, 4, 8, 12, 20, 32].map(r => (
                        <TouchableOpacity key={r} onPress={() => updateWidgetStyle(styleWidgetId, { borderRadius: r })}
                          style={[st.choiceBtn, (styleWidget.style?.borderRadius ?? 12) === r && st.choiceBtnActive]}>
                          <Text style={[st.choiceBtnText, (styleWidget.style?.borderRadius ?? 12) === r && { color: '#fff' }]}>{r}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {/* ── UNIVERSAL: Opacity ── */}
                    <Text style={[st.styleLabel, { marginTop: 14 }]}>Opacity</Text>
                    <View style={st.btnRow}>
                      {[25, 50, 75, 100].map(op => (
                        <TouchableOpacity key={op} onPress={() => updateWidgetStyle(styleWidgetId, { opacity: op / 100 })}
                          style={[st.choiceBtn, Math.round((styleWidget.style?.opacity ?? 1) * 100) === op && st.choiceBtnActive]}>
                          <Text style={[st.choiceBtnText, Math.round((styleWidget.style?.opacity ?? 1) * 100) === op && { color: '#fff' }]}>{op}%</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {/* ── UNIVERSAL: Shadow ── */}
                    <Text style={[st.styleLabel, { marginTop: 14 }]}>Shadow</Text>
                    <View style={st.btnRow}>
                      {['Off', 'On'].map(v => (
                        <TouchableOpacity key={v} onPress={() => updateWidgetStyle(styleWidgetId, { shadow: v === 'On' })}
                          style={[st.choiceBtn, !!styleWidget.style?.shadow === (v === 'On') && st.choiceBtnActive]}>
                          <Text style={[st.choiceBtnText, !!styleWidget.style?.shadow === (v === 'On') && { color: '#fff' }]}>{v}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}
                {styleTab === 'size' && (
                  <>
                    <Text style={st.styleLabel}>Width</Text>
                    <View style={st.btnRow}>
                      {[160, 220, 280, 340, 420].map(w => (
                        <TouchableOpacity key={w} onPress={() => updateWidgetSize(styleWidgetId, w, styleWidget.height)}
                          style={[st.choiceBtn, styleWidget.width === w && st.choiceBtnActive]}>
                          <Text style={[st.choiceBtnText, styleWidget.width === w && { color: '#fff' }]}>{w}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text style={[st.styleLabel, { marginTop: 14 }]}>Height</Text>
                    <View style={st.btnRow}>
                      {[100, 140, 180, 240, 320].map(h => (
                        <TouchableOpacity key={h} onPress={() => updateWidgetSize(styleWidgetId, styleWidget.width, h)}
                          style={[st.choiceBtn, styleWidget.height === h && st.choiceBtnActive]}>
                          <Text style={[st.choiceBtnText, styleWidget.height === h && { color: '#fff' }]}>{h}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text style={[st.styleLabel, { marginTop: 14 }]}>Rotation</Text>
                    <View style={st.btnRow}>
                      {[-30, -15, 0, 15, 30].map(r => (
                        <TouchableOpacity key={r} onPress={() => updateWidgetStyle(styleWidgetId, { rotation: r })}
                          style={[st.choiceBtn, (styleWidget.style?.rotation || 0) === r && st.choiceBtnActive]}>
                          <Text style={[st.choiceBtnText, (styleWidget.style?.rotation || 0) === r && { color: '#fff' }]}>{r}°</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}
              </View>
            </ScrollView>
            <TouchableOpacity style={[st.deleteBtn, { backgroundColor: '#C9956C22', borderColor: '#C9956C', marginTop: 12 }]} onPress={() => { setStyleWidgetId(null); setShareWidget(styleWidget) }}>
              <Text style={[st.deleteBtnText, { color: '#C9956C' }]}>Share to chat</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.deleteBtn} onPress={() => { handleDelete(styleWidgetId); setStyleWidgetId(null) }}>
              <Text style={st.deleteBtnText}>Delete widget</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Modal visible={activeModal === 'background'} transparent animationType="slide">
        <View style={st.overlay}>
          <View style={st.sheet}>
            <View style={st.sheetHandle} />
            <Text style={st.sheetTitle}>Space background</Text>
            <Text style={st.styleLabel}>Colour</Text>
            <View style={[st.colorGrid, { marginBottom: 20 }]}>
              {BG_COLORS.map(color => (
                <TouchableOpacity key={color} onPress={() => setSelectedBgColor(color)}
                  style={[st.colorSwatch, { width: 36, height: 36, backgroundColor: color }, selectedBgColor === color && st.colorSwatchSelected]} />
              ))}
              <View style={{ overflow: 'hidden', borderRadius: 18, width: 36, height: 36 }}>
                <TextInput style={{ width: 36, height: 36, backgroundColor: selectedBgColor, borderWidth: 1, borderColor: '#3D2E52', color: '#F5EEF8', fontSize: 8, textAlign: 'center' }}
                  value={selectedBgColor} onChangeText={v => { if (v.startsWith('#') && v.length <= 7) setSelectedBgColor(v) }}
                  placeholder="#hex" placeholderTextColor="#555" maxLength={7} />
              </View>
            </View>
            <Text style={st.styleLabel}>Pattern</Text>
            <View style={[st.btnRow, { marginBottom: 20 }]}>
              {PATTERNS.map(p => (
                <TouchableOpacity key={p.key} onPress={() => setSelectedPattern(p.key)}
                  style={[st.patternBtn, selectedPattern === p.key && st.choiceBtnActive]}>
                  <Text style={{ fontSize: 18, marginBottom: 2 }}>{p.emoji}</Text>
                  <Text style={[st.choiceBtnText, selectedPattern === p.key && { color: '#fff' }]}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ width: '100%', height: 48, backgroundColor: selectedBgColor, borderRadius: 12, marginBottom: 20, borderWidth: 1, borderColor: '#3D2E52', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#F5EEF8', fontSize: 11, opacity: 0.5 }}>Preview</Text>
            </View>
            <View style={st.sheetActions}>
              <TouchableOpacity style={st.btnSec} onPress={() => setActiveModal(null)}><Text style={st.btnSecText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={st.btnPri} onPress={applyBackground}><Text style={st.btnPriText}>Apply</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={activeModal === 'bgmusic'} transparent animationType="slide">
        <View style={st.overlay}>
          <View style={st.sheet}>
            <View style={st.sheetHandle} />
            <Text style={st.sheetTitle}>🎧 Space music</Text>
            <Text style={{ fontSize: 13, color: '#9B8FAD', marginBottom: 20, lineHeight: 18 }}>A song that plays softly whenever you open your space.</Text>
            {bgSongName ? (
              <>
                <View style={st.musicCard}>
                  <View style={st.musicCardLeft}>
                    <Text style={{ fontSize: 28 }}>{bgPlaying ? '🎵' : '🎧'}</Text>
                    <View>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: '#F5EEF8' }} numberOfLines={1}>{bgSongName}</Text>
                      <Text style={{ fontSize: 12, color: '#9B8FAD', marginTop: 2 }}>{bgPlaying ? 'Now playing' : 'Paused'}</Text>
                    </View>
                  </View>
                  <TouchableOpacity style={st.playBtn} onPress={toggleBgPlay}>
                    <Text style={{ fontSize: 20 }}>{bgPlaying ? '⏸' : '▶'}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[st.styleLabel, { marginTop: 16 }]}>Volume</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                  {[0.1, 0.3, 0.5, 0.7, 1.0].map(v => (
                    <TouchableOpacity key={v} onPress={() => handleBgVolumeChange(v)}
                      style={[st.choiceBtn, Math.abs(bgVolume - v) < 0.05 && st.choiceBtnActive, { flex: 1, alignItems: 'center' }]}>
                      <Text style={[st.choiceBtnText, Math.abs(bgVolume - v) < 0.05 && { color: '#fff' }]}>{Math.round(v * 100)}%</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity onPress={handleRemoveBgMusic} style={[st.btnSec, { alignItems: 'center' }]}>
                  <Text style={[st.btnSecText, { color: '#EF4444' }]}>Remove music</Text>
                </TouchableOpacity>
              </>
            ) : null}
            <Text style={[st.styleLabel, { marginTop: bgSongName ? 16 : 0 }]}>🔍 Search for a song</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              <TextInput style={[st.input, { flex: 1 }]} placeholder="Artist or song..." placeholderTextColor="#9B8FAD" value={bgMusicQuery} onChangeText={setBgMusicQuery} returnKeyType="search" onSubmitEditing={handleBgMusicSearch} />
              <TouchableOpacity style={st.searchGo} onPress={handleBgMusicSearch}><Text style={st.btnPriText}>{bgMusicSearching ? '…' : 'Go'}</Text></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 200 }}>
              {bgMusicResults.map((r: any) => (
                <TouchableOpacity key={r.trackId} style={[st.songRow, { marginBottom: 6 }]}
                  onPress={async () => {
                    if (!r.previewUrl) { Alert.alert('No preview for this track'); return }
                    const name = `${r.trackName} — ${r.artistName}`
                    await supabase.from('canvases').update({ bg_song_url: r.previewUrl, bg_song_name: name, bg_song_volume: bgVolume }).eq('id', canvasId)
                    setBgSongUrl(r.previewUrl); setBgSongName(name)
                    setBgMusicResults([]); setBgMusicQuery('')
                    await playBgMusic(r.previewUrl)
                  }}>
                  {r.artworkUrl60 ? <Image source={{ uri: r.artworkUrl60 }} style={st.songArt} /> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#F5EEF8' }} numberOfLines={1}>{r.trackName}</Text>
                    <Text style={{ fontSize: 11, color: '#9B8FAD' }} numberOfLines={1}>{r.artistName}</Text>
                    {!r.previewUrl && <Text style={{ fontSize: 10, color: '#EF4444' }}>No preview</Text>}
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={[st.btnSec, { marginTop: 12, alignItems: 'center' }]} onPress={() => setActiveModal(null)}>
              <Text style={st.btnSecText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={activeModal === 'note'} transparent animationType="slide">
        <KeyboardAvoidingView style={st.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={st.sheet}>
            <View style={st.sheetHandle} />
            <Text style={st.sheetTitle}>Add a note</Text>
            <TextInput style={st.textarea} multiline placeholder="Write something..." placeholderTextColor="#9B8FAD" value={noteText} onChangeText={setNoteText} autoFocus />
            <View style={st.sheetActions}>
              <TouchableOpacity style={st.btnSec} onPress={closeModal}><Text style={st.btnSecText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={st.btnPri} onPress={async () => { const t = safeString(noteText).trim(); if (!t) return; await insertWidget('note', { text: t }) }}>
                <Text style={st.btnPriText}>Add Note</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={activeModal === 'song'} transparent animationType="slide">
        <KeyboardAvoidingView style={st.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={st.sheet}>
            <View style={st.sheetHandle} />
            <Text style={st.sheetTitle}>Add a song</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <TextInput style={[st.input, { flex: 1 }]} placeholder="Search..." placeholderTextColor="#9B8FAD" value={songQuery} onChangeText={setSongQuery} returnKeyType="search" onSubmitEditing={handleSongSearch} />
              <TouchableOpacity style={st.searchGo} onPress={handleSongSearch}><Text style={st.btnPriText}>{songSearching ? '...' : 'Go'}</Text></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 200 }}>
              {songResults.map(r => (
                <TouchableOpacity key={r.trackId} style={st.songRow}
                  onPress={async () => { await insertWidget('song', { songName: r.trackName, artist: r.artistName, albumArt: r.artworkUrl100, previewUrl: r.previewUrl }, 280, 130) }}>
                  {r.artworkUrl60 ? <Image source={{ uri: r.artworkUrl60 }} style={st.songArt} /> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '500', color: '#F5EEF8' }} numberOfLines={1}>{r.trackName}</Text>
                    <Text style={{ fontSize: 12, color: '#9B8FAD' }} numberOfLines={1}>{r.artistName}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={[st.btnSec, { marginTop: 12 }]} onPress={closeModal}><Text style={st.btnSecText}>Close</Text></TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={activeModal === 'countdown'} transparent animationType="slide">
        <KeyboardAvoidingView style={st.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={st.sheet}>
            <View style={st.sheetHandle} />
            <Text style={st.sheetTitle}>Add a countdown</Text>
            <Text style={st.inputLabel}>Label</Text>
            <TextInput style={st.input} placeholder="e.g. Paris Trip" placeholderTextColor="#9B8FAD" value={countdownLabel} onChangeText={setCountdownLabel} />
            <Text style={[st.inputLabel, { marginTop: 12 }]}>Date (YYYY-MM-DD)</Text>
            <TextInput style={st.input} placeholder="2025-12-25" placeholderTextColor="#9B8FAD" value={countdownDate} onChangeText={setCountdownDate} keyboardType="numbers-and-punctuation" />
            <View style={st.sheetActions}>
              <TouchableOpacity style={st.btnSec} onPress={closeModal}><Text style={st.btnSecText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={st.btnPri} onPress={handleAddCountdown}><Text style={st.btnPriText}>Add</Text></TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* POLL MODAL */}
      <Modal visible={activeModal === 'poll'} transparent animationType="slide">
        <KeyboardAvoidingView style={st.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={st.sheet}>
            <View style={st.sheetHandle} />
            <Text style={st.sheetTitle}>Add a poll</Text>
            <Text style={st.inputLabel}>Question</Text>
            <TextInput style={[st.input, { marginBottom: 12 }]} placeholder="e.g. Where for dinner?" placeholderTextColor="#9B8FAD" value={pollQuestion} onChangeText={setPollQuestion} />
            <Text style={st.inputLabel}>Options</Text>
            <TextInput style={[st.input, { marginBottom: 8 }]} placeholder="Option 1" placeholderTextColor="#9B8FAD" value={pollOpt1} onChangeText={setPollOpt1} />
            <TextInput style={[st.input, { marginBottom: 8 }]} placeholder="Option 2" placeholderTextColor="#9B8FAD" value={pollOpt2} onChangeText={setPollOpt2} />
            <TextInput style={st.input} placeholder="Option 3 (optional)" placeholderTextColor="#9B8FAD" value={pollOpt3} onChangeText={setPollOpt3} />
            <View style={st.sheetActions}>
              <TouchableOpacity style={st.btnSec} onPress={closeModal}><Text style={st.btnSecText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={st.btnPri} onPress={handleAddPoll}><Text style={st.btnPriText}>Add Poll</Text></TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={activeModal === 'weather'} transparent animationType="slide">
        <KeyboardAvoidingView style={st.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={st.sheet}>
            <View style={st.sheetHandle} />
            <Text style={st.sheetTitle}>Add weather</Text>
            <Text style={st.inputLabel}>City</Text>
            <TextInput style={st.input} placeholder="e.g. London" placeholderTextColor="#9B8FAD" value={weatherCity} onChangeText={setWeatherCity} returnKeyType="search" onSubmitEditing={handleAddWeather} autoFocus />
            <View style={st.sheetActions}>
              <TouchableOpacity style={st.btnSec} onPress={closeModal}><Text style={st.btnSecText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={st.btnPri} onPress={handleAddWeather}><Text style={st.btnPriText}>{weatherLoading ? 'Fetching...' : 'Add'}</Text></TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* HOME WIDGET MODAL */}
      <Modal visible={activeModal === 'homewidget'} transparent animationType="slide">
        <KeyboardAvoidingView style={st.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={st.sheet}>
            <View style={st.sheetHandle} />
            <Text style={st.sheetTitle}>📱 Home screen widget</Text>
            <Text style={{ fontSize: 13, color: '#9B8FAD', marginBottom: 16, lineHeight: 18 }}>Add a widget to your home screen that syncs content from your space.</Text>
            <Text style={st.inputLabel}>Widget size</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {([['small', '2×2', '240×240'], ['medium', '4×2', '480×240'], ['large', '4×4', '480×480']] as const).map(([key, label, dims]) => (
                <TouchableOpacity key={key} style={[st.choiceBtn, hwSize === key && st.choiceBtnActive, { flex: 1, alignItems: 'center', gap: 3 }]} onPress={() => setHwSize(key)}>
                  <Text style={{ fontSize: key === 'small' ? 18 : key === 'medium' ? 22 : 26 }}>📱</Text>
                  <Text style={[st.choiceBtnText, hwSize === key && { color: '#fff' }]}>{label}</Text>
                  <Text style={{ fontSize: 9, color: hwSize === key ? '#fff' : '#9B8FAD' }}>{dims}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* Preview */}
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={[{ borderRadius: 16, borderWidth: 2, borderColor: '#C9956C', backgroundColor: '#2D2040', padding: 12, alignItems: 'center', justifyContent: 'center' },
              hwSize === 'small' ? { width: 140, height: 140 } : hwSize === 'medium' ? { width: 280, height: 130 } : { width: 280, height: 280 }]}>
                <Text style={{ color: '#F5EEF8', fontSize: 14, textAlign: 'center' }}>{hwContent || 'Your content'}</Text>
              </View>
              <Text style={{ fontSize: 10, color: '#9B8FAD', marginTop: 6 }}>Preview</Text>
            </View>
            <Text style={st.inputLabel}>Widget content</Text>
            <TextInput style={st.input} placeholder="e.g. 'I love you' or a quote..." placeholderTextColor="#9B8FAD" value={hwContent} onChangeText={setHwContent} multiline />
            <View style={[{ backgroundColor: '#C9956C15', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#C9956C30', marginTop: 16 }]}>
              <Text style={{ fontSize: 12, color: '#C9956C', lineHeight: 17 }}>💡 To show this on your home screen: long-press your home screen → Widgets → Anchor. The widget auto-updates every {limits.widgetRefreshMin} minute{limits.widgetRefreshMin === 1 ? '' : 's'}.</Text>
            </View>
            <View style={st.sheetActions}>
              <TouchableOpacity style={st.btnSec} onPress={closeModal}><Text style={st.btnSecText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={st.btnPri} onPress={async () => {
                await insertWidget('homewidget', { size: hwSize, content: hwContent.trim() || '', bgColor: '#1A1118' }, hwSize === 'small' ? 240 : 480, hwSize === 'small' ? 240 : hwSize === 'medium' ? 240 : 480)
                setHwContent(''); setHwSize('medium')
              }}><Text style={st.btnPriText}>Add Widget</Text></TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* STICKER MODAL */}
      <Modal visible={activeModal === 'sticker'} transparent animationType="slide">
        <View style={st.overlay}>
          <View style={st.sheet}>
            <View style={st.sheetHandle} />
            <Text style={st.sheetTitle}>Add a sticker</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginBottom: 16 }}>
              {['❤️', '✨', '🌸', '⭐', '🎀', '🌙', '☀️', '🦋', '🌺', '💫', '🎵', '📸', '✈️', '🗺️', '🏖️', '🏔️', '🌿', '🍃', '🎭', '🎨', '🦄', '🍓', '🌈', '💛', '🌻', '🦊', '🐝', '🍀', '🔮', '💎'].map(e => (
                <TouchableOpacity key={e} style={[{ width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: stickerEmoji === e ? '#C9956C22' : '#2D2040', borderWidth: 1, borderColor: stickerEmoji === e ? '#C9956C' : '#3D2E52' }]} onPress={() => setStickerEmoji(e)}>
                  <Text style={{ fontSize: 28 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={st.sheetActions}>
              <TouchableOpacity style={st.btnSec} onPress={closeModal}><Text style={st.btnSecText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[st.btnPri, !stickerEmoji && { opacity: 0.4 }]} disabled={!stickerEmoji} onPress={async () => {
                await insertWidget('sticker', { emoji: stickerEmoji }, 80, 80)
                setStickerEmoji('')
              }}><Text style={st.btnPriText}>Add {stickerEmoji || '?'}</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* LINK MODAL */}
      <Modal visible={activeModal === 'link'} transparent animationType="slide">
        <KeyboardAvoidingView style={st.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={st.sheet}>
            <View style={st.sheetHandle} />
            <Text style={st.sheetTitle}>Add a link</Text>
            <Text style={st.inputLabel}>URL</Text>
            <TextInput style={st.input} placeholder="https://..." placeholderTextColor="#9B8FAD" value={linkUrl} onChangeText={setLinkUrl} keyboardType="url" autoCapitalize="none" />
            <Text style={[st.inputLabel, { marginTop: 12 }]}>Label (optional)</Text>
            <TextInput style={st.input} placeholder="e.g. Our playlist" placeholderTextColor="#9B8FAD" value={linkLabel} onChangeText={setLinkLabel} />
            <View style={st.sheetActions}>
              <TouchableOpacity style={st.btnSec} onPress={closeModal}><Text style={st.btnSecText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[st.btnPri, !linkUrl.trim() && { opacity: 0.4 }]} disabled={!linkUrl.trim()} onPress={async () => {
                const url = linkUrl.trim()
                const label = linkLabel.trim() || url
                const content: any = { url, label }
                // Fetch link preview in background
                const preview = await fetchLinkPreview(url).catch(() => null)
                if (preview?.title) content.label = label === url ? preview.title : label
                if (preview?.image) content.ogImage = preview.image
                if (preview?.siteName) content.siteName = preview.siteName
                if (preview?.favicon) content.favicon = preview.favicon
                await insertWidget('link', content, 200, 120)
                setLinkUrl(''); setLinkLabel('')
              }}><Text style={st.btnPriText}>Add Link</Text></TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* TEMPLATES MODAL */}
      <Modal visible={activeModal === 'templates'} transparent animationType="slide">
        <View style={st.overlay}>
          <View style={[st.sheet, { maxHeight: '70%' }]}>
            <View style={st.sheetHandle} />
            <Text style={st.sheetTitle}>Layout Templates</Text>
            <Text style={{ color: '#9B8FAD', fontSize: 13, marginBottom: 12, paddingHorizontal: 20 }}>Quickly add a set of widgets to your space</Text>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {WIDGET_TEMPLATES.map(t => (
                <TouchableOpacity key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#3D2E52' }}
                  onPress={() => applyTemplate(t)}>
                  <Text style={{ fontSize: 28 }}>{t.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#F5EEF8', fontWeight: '700', fontSize: 15 }}>{t.name}</Text>
                    <Text style={{ color: '#9B8FAD', fontSize: 12, marginTop: 2 }}>{t.description}</Text>
                    <Text style={{ color: '#C9956C', fontSize: 11, marginTop: 4 }}>{t.widgets.length} widgets</Text>
                  </View>
                  <Text style={{ color: '#9B8FAD', fontSize: 20 }}>›</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
              <TouchableOpacity style={st.btnSec} onPress={closeModal}><Text style={st.btnSecText}>Cancel</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={activeModal === 'capsule'} transparent animationType="slide">
        <KeyboardAvoidingView style={st.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={st.sheet}>
            <View style={st.sheetHandle} />
            <Text style={st.sheetTitle}>Time capsule</Text>
            <Text style={st.inputLabel}>Note</Text>
            <TextInput style={st.textarea} multiline placeholder="Something to remember..." placeholderTextColor="#9B8FAD" value={capsuleNote} onChangeText={setCapsuleNote} />
            <Text style={[st.inputLabel, { marginTop: 12 }]}>Unlock date (YYYY-MM-DD)</Text>
            <TextInput style={st.input} placeholder="2026-01-01" placeholderTextColor="#9B8FAD" value={capsuleUnlockDate} onChangeText={setCapsuleUnlockDate} keyboardType="numbers-and-punctuation" />
            <Text style={{ fontSize: 11, color: '#9B8FAD', marginTop: 6, fontStyle: 'italic' }}>A photo picker will appear after you tap Add</Text>
            <View style={st.sheetActions}>
              <TouchableOpacity style={st.btnSec} onPress={closeModal}><Text style={st.btnSecText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={st.btnPri} onPress={handleAddCapsule}><Text style={st.btnPriText}>Add Capsule</Text></TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ProjectChat
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        projectType="space"
        projectId={spaceId}
        currentUserId={userId}
      />

    </GestureHandlerRootView>
  )
}


const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1A1118' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#F5EEF8' },
  headerSub: { fontSize: 10, color: '#9B8FAD', marginTop: 1 },
  nameInput: { fontSize: 16, fontWeight: '800', color: '#F5EEF8', borderBottomWidth: 1, borderBottomColor: '#C9956C', paddingVertical: 2, minWidth: 100 },
  iconBtn: { backgroundColor: '#2D2040', borderRadius: 8, width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#3D2E52' },
  emptyOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyTitle: { fontSize: 22, fontWeight: '700', color: '#F5EEF8' },
  emptyText: { fontSize: 13, color: '#9B8FAD', textAlign: 'center', maxWidth: 260 },
  moodPickerOuter: { position: 'absolute', bottom: 130, left: 0, right: 0, alignItems: 'center', zIndex: 60 },
  moodPicker: { backgroundColor: '#221A2C', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#3D2E52', alignItems: 'center' },
  toolbarToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  toolbarChevron: { fontSize: 14, color: '#C9956C', fontWeight: '800' },
  toolbarToggleText: { fontSize: 14, fontWeight: '600', color: '#C9956C' },
  toolbarGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  toolbarBtn: { alignItems: 'center', backgroundColor: '#2D2040', borderRadius: 14, padding: 10, minWidth: 68, borderWidth: 1, borderColor: '#3D2E52' },
  toolbarLabel: { fontSize: 10, color: '#9B8FAD', marginTop: 4 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#221A2C', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 44, borderTopWidth: 1, borderColor: '#3D2E52' },
  styleSheet: { backgroundColor: '#221A2C', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 12, borderTopWidth: 1, borderColor: '#3D2E52', height: SH * 0.52 },
  sheetHandle: { width: 40, height: 4, backgroundColor: '#3D2E52', borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: '#F5EEF8', marginBottom: 20 },
  inputLabel: { fontSize: 13, color: '#9B8FAD', marginBottom: 8 },
  input: { backgroundColor: '#2D2040', borderWidth: 1, borderColor: '#3D2E52', borderRadius: 12, padding: 14, color: '#F5EEF8', fontSize: 15 },
  textarea: { backgroundColor: '#2D2040', borderWidth: 1, borderColor: '#3D2E52', borderRadius: 12, padding: 14, color: '#F5EEF8', fontSize: 15, minHeight: 100, textAlignVertical: 'top' },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  btnPri: { backgroundColor: '#C9956C', borderRadius: 12, paddingHorizontal: 22, paddingVertical: 13, alignItems: 'center' },
  btnPriText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnSec: { backgroundColor: '#2D2040', borderRadius: 12, paddingHorizontal: 22, paddingVertical: 13, borderWidth: 1, borderColor: '#3D2E52', alignItems: 'center' },
  btnSecText: { color: '#F5EEF8', fontSize: 15 },
  searchGo: { backgroundColor: '#C9956C', borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' },
  songRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 10 },
  songArt: { width: 44, height: 44, borderRadius: 8 },
  styleLabel: { fontSize: 12, color: '#9B8FAD', marginBottom: 8 },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  colorSwatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: '#3D2E52', alignItems: 'center', justifyContent: 'center' },
  colorSwatchSelected: { borderColor: '#C9956C', borderWidth: 2.5 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choiceBtn: { backgroundColor: '#2D2040', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: '#3D2E52' },
  choiceBtnActive: { backgroundColor: '#C9956C', borderColor: '#C9956C' },
  choiceBtnText: { fontSize: 12, color: '#9B8FAD' },
  replaceBtn: { backgroundColor: '#2D2040', borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#3D2E52', marginTop: 12 },
  replaceBtnText: { color: '#C9956C', fontWeight: '600', fontSize: 14 },
  deleteBtn: { margin: 14, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#EF4444' },
  deleteBtnText: { color: '#EF4444', fontWeight: '600', fontSize: 14 },
  patternBtn: { alignItems: 'center', backgroundColor: '#2D2040', borderRadius: 10, padding: 10, minWidth: 64, borderWidth: 1, borderColor: '#3D2E52' },
  musicCard: { backgroundColor: '#2D2040', borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#3D2E52' },
  musicCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  playBtn: { backgroundColor: '#C9956C', borderRadius: 20, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  musicEmptyCard: { backgroundColor: '#2D2040', borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#3D2E52', borderStyle: 'dashed' },
  templateCard: { paddingVertical: 20, paddingHorizontal: 10, backgroundColor: '#221A2C', borderRadius: 20, borderWidth: 1, borderColor: '#3D2E52', alignItems: 'center', width: (SW - 68) / 3 }
})