import { useAudioPlayer } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import FilteredImage from '../../components/FilteredImage';
import PhotoFilterPicker from '../../components/PhotoFilterPicker';
import ProjectChat from '../../components/ProjectChat';
import ScrapbookOrganizer from '../../components/ScrapbookOrganizer';
import { notifyMembers } from '../../lib/network';
import { notify } from '../../lib/notifications';
import { storageUploadUrl } from '../../lib/storage';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../lib/ThemeContext';
import { getLimits, useAnchorPlus } from '../../lib/useAnchorPlus';
import { useBiometricSetting } from '../../lib/useBiometricSetting';

const { width: SW, height: SH } = Dimensions.get('window')
const PAGE_W = SW - 48
const PAGE_H = PAGE_W * (16 / 9)

// ─── Free-plan caps ────────────────────────────────────────────────────────────
const FREE_SCRAPBOOK_CAP = 3

const THEME_COLORS = ['#C9956C', '#B8A9D9', '#EF4444', '#3B82F6', '#22C55E', '#EAB308', '#EC4899', '#221A2C']
const PAGE_COLORS = ['#FFFFFF', '#FFF8F0', '#FDF6E3', '#F0F4FF', '#F0FFF4', '#FFF0F0', '#F5F0FF', '#FFFFF0', '#E8E0D5', '#1A1118']
const TEXT_COLORS = ['#1A1118', '#FFFFFF', '#C9956C', '#B8A9D9', '#EF4444', '#3B82F6', '#22C55E', '#9B8FAD']
const FONT_OPTIONS = [
  { label: 'Default', value: 'System' },
  { label: 'Serif', value: 'Georgia' },
  { label: 'Mono', value: 'Courier' },
  { label: 'Rounded', value: 'Arial Rounded MT Bold' },
  { label: 'Thin', value: 'Helvetica Neue' },
  { label: 'Bold', value: 'AvenirNext-Heavy' },
]
const STICKERS = ['❤️', '✨', '🌸', '⭐', '🎀', '🌙', '☀️', '🦋', '🌺', '💫', '🎵', '📸', '✈️', '🗺️', '🏖️', '🏔️', '🌿', '🍃', '🎭', '🎨', '🦄', '🍓', '🌈', '🎪']

type BorderPreset = 'none' | 'floral' | 'hearts' | 'stars' | 'vintage' | 'minimal'
const BORDER_PRESETS: { key: BorderPreset; label: string; emoji: string }[] = [
  { key: 'none', label: 'None', emoji: '∅' },
  { key: 'floral', label: 'Floral', emoji: '🌸' },
  { key: 'hearts', label: 'Hearts', emoji: '❤️' },
  { key: 'stars', label: 'Stars', emoji: '⭐' },
  { key: 'vintage', label: 'Vintage', emoji: '✦' },
  { key: 'minimal', label: 'Minimal', emoji: '▪' },
]


function ff(f: string | undefined) { return f && f !== 'System' ? f : undefined }

type Friend = {
  id: string
  display_name: string | null
  username: string | null
}

type Scrapbook = {
  id: string; name: string; cover_url: string | null
  canvas_id: string; created_by: string; created_at: string
  theme_color: string | null; entryCount?: number
  bg_music_url?: string | null; bg_music_name?: string | null; bg_music_volume?: number
  front_cover?: any; back_cover?: any
}

type PageElement = {
  id: string; type: 'photo' | 'text' | 'sticker'
  x: number; y: number; w: number; h: number
  rotation: number; zIndex: number
  url?: string; filter?: string
  text?: string; fontSize?: number; fontFamily?: string
  color?: string; bold?: boolean; italic?: boolean
  emoji?: string
}

type Page = {
  id: string; scrapbook_id: string
  bg_color: string; bg_photo_url: string | null
  bg_blur: number; bg_dim: number
  page_size: string; border_preset?: BorderPreset
  elements: PageElement[]
  added_by: string; created_at: string
  sequence_index: number
}

type ScrapbookMember = { user_id: string; can_edit: boolean; display_name: string }

async function uploadPhoto(uri: string, canvasId: string, prefix: string): Promise<string | null> {
  try {
    const path = `${canvasId}/scrapbook-${prefix}-${Date.now()}.jpg`
    const fd = new FormData()
    fd.append('file', { uri, name: `${prefix}.jpg`, type: 'image/jpeg' } as any)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(
      storageUploadUrl('canvas-images', path),
      { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'x-upsert': 'true' }, body: fd }
    )
    if (!res.ok) return null
    return supabase.storage.from('canvas-images').getPublicUrl(path).data.publicUrl
  } catch { return null }
}

async function pickSingleImage(): Promise<string | null> {
  const p = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!p.granted) return null
  const opts: ImagePicker.ImagePickerOptions = { quality: 0.85 }
  // @ts-ignore
  opts.mediaTypes = (ImagePicker as any).MediaType?.Images ?? ImagePicker.MediaTypeOptions.Images
  const r = await ImagePicker.launchImageLibraryAsync(opts)
  if (r.canceled) return null
  return r.assets[0].uri
}

// ─── Page Border ──────────────────────────────────────────────────────────────
function PageBorder({ preset }: { preset: BorderPreset }) {
  const { colors: C } = useTheme()
  if (preset === 'none') return null
  if (preset === 'minimal') {
    return <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: 10, right: 10, bottom: 10, borderWidth: 1, borderColor: '#9B8FAD55', borderRadius: 2 }} />
  }
  if (preset === 'vintage') {
    return <>
      <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: 10, right: 10, bottom: 10, borderWidth: 2, borderColor: '#C9956C', borderRadius: 2 }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: 15, left: 15, right: 15, bottom: 15, borderWidth: 1, borderColor: '#C9956C55', borderRadius: 1 }} />
      {([{ top: 6, left: 6 }, { top: 6, right: 6 }, { bottom: 6, left: 6 }, { bottom: 6, right: 6 }] as any[]).map((pos, i) => (
        <Text key={i} pointerEvents="none" style={[{ position: 'absolute', fontSize: 14, color: C.accent } as any, pos]}>✦</Text>
      ))}
    </>
  }
  const emojiMap: Record<string, string> = { floral: '🌸', hearts: '❤️', stars: '⭐' }
  const emoji = emojiMap[preset] || '🌸'
  const PAD = 8, CORNER = 22, ITEM = 18
  const hItems = Math.max(2, Math.floor((PAGE_W - CORNER * 2) / 44))
  const vItems = Math.max(2, Math.floor((PAGE_H - CORNER * 2) / 44))
  const hSpacing = (PAGE_W - CORNER * 2) / (hItems + 1)
  const vSpacing = (PAGE_H - CORNER * 2) / (vItems + 1)
  const items: { key: string; style: any }[] = []
  for (let i = 1; i <= hItems; i++) {
    items.push({ key: `t${i}`, style: { position: 'absolute', top: PAD, left: CORNER + i * hSpacing - ITEM / 2, fontSize: ITEM } })
    items.push({ key: `b${i}`, style: { position: 'absolute', bottom: PAD, left: CORNER + i * hSpacing - ITEM / 2, fontSize: ITEM } })
  }
  for (let i = 1; i <= vItems; i++) {
    items.push({ key: `l${i}`, style: { position: 'absolute', left: PAD, top: CORNER + i * vSpacing - ITEM / 2, fontSize: ITEM } })
    items.push({ key: `r${i}`, style: { position: 'absolute', right: PAD, top: CORNER + i * vSpacing - ITEM / 2, fontSize: ITEM } })
  }
  return <>
    {([{ top: PAD, left: PAD }, { top: PAD, right: PAD }, { bottom: PAD, left: PAD }, { bottom: PAD, right: PAD }] as any[]).map((pos, i) => (
      <Text key={`c${i}`} pointerEvents="none" style={[{ position: 'absolute', fontSize: CORNER } as any, pos]}>{emoji}</Text>
    ))}
    {items.map(item => <Text key={item.key} pointerEvents="none" style={item.style as any}>{emoji}</Text>)}
  </>
}

// ─── Draggable + Resizable Element ────────────────────────────────────────────
function DraggableElement({ el, selected, onSelect, onUpdate, onDelete, onEditText, canEdit }: {
  el: PageElement; selected: boolean
  onSelect: (id: string | null) => void
  onUpdate: (id: string, updates: Partial<PageElement>) => void
  onDelete: (id: string) => void
  onEditText: (el: PageElement) => void
  canEdit: boolean
}) {
  const { colors: C } = useTheme()
  const px = useSharedValue(el.x)
  const py = useSharedValue(el.y)
  const pw = useSharedValue(el.w)
  const ph = useSharedValue(el.h)
  const rot = useSharedValue(el.rotation || 0)
  const startX = useSharedValue(el.x)
  const startY = useSharedValue(el.y)
  const startW = useSharedValue(el.w)
  const startH = useSharedValue(el.h)
  const startRot = useSharedValue(el.rotation || 0)
  const isDraggingRot = useSharedValue(0)
  const [rotDisplay, setRotDisplay] = useState(Math.round(el.rotation || 0))

  useEffect(() => {
    px.value = el.x; py.value = el.y; pw.value = el.w; ph.value = el.h; rot.value = el.rotation || 0
  }, [el.x, el.y, el.w, el.h, el.rotation])

  const tap = Gesture.Tap().numberOfTaps(1).maxDuration(250).requireExternalGestureToFail().onEnd(() => { runOnJS(onSelect)(el.id) })
  const doubleTap = Gesture.Tap().numberOfTaps(2).maxDuration(300).onEnd(() => { if (el.type === 'text') runOnJS(onEditText)(el) })
  const drag = Gesture.Pan().enabled(canEdit).minDistance(10).activateAfterLongPress(0)
    .onStart(() => { startX.value = px.value; startY.value = py.value; runOnJS(onSelect)(el.id) })
    .onUpdate(e => {
      px.value = Math.max(0, Math.min(PAGE_W - pw.value, startX.value + e.translationX))
      py.value = Math.max(0, Math.min(PAGE_H - ph.value, startY.value + e.translationY))
    })
    .onEnd(() => { runOnJS(onUpdate)(el.id, { x: px.value, y: py.value }) })
  const mainGesture = Gesture.Race(doubleTap, drag, tap)
  const anim = useAnimatedStyle(() => ({
    position: 'absolute' as const, left: px.value, top: py.value,
    width: pw.value, height: ph.value, zIndex: el.zIndex + (selected ? 1000 : 1),
    transform: [{ rotate: `${rot.value}deg` }],
  }))
  const resizeDrag = Gesture.Pan().enabled(canEdit && selected)
    .onStart(() => { startW.value = pw.value; startH.value = ph.value })
    .onUpdate(e => { pw.value = Math.max(40, startW.value + e.translationX); ph.value = Math.max(30, startH.value + e.translationY) })
    .onEnd(() => { runOnJS(onUpdate)(el.id, { w: pw.value, h: ph.value }) })
  const rotDrag = Gesture.Pan().enabled(canEdit && selected)
    .onStart(() => { startRot.value = rot.value; isDraggingRot.value = 1 })
    .onUpdate(e => { rot.value = startRot.value + e.translationX * 0.5; runOnJS(setRotDisplay)(Math.round(rot.value)) })
    .onEnd(() => { isDraggingRot.value = 0; runOnJS(onUpdate)(el.id, { rotation: rot.value }) })
  const rotIndicatorStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const, bottom: 20, left: -60,
    backgroundColor: '#221A2C', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: '#B8A9D9', opacity: isDraggingRot.value ? 1 : 0, zIndex: 10000,
  }))

  return (
    <Animated.View style={anim}>
      <GestureDetector gesture={mainGesture}>
        <View style={{ width: '100%', height: '100%' }}>
          {el.type === 'photo' && el.url ? (
            <FilteredImage uri={el.url} filter={el.filter} style={{ width: '100%', height: '100%', borderRadius: 4 }} />
          ) : el.type === 'text' ? (
            <View style={{ width: '100%', height: '100%' }}>
              <Text style={{ color: el.color || '#1A1118', fontSize: el.fontSize || 16, fontFamily: ff(el.fontFamily), fontWeight: el.bold ? '700' : '400', fontStyle: el.italic ? 'italic' : 'normal', flexShrink: 1 }} numberOfLines={0}>{el.text}</Text>
            </View>
          ) : el.type === 'sticker' ? (
            <Text style={{ fontSize: el.w * 0.75, textAlign: 'center', lineHeight: el.h }}>{el.emoji}</Text>
          ) : null}
          {selected && canEdit && (
            <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { borderWidth: 1.5, borderColor: '#C9956C', borderRadius: 4, borderStyle: 'dashed' }]} />
          )}
        </View>
      </GestureDetector>
      {selected && canEdit && (
        <>
          <TouchableOpacity onPress={() => onDelete(el.id)} style={{ position: 'absolute', top: -12, right: -12, width: 28, height: 28, borderRadius: 14, backgroundColor: '#EF4444', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '900', lineHeight: 18 }}>×</Text>
          </TouchableOpacity>
          <GestureDetector gesture={resizeDrag}>
            <View style={{ position: 'absolute', bottom: -12, right: -12, width: 28, height: 28, borderRadius: 14, backgroundColor: '#C9956C', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
              <Text style={{ fontSize: 12, color: '#fff' }}>⤡</Text>
            </View>
          </GestureDetector>
          <GestureDetector gesture={rotDrag}>
            <View style={{ position: 'absolute', bottom: -12, left: -12, width: 28, height: 28, borderRadius: 14, backgroundColor: '#B8A9D9', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
              <Text style={{ fontSize: 13, color: '#fff' }}>↻</Text>
            </View>
          </GestureDetector>
          <Animated.View style={rotIndicatorStyle}>
            <Text style={{ color: '#B8A9D9', fontSize: 11, fontWeight: '700' }}>{rotDisplay}°</Text>
          </Animated.View>
        </>
      )}
    </Animated.View>
  )
}

// ─── Page Canvas ──────────────────────────────────────────────────────────────
function PageCanvas({ page, canEdit, onSave, canvasId, remoteVersion }: {
  page: Page; canEdit: boolean; onSave: (p: Page) => void; canvasId: string; remoteVersion: number
}) {
  const { colors: C } = useTheme()
  const hasLocalEditsRef = useRef(false)   // ← moved here from module level
  const st = makeStyles(C)
  const [elements, setElements] = useState<PageElement[]>(page.elements || [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filterMode, setFilterMode] = useState(false)
  const [toolbarVisible, setToolbarVisible] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [textModalOpen, setTextModalOpen] = useState(false)
  const [stickerModalOpen, setStickerModalOpen] = useState(false)
  const [bgModalOpen, setBgModalOpen] = useState(false)
  const textValRef = useRef('')
  const [textDisplay, setTextDisplay] = useState('')
  const [textColor, setTextColor] = useState('#1A1118')
  const [textFont, setTextFont] = useState('System')
  const [textSize, setTextSize] = useState(16)
  const [textBold, setTextBold] = useState(false)
  const [textItalic, setTextItalic] = useState(false)
  const editElRef = useRef<PageElement | null>(null)
  const [bgColor, setBgColor] = useState(page.bg_color || '#FFFFFF')
  const [bgPhotoUrl, setBgPhotoUrl] = useState<string | null>(page.bg_photo_url || null)
  const [bgBlur, setBgBlur] = useState(page.bg_blur || 0)
  const [bgDim, setBgDim] = useState(page.bg_dim || 0)
  const [borderPreset, setBorderPreset] = useState<BorderPreset>((page.border_preset as BorderPreset) || 'none')

  useEffect(() => {
    setElements(page.elements || [])
    setBgColor(page.bg_color || '#FFFFFF')
    setBgPhotoUrl(page.bg_photo_url || null)
    setBgBlur(page.bg_blur || 0)
    setBgDim(page.bg_dim || 0)
    setBorderPreset((page.border_preset as BorderPreset) || 'none')
    setSelectedId(null)
    hasLocalEditsRef.current = false
  }, [page.id])

  // Sync remote updates from another user WITHOUT overwriting local edits in progress
  useEffect(() => {
    if (remoteVersion > 0 && !hasLocalEditsRef.current) {
      setElements(page.elements || [])
      setBgColor(page.bg_color || '#FFFFFF')
      setBgPhotoUrl(page.bg_photo_url || null)
      setBgBlur(page.bg_blur || 0)
      setBgDim(page.bg_dim || 0)
      setBorderPreset((page.border_preset as BorderPreset) || 'none')
    }
  }, [remoteVersion])

  function nextZ() { return elements.reduce((m, e) => Math.max(m, e.zIndex), 0) + 1 }

  hasLocalEditsRef.current = false
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function debouncedSave(updated: Page) {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(async () => {
      await supabase.from('scrapbook_entries').update({
        bg_color: updated.bg_color, bg_photo_url: updated.bg_photo_url,
        bg_blur: updated.bg_blur, bg_dim: updated.bg_dim, page_size: updated.page_size,
        elements: JSON.stringify(updated.elements), border_preset: updated.border_preset,
        updated_at: new Date().toISOString()
      }).eq('id', updated.id)
      hasLocalEditsRef.current = false
    }, 600)
  }


  hasLocalEditsRef.current = true
  function persist(els: PageElement[], overrides: Partial<Page> = {}) {
    setElements(els)
    const updated: Page = {
      ...page, elements: els,
      bg_color: overrides.bg_color ?? bgColor,
      bg_photo_url: overrides.bg_photo_url !== undefined ? overrides.bg_photo_url : bgPhotoUrl,
      bg_blur: overrides.bg_blur ?? bgBlur,
      bg_dim: overrides.bg_dim ?? bgDim,
      border_preset: overrides.border_preset ?? borderPreset,
      ...overrides,
    }
    onSave(updated)
    debouncedSave(updated)
  }

  function updateElement(id: string, updates: Partial<PageElement>) {
    persist(elements.map(e => e.id === id ? { ...e, ...updates } : e))
  }

  function deleteElement(id: string) { persist(elements.filter(e => e.id !== id)); setSelectedId(null) }

  function openTextModal(el?: PageElement) {
    if (el) {
      editElRef.current = el
      const val = el.text || ''
      textValRef.current = val; setTextDisplay(val)
      setTextColor(el.color || '#1A1118'); setTextFont(el.fontFamily || 'System')
      setTextSize(el.fontSize || 16); setTextBold(!!el.bold); setTextItalic(!!el.italic)
    } else {
      editElRef.current = null; textValRef.current = ''; setTextDisplay('')
      setTextColor('#1A1118'); setTextFont('System'); setTextSize(16); setTextBold(false); setTextItalic(false)
    }
    setTimeout(() => setTextModalOpen(true), 80)
  }

  function handleSaveText() {
    const val = textValRef.current.trim()
    if (!val) { setTextModalOpen(false); return }
    if (editElRef.current) {
      updateElement(editElRef.current.id, { text: val, fontSize: textSize, fontFamily: textFont, color: textColor, bold: textBold, italic: textItalic })
    } else {
      const el: PageElement = {
        id: Date.now().toString(), type: 'text',
        x: 20, y: 40, w: Math.min(PAGE_W - 40, 220), h: textSize * 2.5,
        rotation: 0, zIndex: nextZ(),
        text: val, fontSize: textSize, fontFamily: textFont, color: textColor, bold: textBold, italic: textItalic,
      }
      persist([...elements, el])
    }
    setTextModalOpen(false); editElRef.current = null
  }

  async function handleAddPhoto() {
    const uri = await pickSingleImage(); if (!uri) return
    setUploading(true)
    const url = await uploadPhoto(uri, canvasId, 'page')
    if (url) {
      const el: PageElement = {
        id: Date.now().toString(), type: 'photo',
        x: 20, y: 40, w: PAGE_W * 0.7, h: PAGE_W * 0.7,
        rotation: 0, zIndex: nextZ(), url,
      }
      persist([...elements, el])
    }
    setUploading(false)
  }

  function handleAddSticker(emoji: string) {
    const el: PageElement = {
      id: Date.now().toString(), type: 'sticker',
      x: PAGE_W / 2 - 30, y: PAGE_H / 2 - 30,
      w: 60, h: 60, rotation: 0, zIndex: nextZ(), emoji,
    }
    persist([...elements, el]); setStickerModalOpen(false)
  }

  async function handleChangeBgPhoto() {
    const uri = await pickSingleImage(); if (!uri) return
    setUploading(true)
    const url = await uploadPhoto(uri, canvasId, 'bg')
    if (url) {
      setBgPhotoUrl(url)
      supabase.from('scrapbook_entries').update({ bg_photo_url: url, elements: JSON.stringify(elements) }).eq('id', page.id)
    }
    setUploading(false)
  }

  function applyBg() {
    const updated: Page = { ...page, elements, bg_color: bgColor, bg_photo_url: bgPhotoUrl, bg_blur: bgBlur, bg_dim: bgDim, border_preset: borderPreset }
    onSave(updated); setBgModalOpen(false)
    supabase.from('scrapbook_entries').update({ bg_color: bgColor, bg_photo_url: bgPhotoUrl, bg_blur: bgBlur, bg_dim: bgDim, elements: JSON.stringify(elements), border_preset: borderPreset }).eq('id', page.id)
  }

  const selectedEl = elements.find(e => e.id === selectedId) ?? null

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#D4C9B8' }}>
      <ScrollView contentContainerStyle={{ alignItems: 'center', paddingVertical: 12 }} showsVerticalScrollIndicator={false} scrollEnabled={!selectedId}>
        <View style={{ width: PAGE_W, height: PAGE_H, backgroundColor: bgColor, borderRadius: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 10, position: 'relative', overflow: 'visible' }}>
          <View style={[StyleSheet.absoluteFillObject, { borderRadius: 3, overflow: 'hidden' }]}>
            {bgPhotoUrl && (
              <>
                <Image source={{ uri: bgPhotoUrl }} style={StyleSheet.absoluteFillObject} resizeMode="cover" blurRadius={bgBlur} />
                {bgDim > 0 && <View style={[StyleSheet.absoluteFillObject, { backgroundColor: `rgba(0,0,0,${bgDim})` }]} />}
              </>
            )}
            <PageBorder preset={borderPreset} />
          </View>
          {elements.slice().sort((a, b) => a.zIndex - b.zIndex).map(el => (
            <DraggableElement key={el.id} el={el} selected={selectedId === el.id} onSelect={setSelectedId} onUpdate={updateElement} onDelete={deleteElement} onEditText={openTextModal} canEdit={canEdit} />
          ))}
          {elements.length === 0 && (
            <View style={{ position: 'absolute', top: PAGE_H / 2 - 20, left: 0, right: 0, alignItems: 'center' }}>
              <Text style={{ color: '#C8BFB0', fontSize: 13, fontStyle: 'italic' }}>tap ✏️ to add content</Text>
            </View>
          )}
          <TouchableOpacity activeOpacity={1} onPress={() => setSelectedId(null)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 }} />
        </View>
      </ScrollView>

      {selectedEl && canEdit && (
        <View style={st.selBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, alignItems: 'center' }}>
            <Text style={{ color: '#9B8FAD', fontSize: 10, marginRight: 4 }}>{selectedEl.type === 'photo' ? '📷' : selectedEl.type === 'text' ? 'T' : '✨'}{'  drag · ⤡ resize · ↻ rotate'}</Text>
            {selectedEl.type === 'text' && <TouchableOpacity style={st.selBarBtn} onPress={() => openTextModal(selectedEl)}><Text style={st.selBarBtnText}>✏️ Edit text</Text></TouchableOpacity>}
            {selectedEl.type === 'photo' && <TouchableOpacity style={st.selBarBtn} onPress={() => setFilterMode(f => !f)}><Text style={st.selBarBtnText}>🎨 Filter</Text></TouchableOpacity>}
            <TouchableOpacity style={st.selBarBtn} onPress={() => updateElement(selectedEl.id, { zIndex: nextZ() })}><Text style={st.selBarBtnText}>↑ Front</Text></TouchableOpacity>
            <TouchableOpacity style={[st.selBarBtn, { borderColor: '#EF4444' }]} onPress={() => deleteElement(selectedEl.id)}><Text style={[st.selBarBtnText, { color: '#EF4444' }]}>🗑</Text></TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {filterMode && selectedEl?.type === 'photo' && selectedEl.url && (
        <PhotoFilterPicker
          imageUri={selectedEl.url}
          selected={selectedEl.filter || 'original'}
          onSelect={(key) => { updateElement(selectedEl.id, { filter: key === 'original' ? undefined : key }) }}
        />
      )}

      {canEdit && (
        <TouchableOpacity style={[st.toolbarToggleFloat, toolbarVisible && { backgroundColor: '#3D2E52' }]} onPress={() => { setToolbarVisible(v => !v); setSelectedId(null) }}>
          <Text style={{ fontSize: 16 }}>{toolbarVisible ? '✕' : '✏️'}</Text>
        </TouchableOpacity>
      )}

      {canEdit && toolbarVisible && (
        <View style={st.floatingToolbar}>
          <TouchableOpacity style={st.floatBtn} onPress={handleAddPhoto} disabled={uploading}>
            <Text style={{ fontSize: 22 }}>{uploading ? '⏳' : '📷'}</Text>
            <Text style={st.floatBtnLabel}>Photo</Text>
          </TouchableOpacity>
          <View style={st.floatDivider} />
          <TouchableOpacity style={st.floatBtn} onPress={() => openTextModal()}>
            <Text style={{ fontSize: 18, fontWeight: '900', color: '#C9956C' }}>T</Text>
            <Text style={st.floatBtnLabel}>Text</Text>
          </TouchableOpacity>
          <View style={st.floatDivider} />
          <TouchableOpacity style={st.floatBtn} onPress={() => setStickerModalOpen(true)}>
            <Text style={{ fontSize: 22 }}>✨</Text>
            <Text style={st.floatBtnLabel}>Sticker</Text>
          </TouchableOpacity>
          <View style={st.floatDivider} />
          <TouchableOpacity style={st.floatBtn} onPress={() => setBgModalOpen(true)}>
            <Text style={{ fontSize: 22 }}>🎨</Text>
            <Text style={st.floatBtnLabel}>Page</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Text modal */}
      <Modal visible={textModalOpen} transparent animationType="slide" onRequestClose={() => setTextModalOpen(false)}>
        <KeyboardAvoidingView style={st.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView style={st.sheetScroll} contentContainerStyle={{ paddingBottom: 44 }} keyboardShouldPersistTaps="handled">
            <View style={st.sheetHandle} />
            <Text style={st.sheetTitle}>{editElRef.current ? 'Edit text' : 'Add text'}</Text>
            <TextInput style={st.textarea} multiline autoFocus placeholder="Write something..." placeholderTextColor="#9B8FAD" defaultValue={textDisplay} onChangeText={v => { textValRef.current = v }} />
            <Text style={st.label}>Font</Text>
            <View style={st.btnRow}>
              {FONT_OPTIONS.map(f => (
                <TouchableOpacity key={f.value} onPress={() => setTextFont(f.value)} style={[st.choiceBtn, textFont === f.value && st.choiceBtnActive]}>
                  <Text style={[st.choiceBtnText, textFont === f.value && { color: '#fff' }, { fontFamily: ff(f.value) }]}>{f.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[st.label, { marginTop: 14 }]}>Size</Text>
            <View style={st.btnRow}>
              {[10, 14, 18, 22, 28, 36, 48].map(sz => (
                <TouchableOpacity key={sz} onPress={() => setTextSize(sz)} style={[st.choiceBtn, textSize === sz && st.choiceBtnActive]}>
                  <Text style={[st.choiceBtnText, textSize === sz && { color: '#fff' }]}>{sz}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[st.label, { marginTop: 14 }]}>Colour</Text>
            <View style={st.colorRow}>
              {TEXT_COLORS.map(c => (
                <TouchableOpacity key={c} onPress={() => setTextColor(c)} style={[st.colorDot, { backgroundColor: c }, textColor === c && { borderColor: '#C9956C', borderWidth: 2.5 }]} />
              ))}
            </View>
            <View style={[st.btnRow, { marginTop: 14 }]}>
              <TouchableOpacity onPress={() => setTextBold(b => !b)} style={[st.choiceBtn, textBold && st.choiceBtnActive]}>
                <Text style={[st.choiceBtnText, textBold && { color: '#fff' }, { fontWeight: '700' }]}>Bold</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setTextItalic(i => !i)} style={[st.choiceBtn, textItalic && st.choiceBtnActive]}>
                <Text style={[st.choiceBtnText, textItalic && { color: '#fff' }, { fontStyle: 'italic' }]}>Italic</Text>
              </TouchableOpacity>
            </View>
            <View style={[st.btnRow, { marginTop: 20, justifyContent: 'flex-end' }]}>
              <TouchableOpacity style={st.btnSec} onPress={() => { setTextModalOpen(false); editElRef.current = null }}><Text style={st.btnSecText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={st.btnPri} onPress={handleSaveText}><Text style={st.btnPriText}>{editElRef.current ? 'Update' : 'Add'}</Text></TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Sticker modal */}
      <Modal visible={stickerModalOpen} transparent animationType="slide" onRequestClose={() => setStickerModalOpen(false)}>
        <View style={st.overlay}>
          <View style={st.sheet}>
            <View style={st.sheetHandle} />
            <Text style={st.sheetTitle}>Add sticker</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
              {STICKERS.map(s => (
                <TouchableOpacity key={s} onPress={() => handleAddSticker(s)} style={{ padding: 8, backgroundColor: '#2D2040', borderRadius: 12, borderWidth: 1, borderColor: '#3D2E52' }}>
                  <Text style={{ fontSize: 32 }}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={[st.btnSec, { marginTop: 20 }]} onPress={() => setStickerModalOpen(false)}><Text style={st.btnSecText}>Close</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* BG modal */}
      <Modal visible={bgModalOpen} transparent animationType="slide" onRequestClose={() => setBgModalOpen(false)}>
        <View style={st.overlay}>
          <ScrollView style={st.sheetScroll} contentContainerStyle={{ paddingBottom: 44 }} keyboardShouldPersistTaps="handled">
            <View style={st.sheetHandle} />
            <Text style={st.sheetTitle}>Page settings</Text>
            <Text style={st.label}>Page colour</Text>
            <View style={st.colorRow}>
              {PAGE_COLORS.map(c => (
                <TouchableOpacity key={c} onPress={() => setBgColor(c)} style={[st.colorDot, { width: 38, height: 38, backgroundColor: c, borderWidth: 1, borderColor: '#999' }, bgColor === c && { borderColor: '#C9956C', borderWidth: 3 }]} />
              ))}
            </View>
            <TouchableOpacity style={[st.btnSec, { marginTop: 16 }]} onPress={handleChangeBgPhoto} disabled={uploading}>
              <Text style={st.btnSecText}>{uploading ? 'Uploading...' : '🖼  Set background photo'}</Text>
            </TouchableOpacity>
            {bgPhotoUrl && (
              <>
                <Text style={[st.label, { marginTop: 16 }]}>Blur</Text>
                <View style={st.btnRow}>
                  {[0, 2, 5, 10, 20].map(v => (
                    <TouchableOpacity key={v} onPress={() => setBgBlur(v)} style={[st.choiceBtn, bgBlur === v && st.choiceBtnActive]}>
                      <Text style={[st.choiceBtnText, bgBlur === v && { color: '#fff' }]}>{v}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={[st.label, { marginTop: 14 }]}>Dim</Text>
                <View style={st.btnRow}>
                  {[0, 0.2, 0.4, 0.6, 0.8].map(v => (
                    <TouchableOpacity key={v} onPress={() => setBgDim(v)} style={[st.choiceBtn, bgDim === v && st.choiceBtnActive]}>
                      <Text style={[st.choiceBtnText, bgDim === v && { color: '#fff' }]}>{Math.round(v * 100)}%</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity style={[st.btnSec, { marginTop: 10 }]} onPress={() => { setBgPhotoUrl(null); setBgBlur(0); setBgDim(0) }}>
                  <Text style={[st.btnSecText, { color: '#EF4444' }]}>Remove background photo</Text>
                </TouchableOpacity>
              </>
            )}
            <Text style={[st.label, { marginTop: 20 }]}>Page border</Text>
            <View style={st.btnRow}>
              {BORDER_PRESETS.map(b => (
                <TouchableOpacity key={b.key} onPress={() => setBorderPreset(b.key)} style={[st.choiceBtn, borderPreset === b.key && st.choiceBtnActive, { alignItems: 'center', minWidth: 58 }]}>
                  <Text style={{ fontSize: 18 }}>{b.emoji}</Text>
                  <Text style={[st.choiceBtnText, { marginTop: 2 }, borderPreset === b.key && { color: '#fff' }]}>{b.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={[st.btnRow, { marginTop: 24, justifyContent: 'flex-end' }]}>
              <TouchableOpacity style={st.btnSec} onPress={() => setBgModalOpen(false)}><Text style={st.btnSecText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={st.btnPri} onPress={applyBg}><Text style={st.btnPriText}>Apply</Text></TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </GestureHandlerRootView>
  )
}

// ─── Cover Editor ─────────────────────────────────────────────────────────────
function CoverEditor({ title, cover, isFront, themeColor, canvasId, onSave, onClose }: {
  title: string; cover: any; isFront: boolean; themeColor: string
  canvasId: string; onSave: (c: any) => void; onClose: () => void
}) {
  const st = makeStyles(useTheme().colors)
  const [bgColor, setBgColor] = useState(cover?.bgColor || (isFront ? themeColor : '#1A1118'))
  const [bgPhotoUrl, setBgPhotoUrl] = useState<string | null>(cover?.bgPhotoUrl || null)
  const [text, setText] = useState(cover?.text || (isFront ? title : ''))
  const [textColor, setTextColor] = useState(cover?.textColor || '#FFFFFF')
  const [font, setFont] = useState(cover?.font || 'System')
  const [uploading, setUploading] = useState(false)

  async function changeBgPhoto() {
    const uri = await pickSingleImage(); if (!uri) return
    setUploading(true)
    const url = await uploadPhoto(uri, canvasId, `cover-${isFront ? 'front' : 'back'}`)
    if (url) setBgPhotoUrl(url)
    setUploading(false)
  }

  return (
    <View style={st.overlay}>
      <ScrollView style={st.sheetScroll} contentContainerStyle={{ paddingBottom: 44 }}>
        <View style={st.sheetHandle} />
        <Text style={st.sheetTitle}>{isFront ? 'Front cover' : 'Back cover'}</Text>
        <View style={[st.coverPreview, { backgroundColor: bgColor }]}>
          {bgPhotoUrl && <Image source={{ uri: bgPhotoUrl }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />}
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.25)' }]} />
          <Text style={{ color: textColor, fontSize: 22, fontWeight: '800', fontFamily: ff(font), textAlign: 'center', padding: 16 }}>{text || title}</Text>
          {!isFront && <Text style={{ color: textColor, fontSize: 11, opacity: 0.6 }}>THE END</Text>}
        </View>
        <Text style={st.label}>Cover text</Text>
        <TextInput style={st.input} value={text} onChangeText={setText} placeholder={isFront ? title : 'Optional'} placeholderTextColor="#9B8FAD" />
        <Text style={[st.label, { marginTop: 14 }]}>Background</Text>
        <View style={st.colorRow}>
          {[...THEME_COLORS, '#FFFFFF', '#1A1118', '#FFF8F0'].map(c => (
            <TouchableOpacity key={c} onPress={() => setBgColor(c)} style={[st.colorDot, { backgroundColor: c }, bgColor === c && { borderColor: '#fff', borderWidth: 2.5 }]} />
          ))}
        </View>
        <TouchableOpacity style={[st.btnSec, { marginTop: 12 }]} onPress={changeBgPhoto} disabled={uploading}>
          <Text style={st.btnSecText}>{uploading ? 'Uploading...' : '🖼  Set cover photo'}</Text>
        </TouchableOpacity>
        <Text style={[st.label, { marginTop: 14 }]}>Text colour</Text>
        <View style={st.colorRow}>
          {TEXT_COLORS.map(c => (
            <TouchableOpacity key={c} onPress={() => setTextColor(c)} style={[st.colorDot, { backgroundColor: c }, textColor === c && { borderColor: '#C9956C', borderWidth: 2.5 }]} />
          ))}
        </View>
        <Text style={[st.label, { marginTop: 14 }]}>Font</Text>
        <View style={st.btnRow}>
          {FONT_OPTIONS.map(f => (
            <TouchableOpacity key={f.value} onPress={() => setFont(f.value)} style={[st.choiceBtn, font === f.value && st.choiceBtnActive]}>
              <Text style={[st.choiceBtnText, font === f.value && { color: '#fff' }, { fontFamily: ff(f.value) }]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={[st.btnRow, { marginTop: 20, justifyContent: 'flex-end' }]}>
          <TouchableOpacity style={st.btnSec} onPress={onClose}><Text style={st.btnSecText}>Cancel</Text></TouchableOpacity>
          <TouchableOpacity style={st.btnPri} onPress={() => onSave({ bgColor, bgPhotoUrl, text, textColor, font })}>
            <Text style={st.btnPriText}>Save cover</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ScrapbookTab() {
  const { isPlus } = useAnchorPlus()
  const limits = getLimits(isPlus)
  const { colors: C } = useTheme()
  const st = makeStyles(C)
  const { prompt: biometricPrompt } = useBiometricSetting()
  const [canvasId, setCanvasId] = useState<string | null>(null)
  const [userId, setUserId] = useState('')
  const [scrapbooks, setScrapbooks] = useState<Scrapbook[]>([])
  const [currentBook, setCurrentBook] = useState<Scrapbook | null>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [currentPageIdx, setCurrentPageIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [pagesLoading, setPagesLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [members, setMembers] = useState<ScrapbookMember[]>([])
  const [showFrontCover, setShowFrontCover] = useState(true)
  const [createModal, setCreateModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTheme, setNewTheme] = useState('#C9956C')
  const [creating, setCreating] = useState(false)
  const [coverModal, setCoverModal] = useState<'front' | 'back' | null>(null)
  const [bookMenuId, setBookMenuId] = useState<string | null>(null)
  const [coverUploadingId, setCoverUploadingId] = useState<string | null>(null)
  const [membersModal, setMembersModal] = useState(false)
  const [musicModal, setMusicModal] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [organizerOpen, setOrganizerOpen] = useState(false)
  const [remotePageVersions, setRemotePageVersions] = useState<Record<string, number>>({})
  // ── Scrapbook invite (friend-picker) state ────────────────────────────────
  const [scrapbookInviteModal, setScrapbookInviteModal] = useState<{ scrapbookId: string; scrapbookName: string } | null>(null)
  const [scrapbookInviteFriends, setScrapbookInviteFriends] = useState<Friend[]>([])
  const [scrapbookInviteLoading, setScrapbookInviteLoading] = useState(false)
  const [addingFriendToScrapbook, setAddingFriendToScrapbook] = useState<string | null>(null)

  // ── Audio ─────────────────────────────────────────────────────────────────
  const [musicUrl, setMusicUrl] = useState<string | null>(null)
  const [bgVolume, setBgVolume] = useState(0.3)
  const [bgPlaying, setBgPlaying] = useState(false)
  const [musicSearchQuery, setMusicSearchQuery] = useState('')
  const [musicResults, setMusicResults] = useState<any[]>([])
  const [musicSearching, setMusicSearching] = useState(false)

  const musicPlayer = useAudioPlayer(musicUrl ? { uri: musicUrl } : null)

  useEffect(() => {
    if (!musicPlayer || !musicUrl) return
    try { musicPlayer.loop = true; musicPlayer.volume = bgVolume; musicPlayer.play(); setBgPlaying(true) } catch { }
  }, [musicPlayer, musicUrl])

  useEffect(() => {
    return () => { try { musicPlayer?.pause() } catch { } }
  }, [musicPlayer])

  function startMusic(url: string, vol: number) { setBgVolume(vol); setMusicUrl(url) }
  function stopMusic() { try { musicPlayer?.pause() } catch { }; setMusicUrl(null); setBgPlaying(false) }

  function togglePlay() {
    if (!musicPlayer || !musicUrl) { if (currentBook?.bg_music_url) startMusic(currentBook.bg_music_url, bgVolume); return }
    try {
      if (bgPlaying) { musicPlayer.pause(); setBgPlaying(false) }
      else { musicPlayer.play(); setBgPlaying(true) }
    } catch { }
  }

  async function handleVolumeChange(v: number) {
    setBgVolume(v)
    try { if (musicPlayer) musicPlayer.volume = v } catch { }
    if (currentBook) await supabase.from('scrapbooks').update({ bg_music_volume: v }).eq('id', currentBook.id)
  }

  // ── Page swipe gesture ────────────────────────────────────────────────────
  const swipeGesture = Gesture.Pan()
    .minDistance(40).maxPointers(1)
    .onEnd(e => {
      if (Math.abs(e.velocityX) < Math.abs(e.velocityY)) return
      if (e.translationX < -50) runOnJS(handleSwipeNext)()
      else if (e.translationX > 50) runOnJS(handleSwipePrev)()
    })

  function handleSwipeNext() {
    if (!currentBook) return
    const totalPages = pages.length
    const showBack = !showFrontCover && currentPageIdx >= totalPages
    if (showBack) return
    Haptics.selectionAsync()
    if (showFrontCover) { setShowFrontCover(false); setCurrentPageIdx(0) }
    else if (currentPageIdx >= totalPages - 1) { setCurrentPageIdx(totalPages) }
    else { setCurrentPageIdx(i => i + 1) }
  }

  function handleSwipePrev() {
    if (!currentBook) return
    const totalPages = pages.length
    const showBack = !showFrontCover && currentPageIdx >= totalPages
    if (showFrontCover) return
    Haptics.selectionAsync()
    if (showBack) { setCurrentPageIdx(totalPages - 1) }
    else if (currentPageIdx === 0) { setShowFrontCover(true) }
    else { setCurrentPageIdx(i => i - 1) }
  }

  // ── Load: own canvas + cross-user invited scrapbooks ─────────────────────
  async function load() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      // Ensure the user has a canvas (for cover uploads etc.)
      let { data: canvas } = await supabase.from('canvases').select('id')
        .or(`owner_id.eq.${user.id},partner_id.eq.${user.id}`).limit(1).maybeSingle()
      if (!canvas) {
        const { data: newCanvas } = await supabase.from('canvases')
          .insert({ name: 'My Space', owner_id: user.id, background_type: 'color', background_value: '#1A1118', theme: 'none' })
          .select('id').single()
        canvas = newCanvas
      }
      if (canvas) setCanvasId(canvas.id)

      // Fetch ALL scrapbook IDs the user is a member of (any canvas)
      const { data: memberships } = await supabase
        .from('scrapbook_members')
        .select('scrapbook_id')
        .eq('user_id', user.id)
      const memberScrapbookIds = (memberships ?? []).map((m: any) => m.scrapbook_id)

      // Build query: own canvas scrapbooks + member scrapbooks across all canvases
      let booksQuery = supabase.from('scrapbooks').select('*')
      if (canvas && memberScrapbookIds.length > 0) {
        booksQuery = booksQuery.or(`canvas_id.eq.${canvas.id},id.in.(${memberScrapbookIds.join(',')})`)
      } else if (canvas) {
        booksQuery = booksQuery.eq('canvas_id', canvas.id)
      } else if (memberScrapbookIds.length > 0) {
        booksQuery = booksQuery.in('id', memberScrapbookIds)
      } else {
        setScrapbooks([]); setLoading(false); return
      }

      const { data: books } = await booksQuery.order('created_at', { ascending: false })
      if (books) {
        const withCounts = await Promise.all(books.map(async b => {
          const { count } = await supabase.from('scrapbook_entries').select('*', { count: 'exact', head: true }).eq('scrapbook_id', b.id)
          return { ...b, entryCount: count || 0 } as Scrapbook
        }))
        setScrapbooks(withCounts)
      }
    } catch (e) {
      console.log('[Scrapbook] load error:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel(`scrapbook-list-realtime-${userId}`)

      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'scrapbook_members',
        filter: `user_id=eq.${userId}`,
      }, () => load())

      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'scrapbook_members',
        filter: `user_id=eq.${userId}`,
      }, (payload: any) => {
        setMembers((prev: ScrapbookMember[]) =>
          prev.map((m: ScrapbookMember) =>
            m.user_id === payload.new.user_id
              ? { ...m, can_edit: payload.new.can_edit }
              : m
          )
        )
        if (currentBook) {
          const updated = payload.new
          if (updated.scrapbook_id === currentBook.id && updated.user_id === userId) {
            setCanEdit(currentBook.created_by === userId || !!updated.can_edit)
          }
        }
      })

      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'scrapbook_members',
        filter: `user_id=eq.${userId}`,
      }, () => load())

      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'scrapbook_entries',
      }, (payload: any) => {
        setScrapbooks((prev: Scrapbook[]) =>
          prev.map((b: Scrapbook) =>
            b.id === payload.new.scrapbook_id
              ? { ...b, entryCount: (b.entryCount ?? 0) + 1 }
              : b
          )
        )
        if (currentBook?.id === payload.new.scrapbook_id) {
          const newPage = {
            ...payload.new,
            elements: typeof payload.new.elements === 'string'
              ? JSON.parse(payload.new.elements)
              : (payload.new.elements || []),
            bg_color: payload.new.bg_color || '#FFFFFF',
          }
          setPages((prev: Page[]) => {
            if (prev.find((p: Page) => p.id === newPage.id)) return prev
            return [...prev, newPage]
          })
        }
      })

      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'scrapbook_entries',
      }, (payload: any) => {
        if (currentBook?.id === payload.new.scrapbook_id) {
          setPages((prev: Page[]) =>
            prev.map((p: Page) =>
              p.id === payload.new.id
                ? {
                  ...p,
                  ...payload.new,
                  elements: typeof payload.new.elements === 'string'
                    ? JSON.parse(payload.new.elements)
                    : (payload.new.elements || []),
                }
                : p
            )
          )
        }
      })

      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'scrapbooks',
      }, (payload: any) => {
        setScrapbooks((prev: Scrapbook[]) => prev.filter((b: Scrapbook) => b.id !== payload.old.id))
        if (currentBook?.id === payload.old.id) {
          setCurrentBook(null)
          setPages([])
        }
      })

      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId, currentBook?.id])
  // ── end of block to insert in ScrapbookTab ──
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel(`scrapbook-list-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'scrapbook_members', filter: `user_id=eq.${userId}` },
        () => load())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'scrapbook_members', filter: `user_id=eq.${userId}` },
        () => load())
      // Your own can_edit permission was changed → update canEdit live
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'scrapbook_members', filter: `user_id=eq.${userId}` },
        (payload) => {
          // Update the members list if a book is open
          setMembers((prev: ScrapbookMember[]) =>
            prev.map(m => m.user_id === payload.new.user_id
              ? { ...m, can_edit: payload.new.can_edit } : m))
          // Update canEdit flag for currently open book
          if (currentBook && currentBook.id === payload.new.scrapbook_id && payload.new.user_id === userId) {
            setCanEdit(currentBook.created_by === userId || !!payload.new.can_edit)
          }
        })
      // New page added (by anyone) → update page count in list + add to open book
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'scrapbook_entries' },
        (payload) => {
          setScrapbooks(prev => prev.map(b =>
            b.id === payload.new.scrapbook_id
              ? { ...b, entryCount: (b.entryCount ?? 0) + 1 } : b
          ))
          if (currentBook?.id === payload.new.scrapbook_id) {
            const newPage = {
              ...payload.new,
              elements: typeof payload.new.elements === 'string'
                ? JSON.parse(payload.new.elements) : (payload.new.elements || []),
              bg_color: payload.new.bg_color || '#FFFFFF',
            }
            setPages(prev => prev.map(p =>
              p.id === payload.new.id
                ? {
                  ...p,
                  ...payload.new,
                  elements: typeof payload.new.elements === 'string'
                    ? JSON.parse(payload.new.elements)
                    : (payload.new.elements || []),
                  bg_color: payload.new.bg_color || p.bg_color,
                } as Page          // ← add "as Page" cast here
                : p
            ))
          }
        })
      // Page content changed by another user → update in open book
      // (uses remotePageVersions to signal PageCanvas to sync its internal state)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'scrapbook_entries' },
        (payload) => {
          if (currentBook?.id === payload.new.scrapbook_id) {
            setPages(prev => prev.map(p =>
              p.id === payload.new.id
                ? {
                  ...p, ...payload.new,
                  elements: typeof payload.new.elements === 'string'
                    ? JSON.parse(payload.new.elements) : (payload.new.elements || []),
                }
                : p
            ))
            // Bump version so PageCanvas knows a remote update arrived
            setRemotePageVersions((prev: Record<string, number>) => ({ ...prev, [payload.new.id]: (prev[payload.new.id] ?? 0) + 1 }))
          }
        })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'scrapbooks' },
        (payload) => {
          setScrapbooks(prev => prev.filter(b => b.id !== (payload.old as any).id))
          if (currentBook?.id === (payload.old as any).id) { setCurrentBook(null); setPages([]) }
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId, currentBook?.id])


  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false) }, [])

  // ── Load pages + determine edit permission ────────────────────────────────
  async function loadPages(bookId: string, uid: string, booksList: Scrapbook[]) {
    setPagesLoading(true)
    const { data } = await supabase.from('scrapbook_entries').select('*').eq('scrapbook_id', bookId).order('sequence_index', { ascending: true })
    const parsed = (data || []).map(p => ({ ...p, elements: typeof p.elements === 'string' ? JSON.parse(p.elements) : (p.elements || []), bg_color: p.bg_color || '#FFFFFF' })) as Page[]
    setPages(parsed)
    const { data: mems } = await supabase.from('scrapbook_members').select('user_id, can_edit').eq('scrapbook_id', bookId)
    const withNames = await Promise.all((mems || []).map(async m => {
      const { data: prof } = await supabase.from('users').select('display_name').eq('id', m.user_id).maybeSingle()
      return { ...m, display_name: prof?.display_name || 'Unknown' }
    }))
    setMembers(withNames)
    const book = booksList.find(b => b.id === bookId)
    const isOwner = book?.created_by === uid
    const memberEntry = withNames.find(m => m.user_id === uid)
    setCanEdit(isOwner || !!memberEntry?.can_edit)
    setPagesLoading(false)
  }

  async function openBook(book: Scrapbook) {
    const ok = await biometricPrompt()
    if (!ok) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setCurrentBook(book); setCurrentPageIdx(0); setShowFrontCover(true)
    loadPages(book.id, userId, scrapbooks)
    if (book.bg_music_url) startMusic(book.bg_music_url, book.bg_music_volume || 0.3)
  }

  function goBack() {
    stopMusic()
    setCurrentBook(null); setPages([]); setCurrentPageIdx(0); setShowFrontCover(true)
    load()
  }

  // ── Scrapbook invite: open friend-picker ──────────────────────────────────
  async function openScrapbookInviteModal() {
    if (!currentBook) return
    // Close members modal FIRST, before any async work
    setMembersModal(false)
    setScrapbookInviteModal({ scrapbookId: currentBook.id, scrapbookName: currentBook.name })
    setScrapbookInviteLoading(true)
    setScrapbookInviteFriends([])
    try {
      // Two-step query — avoids PostgREST nested join which can freeze
      const { data: rows } = await supabase
        .from('friends')
        .select('requester_id, addressee_id')
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
        .eq('status', 'accepted')

      if (!rows?.length) {
        setScrapbookInviteFriends([])
        setScrapbookInviteLoading(false)
        return
      }

      const otherIds = rows.map((r: any) =>
        r.requester_id === userId ? r.addressee_id : r.requester_id
      )

      const { data: profiles } = await supabase
        .from('users')
        .select('id, display_name, username')
        .in('id', otherIds)

      // Filter out people already in the scrapbook
      const existingIds = new Set(members.map(m => m.user_id))
      setScrapbookInviteFriends(
        ((profiles ?? []) as Friend[]).filter(f => !existingIds.has(f.id))
      )
    } catch (e) {
      console.log('scrapbook invite load error', e)
      Alert.alert('Error', 'Could not load friends. Please try again.')
    } finally {
      setScrapbookInviteLoading(false)
    }
  }

  // ── Scrapbook invite: add friend with plan-cap check ──────────────────────
  async function addFriendToScrapbook(friend: Friend) {
    if (!scrapbookInviteModal || !currentBook) return
    setAddingFriendToScrapbook(friend.id)
    try {
      // 1. Check if the invitee is on Anchor Plus
      const { data: friendPlus } = await supabase
        .from('anchor_plus')
        .select('id')
        .eq('user_id', friend.id)
        .maybeSingle()

      // 2. If free plan, count total scrapbook memberships
      if (!friendPlus) {
        const { count } = await supabase
          .from('scrapbook_members')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', friend.id)
        if ((count ?? 0) >= FREE_SCRAPBOOK_CAP) {
          Alert.alert(
            'Cannot invite',
            `${friend.display_name || '@' + friend.username} is on the free plan and has already reached the ${FREE_SCRAPBOOK_CAP}-scrapbook limit. They would need Anchor Plus to join more.`
          )
          setAddingFriendToScrapbook(null)
          return
        }
      }

      // 3. Insert via SECURITY DEFINER function to avoid RLS policy cycle
      const { error } = await supabase.rpc('add_scrapbook_member', {
        p_scrapbook_id: scrapbookInviteModal.scrapbookId,
        p_user_id: friend.id,
        p_can_edit: false,
      })
      if (error && !error.message.includes('23505') && !error.message.toLowerCase().includes('duplicate')) {
        throw error
      }

      // 4. Reflect locally
      setMembers(prev => [...prev, {
        user_id: friend.id,
        can_edit: false,
        display_name: friend.display_name || friend.username || 'Unknown',
      }])
      Alert.alert(
        'Added ✓',
        `${friend.display_name || '@' + friend.username} has been added to "${scrapbookInviteModal.scrapbookName}" as a viewer. Toggle can-edit from the members list.`
      )
      setScrapbookInviteModal(null)
    } catch (e: any) {
      Alert.alert('Error', e.message)
    }
    setAddingFriendToScrapbook(null)
  }

  async function handleMusicSearch() {
    if (!musicSearchQuery.trim()) return
    setMusicSearching(true)
    try {
      const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(musicSearchQuery)}&media=music&limit=8`)
      const json = await res.json()
      setMusicResults(json.results ?? [])
    } catch { Alert.alert('Search failed') }
    setMusicSearching(false)
  }

  async function handleRemoveMusic() {
    if (!currentBook) return
    stopMusic()
    await supabase.from('scrapbooks').update({ bg_music_url: null, bg_music_name: null }).eq('id', currentBook.id)
    setCurrentBook(prev => prev ? { ...prev, bg_music_url: null, bg_music_name: null } : prev)
    setMusicModal(false)
  }

  async function addPage() {
    if (!currentBook || !userId) { Alert.alert('Error', 'Not ready — please go back and reopen the scrapbook.'); return }
    if (pages.length >= limits.scrapbookPages) { Alert.alert('Page limit', `Free plan allows ${limits.scrapbookPages} pages.`); return }
    const { data, error } = await supabase.from('scrapbook_entries').insert({
      scrapbook_id: currentBook.id, bg_color: '#FFFFFF', bg_photo_url: null, bg_blur: 0, bg_dim: 0,
      page_size: 'portrait', elements: JSON.stringify([]), border_preset: 'none', added_by: userId,
    }).select('*').single()
    if (error) { Alert.alert('Could not add page', error.message); return }
    if (data) {
      const newPage = { ...data, elements: [], bg_color: '#FFFFFF' } as Page
      const newPages = [...pages, newPage]
      setPages(newPages); setCurrentPageIdx(newPages.length - 1); setShowFrontCover(false)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      await notify.scrapbookUpdated(currentBook.name, 'You')
      const { data: userData } = await supabase.from('users').select('display_name').eq('id', userId).maybeSingle()
      await notifyMembers({
        type: 'scrapbook_page',
        scrapbook_id: currentBook.id,
        actor_id: userId,
        actor_name: userData?.display_name || 'Someone',
        title: 'Scrapbook updated 📖',
        body: `${userData?.display_name || 'Someone'} added a page to "${currentBook.name}"`,
      })
    }
  }

  async function deletePage(id: string) {
    Alert.alert('Delete page?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('scrapbook_entries').delete().eq('id', id)
          const newPages = pages.filter(p => p.id !== id)
          setPages(newPages)
          setCurrentPageIdx(Math.max(0, currentPageIdx - 1))
          if (newPages.length === 0) setShowFrontCover(true)
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
        }
      }
    ])
  }

  async function savePage(updated: Page) {
    setPages(prev => prev.map(p => p.id === updated.id ? updated : p))
    await supabase.from('scrapbook_entries').update({
      bg_color: updated.bg_color, bg_photo_url: updated.bg_photo_url,
      bg_blur: updated.bg_blur, bg_dim: updated.bg_dim, page_size: updated.page_size,
      elements: JSON.stringify(updated.elements), border_preset: updated.border_preset,
    }).eq('id', updated.id)
  }

  async function saveCover(type: 'front' | 'back', cover: any) {
    if (!currentBook) return
    const field = type === 'front' ? 'front_cover' : 'back_cover'
    await supabase.from('scrapbooks').update({ [field]: cover }).eq('id', currentBook.id)
    setCurrentBook(prev => prev ? { ...prev, [field]: cover } : prev)
    setCoverModal(null)
  }

  async function handleCreate() {
    if (!newName.trim()) { Alert.alert('Name required', 'Give your scrapbook a name.'); return }
    if (!userId) { Alert.alert('Error', 'Not signed in — please restart the app.'); return }
    setCreating(true)
    // Use SECURITY DEFINER RPC to avoid RLS recursion (policy cycle between
    // scrapbooks ↔ scrapbook_members). The function creates both rows atomically.
    const { data: newId, error } = await supabase.rpc('create_scrapbook', {
      p_name: newName.trim(),
      p_canvas_id: canvasId || null,
      p_theme_color: newTheme,
    })
    const data = newId ? { id: newId, name: newName.trim(), canvas_id: canvasId, created_by: userId, theme_color: newTheme, front_cover: null, back_cover: null, bg_music_url: null, bg_music_name: null, bg_music_volume: 0.3, cover_url: null, created_at: new Date().toISOString() } as Scrapbook : null
    if (!error && data) {
      // member row already created inside the RPC — no second insert needed
      setScrapbooks(prev => [{ ...data, entryCount: 0 }, ...prev])
      setNewName(''); setNewTheme('#C9956C'); setCreateModal(false)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } else if (error) {
      Alert.alert('Error', error.message)
    }
    setCreating(false)
  }

  async function handleDeleteBook(id: string) {
    Alert.alert('Delete scrapbook?', 'This permanently removes all pages.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('social_posts').delete().eq('reference_id', id).eq('type', 'scrapbook')
          await supabase.from('scrapbooks').delete().eq('id', id)
          setScrapbooks(prev => prev.filter(b => b.id !== id))
          setBookMenuId(null)
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
        }
      },
    ])
  }

  async function handleToggleEdit(memberId: string, current: boolean) {
    if (!currentBook) return
    const newValue = !current

    // Optimistic update — matches the old feel
    setMembers(prev =>
      prev.map(m => m.user_id === memberId ? { ...m, can_edit: newValue } : m)
    )

    try {
      const { error } = await supabase.rpc('toggle_scrapbook_member_edit', {
        p_scrapbook_id: currentBook.id,
        p_user_id: memberId,
        p_can_edit: newValue,
      })
      if (error) throw error
    } catch (e: any) {
      // Roll back optimistic update on failure
      setMembers(prev =>
        prev.map(m => m.user_id === memberId ? { ...m, can_edit: current } : m)
      )
      Alert.alert('Could not update permissions', e.message)
    }
  }

  async function uploadBookCover(bookId: string) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) { Alert.alert('Permission needed'); return }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.85, allowsEditing: true, aspect: [1, 1] })
    if (result.canceled || !canvasId) return
    setCoverUploadingId(bookId)
    try {
      const uri = result.assets[0].uri
      const path = `${canvasId}/book-cover-${bookId}-${Date.now()}.jpg`
      const fd = new FormData()
      fd.append('file', { uri, name: 'cover.jpg', type: 'image/jpeg' } as any)
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(storageUploadUrl('canvas-images', path),
        { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'x-upsert': 'true' }, body: fd })
      if (!res.ok) throw new Error('Upload failed')
      const url = supabase.storage.from('canvas-images').getPublicUrl(path).data.publicUrl
      await supabase.from('scrapbooks').update({ cover_url: url }).eq('id', bookId)
      setScrapbooks(prev => prev.map(b => b.id === bookId ? { ...b, cover_url: url } : b))
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (e: any) { Alert.alert('Upload failed', e.message) }
    setCoverUploadingId(null)
    setBookMenuId(null)
  }

  // ─── Book reader ───────────────────────────────────────────────────────────
  if (currentBook) {
    const isOwner = currentBook.created_by === userId
    const fc = currentBook.front_cover || {}
    const bc = currentBook.back_cover || {}
    const totalPages = pages.length
    const showBack = !showFrontCover && currentPageIdx >= totalPages
    const canGoNext = !showBack
    const canGoPrev = !showFrontCover

    // Use the scrapbook's own canvas for uploads (correct even for cross-user books)
    const uploadCanvasId = currentBook.canvas_id || canvasId || ''

    function goNext() {
      Haptics.selectionAsync()
      if (showFrontCover) { setShowFrontCover(false); setCurrentPageIdx(0) }
      else if (currentPageIdx >= totalPages - 1) { setCurrentPageIdx(totalPages) }
      else { setCurrentPageIdx(i => i + 1) }
    }

    function goPrev() {
      Haptics.selectionAsync()
      if (showFrontCover) return
      if (showBack) { setCurrentPageIdx(totalPages - 1) }
      else if (currentPageIdx === 0) { setShowFrontCover(true) }
      else { setCurrentPageIdx(i => i - 1) }
    }

    return (
      <SafeAreaView style={st.safe}>
        {/* ── Header ── */}
        <View style={[st.header, { borderBottomColor: currentBook.theme_color || '#2D2040' }]}>
          <TouchableOpacity onPress={goBack} style={st.backBtn}>
            <Text style={st.backText}>← Back</Text>
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={st.headerTitle} numberOfLines={1}>{currentBook.name}</Text>
            <Text style={{ fontSize: 11, color: C.textSecondary }}>
              {showFrontCover ? 'Cover' : showBack ? 'Back cover' : `Page ${currentPageIdx + 1} of ${totalPages}`}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity style={[st.iconBtn, currentBook.bg_music_url && { borderColor: '#C9956C' }]} onPress={() => {
              if (!limits.music && !currentBook.bg_music_url) {
                Alert.alert('Anchor Plus', 'Background music is an Anchor Plus feature.', [{ text: 'OK' }]); return
              }
              setMusicModal(true)
            }}>
              <Text style={{ fontSize: 13 }}>{bgPlaying ? '🎵' : '🎧'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.iconBtn} onPress={() => setChatOpen(true)}>
              <Text style={{ fontSize: 13 }}>💬</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.iconBtn} onPress={() => setOrganizerOpen(true)}>
              <Text style={{ fontSize: 13 }}>⊞</Text>
            </TouchableOpacity>
            {/* Members / invite button — always visible inside a book */}
            <TouchableOpacity style={st.iconBtn} onPress={() => setMembersModal(true)}>
              <Text style={{ fontSize: 13 }}>👥</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Page reader ── */}
        <GestureHandlerRootView style={{ flex: 1 }}>
          <GestureDetector gesture={swipeGesture}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#D4C9B8' }}>
              <TouchableOpacity style={[st.navArrow, !canGoPrev && { opacity: 0.15 }]} disabled={!canGoPrev} onPress={goPrev}>
                <Text style={st.navArrowText}>‹</Text>
              </TouchableOpacity>

              <View style={{ flex: 1, overflow: 'hidden' }}>
                {pagesLoading ? (
                  <View style={st.center}><ActivityIndicator color="#C9956C" size="large" /></View>
                ) : showFrontCover ? (
                  <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 }} showsVerticalScrollIndicator={false}>
                    <TouchableOpacity activeOpacity={isOwner ? 0.85 : 1} onLongPress={isOwner ? () => setCoverModal('front') : undefined}
                      style={[st.coverDisplay, { backgroundColor: fc.bgColor || currentBook.theme_color || '#C9956C' }]}>
                      {fc.bgPhotoUrl && <Image source={{ uri: fc.bgPhotoUrl }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />}
                      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.2)' }]} />
                      <Text style={{ color: fc.textColor || '#fff', fontSize: 28, fontWeight: '800', fontFamily: ff(fc.font), textAlign: 'center', padding: 24 }}>{fc.text || currentBook.name}</Text>
                      {isOwner && <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, position: 'absolute', bottom: 20 }}>hold to edit · swipe to open</Text>}
                    </TouchableOpacity>
                  </ScrollView>
                ) : showBack ? (
                  <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 }} showsVerticalScrollIndicator={false}>
                    <TouchableOpacity activeOpacity={isOwner ? 0.85 : 1} onLongPress={isOwner ? () => setCoverModal('back') : undefined}
                      style={[st.coverDisplay, { backgroundColor: bc.bgColor || '#1A1118' }]}>
                      {bc.bgPhotoUrl && <Image source={{ uri: bc.bgPhotoUrl }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />}
                      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.3)' }]} />
                      {bc.text ? <Text style={{ color: bc.textColor || '#fff', fontSize: 18, fontFamily: ff(bc.font), textAlign: 'center', padding: 24 }}>{bc.text}</Text> : null}
                      <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, letterSpacing: 3 }}>THE END</Text>
                      {isOwner && <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, position: 'absolute', bottom: 20 }}>hold to edit cover</Text>}
                    </TouchableOpacity>
                  </ScrollView>
                ) : pages[currentPageIdx] ? (
                  // ⬇ Pass the scrapbook's own canvas_id so uploads go to the right bucket folder
                  <PageCanvas
                    key={pages[currentPageIdx].id}
                    page={pages[currentPageIdx]}
                    canEdit={canEdit}
                    onSave={savePage}
                    canvasId={uploadCanvasId}
                    remoteVersion={remotePageVersions[pages[currentPageIdx].id] ?? 0}
                  />
                ) : (
                  <View style={[st.center, { backgroundColor: '#D4C9B8' }]}>
                    <Text style={{ color: '#888', fontSize: 14, marginBottom: 20 }}>No pages yet</Text>
                    {canEdit && <TouchableOpacity style={st.btnPri} onPress={addPage}><Text style={st.btnPriText}>+ Add first page</Text></TouchableOpacity>}
                  </View>
                )}
              </View>

              <TouchableOpacity style={[st.navArrow, !canGoNext && { opacity: 0.15 }]} disabled={!canGoNext} onPress={goNext}>
                <Text style={st.navArrowText}>›</Text>
              </TouchableOpacity>
            </View>
          </GestureDetector>
        </GestureHandlerRootView>

        {/* ── Bottom action bar ── */}
        {canEdit && (
          <View style={st.bottomBar}>
            {(showFrontCover || (!showFrontCover && !showBack)) && (
              <TouchableOpacity style={st.bottomBtn} onPress={addPage}><Text style={st.bottomBtnText}>+ Page</Text></TouchableOpacity>
            )}
            {showFrontCover && isOwner && (
              <>
                <TouchableOpacity style={st.bottomBtn} onPress={() => setCoverModal('front')}><Text style={st.bottomBtnText}>✏️ Front</Text></TouchableOpacity>
                <TouchableOpacity style={st.bottomBtn} onPress={() => setCoverModal('back')}><Text style={st.bottomBtnText}>✏️ Back</Text></TouchableOpacity>
              </>
            )}
            {!showFrontCover && !showBack && pages[currentPageIdx] && (
              <TouchableOpacity style={[st.bottomBtn, { borderColor: '#EF4444' }]} onPress={() => deletePage(pages[currentPageIdx].id)}>
                <Text style={[st.bottomBtnText, { color: '#EF4444' }]}>Delete page</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Cover editor ── */}
        {coverModal && (
          <Modal visible transparent animationType="slide">
            <CoverEditor title={currentBook.name} cover={coverModal === 'front' ? currentBook.front_cover : currentBook.back_cover}
              isFront={coverModal === 'front'} themeColor={currentBook.theme_color || '#C9956C'} canvasId={uploadCanvasId}
              onSave={c => saveCover(coverModal, c)} onClose={() => setCoverModal(null)} />
          </Modal>
        )}

        {/* ── Music modal ── */}
        <Modal visible={musicModal} transparent animationType="slide">
          <KeyboardAvoidingView style={st.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView style={st.sheetScroll} contentContainerStyle={{ paddingBottom: 44 }} keyboardShouldPersistTaps="handled">
              <View style={st.sheetHandle} />
              <Text style={st.sheetTitle}>🎧 Scrapbook music</Text>
              {currentBook.bg_music_url && (
                <>
                  <View style={st.musicCard}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 }}>
                      <Text style={{ fontSize: 28 }}>{bgPlaying ? '🎵' : '🎧'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontWeight: '700', color: C.textPrimary }} numberOfLines={1}>{currentBook.bg_music_name || 'Scrapbook music'}</Text>
                        <Text style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>{bgPlaying ? 'Now playing' : 'Paused'}</Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={togglePlay} style={{ backgroundColor: '#C9956C', borderRadius: 20, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 18 }}>{bgPlaying ? '⏸' : '▶'}</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={[st.label, { marginTop: 16 }]}>Volume</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                    {[0.1, 0.3, 0.5, 0.7, 1.0].map(v => (
                      <TouchableOpacity key={v} onPress={() => handleVolumeChange(v)} style={[st.choiceBtn, Math.abs(bgVolume - v) < 0.05 && st.choiceBtnActive, { flex: 1, alignItems: 'center' }]}>
                        <Text style={[st.choiceBtnText, Math.abs(bgVolume - v) < 0.05 && { color: '#fff' }]}>{Math.round(v * 100)}%</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity onPress={handleRemoveMusic} style={[st.btnSec, { alignItems: 'center', marginBottom: 20 }]}>
                    <Text style={[st.btnSecText, { color: '#EF4444' }]}>Remove music</Text>
                  </TouchableOpacity>
                </>
              )}
              <Text style={st.label}>📁 Upload from phone</Text>
              <TouchableOpacity style={[st.btnSec, { alignItems: 'center', marginBottom: 20 }]}
                onPress={async () => {
                  try {
                    const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true })
                    if (result.canceled || !result.assets?.[0]) return
                    const file = result.assets[0]
                    const { data: { session } } = await supabase.auth.getSession()
                    const path = `${uploadCanvasId}/music-${Date.now()}.mp3`
                    const fd = new FormData()
                    fd.append('file', { uri: file.uri, name: file.name || 'music.mp3', type: file.mimeType || 'audio/mpeg' } as any)
                    const res = await fetch(storageUploadUrl('canvas-images', path), { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'x-upsert': 'true' }, body: fd })
                    if (!res.ok) { Alert.alert('Upload failed', await res.text()); return }
                    const url = supabase.storage.from('canvas-images').getPublicUrl(path).data.publicUrl
                    const name = file.name?.replace(/\.[^/.]+$/, '') || 'My music'
                    await supabase.from('scrapbooks').update({ bg_music_url: url, bg_music_name: name, bg_music_volume: bgVolume }).eq('id', currentBook.id)
                    setCurrentBook(prev => prev ? { ...prev, bg_music_url: url, bg_music_name: name } : prev)
                    startMusic(url, bgVolume)
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                  } catch (e: any) { Alert.alert('Error', e.message) }
                }}>
                <Text style={st.btnSecText}>🎵  Choose MP3 file</Text>
              </TouchableOpacity>
              <Text style={st.label}>🔍 Search for a song</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                <TextInput style={[st.input, { flex: 1 }]} placeholder="Search artist or song..." placeholderTextColor="#9B8FAD" value={musicSearchQuery} onChangeText={setMusicSearchQuery} returnKeyType="search" onSubmitEditing={handleMusicSearch} />
                <TouchableOpacity style={[st.btnPri, { paddingHorizontal: 16 }]} onPress={handleMusicSearch}>
                  <Text style={st.btnPriText}>{musicSearching ? '...' : 'Go'}</Text>
                </TouchableOpacity>
              </View>
              {musicResults.map(r => (
                <TouchableOpacity key={r.trackId} style={[st.musicCard, { marginBottom: 8 }]}
                  onPress={async () => {
                    if (!r.previewUrl) { Alert.alert('No preview available'); return }
                    const name = `${r.trackName} — ${r.artistName}`
                    await supabase.from('scrapbooks').update({ bg_music_url: r.previewUrl, bg_music_name: name, bg_music_volume: bgVolume }).eq('id', currentBook.id)
                    setCurrentBook(prev => prev ? { ...prev, bg_music_url: r.previewUrl, bg_music_name: name } : prev)
                    startMusic(r.previewUrl, bgVolume)
                    setMusicResults([]); setMusicSearchQuery('')
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                  }}>
                  {r.artworkUrl60 && <Image source={{ uri: r.artworkUrl60 }} style={{ width: 44, height: 44, borderRadius: 8 }} />}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: C.textPrimary }} numberOfLines={1}>{r.trackName}</Text>
                    <Text style={{ fontSize: 11, color: C.textSecondary }} numberOfLines={1}>{r.artistName}</Text>
                    {!r.previewUrl && <Text style={{ fontSize: 10, color: '#EF4444' }}>No preview</Text>}
                  </View>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={[st.btnSec, { marginTop: 8, alignItems: 'center' }]} onPress={() => { setMusicModal(false); setMusicResults([]); setMusicSearchQuery('') }}>
                <Text style={st.btnSecText}>Close</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>

        {/* ── Members modal ── */}
        <Modal visible={membersModal} transparent animationType="slide">
          <View style={st.overlay}>
            <View style={st.sheet}>
              <View style={st.sheetHandle} />
              <Text style={st.sheetTitle}>Members</Text>
              {members.length === 0 && <Text style={{ color: C.textSecondary, fontSize: 13, marginBottom: 16 }}>No members yet.</Text>}
              {members.map(m => (
                <View key={m.user_id} style={[st.memberRow, { marginBottom: 12 }]}>
                  <View style={st.memberAvatar}><Text style={st.memberAvatarText}>{m.display_name.slice(0, 2).toUpperCase()}</Text></View>
                  <Text style={{ flex: 1, color: C.textPrimary, fontSize: 14 }}>{m.user_id === userId ? 'You' : m.display_name}</Text>
                  {m.user_id !== userId && isOwner && (
                    <TouchableOpacity style={[st.permBtn, m.can_edit && { backgroundColor: '#C9956C22', borderColor: '#C9956C' }]} onPress={() => handleToggleEdit(m.user_id, m.can_edit)}>
                      <Text style={[st.permBtnText, m.can_edit && { color: C.accent }]}>{m.can_edit ? 'Can edit' : 'View only'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {/* Invite via friend-picker — replaces Share.share */}
              {isOwner && (
                <TouchableOpacity style={[st.btnPri, { marginTop: 16 }]} onPress={openScrapbookInviteModal}>
                  <Text style={st.btnPriText}>✦ Invite a friend</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[st.btnSec, { marginTop: 10 }]} onPress={() => setMembersModal(false)}><Text style={st.btnSecText}>Close</Text></TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* ── Scrapbook friend-picker invite modal ── */}
        <Modal visible={!!scrapbookInviteModal} transparent animationType="slide" onRequestClose={() => setScrapbookInviteModal(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' }}>
            <View style={[st.sheet, { maxHeight: '70%' }]}>
              <View style={st.sheetHandle} />
              <Text style={st.sheetTitle}>Invite to "{scrapbookInviteModal?.scrapbookName}"</Text>
              <Text style={{ fontSize: 13, color: C.textSecondary, marginBottom: 16 }}>Choose a friend to add as viewer (you can toggle edit access in members)</Text>

              {scrapbookInviteLoading ? (
                <ActivityIndicator color={C.accent} style={{ marginVertical: 32 }} />
              ) : scrapbookInviteFriends.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                  <Text style={{ color: C.textSecondary, fontSize: 14, textAlign: 'center' }}>
                    No friends to invite — either all are already members, or you haven't added any friends yet.
                  </Text>
                </View>
              ) : (
                <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
                  {scrapbookInviteFriends.map(friend => (
                    <View key={friend.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}>
                      <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: C.accent, fontSize: 16, fontWeight: '800' }}>
                          {(friend.display_name || friend.username || '?')[0].toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: C.textPrimary, fontSize: 15, fontWeight: '600' }}>{friend.display_name || friend.username}</Text>
                        <Text style={{ color: C.textSecondary, fontSize: 12, marginTop: 1 }}>@{friend.username}</Text>
                      </View>
                      <TouchableOpacity
                        style={[{ backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 }, addingFriendToScrapbook === friend.id && { opacity: 0.5 }]}
                        onPress={() => addFriendToScrapbook(friend)}
                        disabled={addingFriendToScrapbook === friend.id}>
                        {addingFriendToScrapbook === friend.id
                          ? <ActivityIndicator color="#fff" size="small" />
                          : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Add</Text>
                        }
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}

              <TouchableOpacity style={[st.btnSec, { marginTop: 16, alignItems: 'center' }]} onPress={() => setScrapbookInviteModal(null)}>
                <Text style={st.btnSecText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <ProjectChat visible={chatOpen} onClose={() => setChatOpen(false)} projectType="scrapbook" projectId={currentBook.id} currentUserId={userId} />
        <ScrapbookOrganizer
          visible={organizerOpen}
          pages={pages}
          onClose={() => setOrganizerOpen(false)}
          onUpdate={(updated) => setPages([...updated])}
          onJumpToPage={(idx) => { setShowFrontCover(false); setCurrentPageIdx(idx) }}
        />
      </SafeAreaView>
    )
  }

  // ─── Scrapbooks list ───────────────────────────────────────────────────────
  return (
    <SafeAreaView style={st.safe}>
      <View style={st.listHeader}>
        <View>
          <Text style={st.listHeaderTitle}>Scrapbook</Text>
          <Text style={st.listHeaderSub}>{scrapbooks.length === 0 ? 'Your memory books' : `${scrapbooks.length} book${scrapbooks.length !== 1 ? 's' : ''}`}</Text>
        </View>
        <TouchableOpacity style={st.newBtn} onPress={() => setCreateModal(true)}>
          <Text style={st.newBtnText}>+ New</Text>
        </TouchableOpacity>
      </View>
      {loading ? (
        <View style={st.center}><ActivityIndicator color="#C9956C" size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={st.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}>
          {scrapbooks.map((book) => {
            const color = book.theme_color || C.accent
            return (
              <View key={book.id} style={[st.bookCard, { borderColor: C.border }]}>
                <View style={[st.accentBar, { backgroundColor: color }]} />
                <TouchableOpacity style={st.bookInner} onPress={() => openBook(book)} activeOpacity={0.85}>
                  <TouchableOpacity
                    style={[st.coverThumb, { backgroundColor: color + '30', borderColor: color + '60', borderWidth: 1.5 }]}
                    onPress={(e) => { e.stopPropagation?.(); setBookMenuId(book.id) }}
                    activeOpacity={0.85}>
                    {book.cover_url
                      ? <Image source={{ uri: book.cover_url }} style={{ width: '100%', height: '100%', borderRadius: 13 }} resizeMode="cover" />
                      : coverUploadingId === book.id
                        ? <ActivityIndicator color={color} />
                        : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                          <Text style={{ fontSize: 26, fontWeight: '900', color }}>{book.name.slice(0, 1).toUpperCase()}</Text>
                        </View>
                    }
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text style={st.bookName} numberOfLines={1}>{book.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.surfaceHigh, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                        <Text style={{ fontSize: 10 }}>📄</Text>
                        <Text style={[st.bookMeta, { marginTop: 0 }]}>{book.entryCount} {book.entryCount === 1 ? 'page' : 'pages'}</Text>
                      </View>
                      {book.bg_music_url && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.accentSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                          <Text style={{ fontSize: 10 }}>🎵</Text>
                          <Text style={{ fontSize: 10, color: C.accent, fontWeight: '600' }}>Music</Text>
                        </View>
                      )}
                      {book.created_by !== userId && (
                        <View style={{ backgroundColor: C.surfaceHigh, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                          <Text style={{ fontSize: 10, color: C.textMuted }}>Shared</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <TouchableOpacity
                      style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border }}
                      onPress={(e) => { e.stopPropagation?.(); Haptics.selectionAsync(); setBookMenuId(book.id) }}>
                      <Text style={{ color: C.textSecondary, fontSize: 16, letterSpacing: 1 }}>···</Text>
                    </TouchableOpacity>
                    <Text style={st.chevron}>›</Text>
                  </View>
                </TouchableOpacity>

                {/* Inline context menu */}
                {bookMenuId === book.id && (
                  <View style={{ backgroundColor: C.surfaceHigh, borderTopWidth: 1, borderTopColor: C.border, paddingVertical: 4 }}>
                    <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}
                      onPress={() => { uploadBookCover(book.id) }}>
                      <Text style={{ fontSize: 16 }}>🖼️</Text>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: C.textPrimary }}>Set cover photo</Text>
                    </TouchableOpacity>
                    {book.created_by === userId && (
                      <>
                        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: C.border, marginHorizontal: 16 }} />
                        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}
                          onPress={() => { setBookMenuId(null); handleDeleteBook(book.id) }}>
                          <Text style={{ fontSize: 16 }}>🗑️</Text>
                          <Text style={{ fontSize: 14, fontWeight: '600', color: C.danger }}>Delete scrapbook</Text>
                        </TouchableOpacity>
                      </>
                    )}
                    <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}
                      onPress={() => setBookMenuId(null)}>
                      <Text style={{ fontSize: 16 }}>✕</Text>
                      <Text style={{ fontSize: 14, color: C.textSecondary }}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )
          })}

          {scrapbooks.length === 0 && (
            <View style={st.empty}>
              <Text style={st.emptyEmoji}>📖</Text>
              <Text style={st.emptyTitle}>No scrapbooks yet</Text>
              <Text style={st.emptyText}>Create a scrapbook to collect your memories</Text>
              <TouchableOpacity style={st.emptyBtn} onPress={() => setCreateModal(true)}>
                <Text style={st.emptyBtnText}>Create first scrapbook</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Create modal ── */}
      <Modal visible={createModal} transparent animationType="slide">
        <KeyboardAvoidingView style={st.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={st.sheet}>
            <View style={st.sheetHandle} />
            <Text style={st.sheetTitle}>New scrapbook</Text>
            <Text style={st.label}>Name</Text>
            <TextInput style={st.input} placeholder="e.g. Paris Trip, Our First Year..." placeholderTextColor="#9B8FAD" value={newName} onChangeText={setNewName} autoFocus returnKeyType="done" />
            <Text style={[st.label, { marginTop: 16 }]}>Accent colour</Text>
            <View style={st.colorRow}>
              {THEME_COLORS.map(c => (
                <TouchableOpacity key={c} onPress={() => setNewTheme(c)} style={[st.colorDot, { backgroundColor: c }, newTheme === c && { borderColor: '#fff', borderWidth: 2.5 }]} />
              ))}
            </View>
            <View style={[st.accentBar, { backgroundColor: newTheme, borderRadius: 8, marginTop: 14, height: 8 }]} />
            <View style={st.sheetActions}>
              <TouchableOpacity style={st.btnSec} onPress={() => { setCreateModal(false); setNewName('') }}><Text style={st.btnSecText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[st.btnPri, { backgroundColor: newTheme }]} onPress={handleCreate} disabled={creating}>
                <Text style={st.btnPriText}>{creating ? 'Creating...' : 'Create'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

const makeStyles = (C: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.surfaceHigh },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: C.textPrimary, textAlign: 'center' },
  backBtn: { minWidth: 60 },
  backText: { color: C.accent, fontSize: 15 },
  iconBtn: { backgroundColor: C.surfaceHigh, borderRadius: 8, width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border },
  list: { padding: 16, gap: 12, paddingBottom: 48 },
  listHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 },
  listHeaderTitle: { fontSize: 34, fontWeight: '800', color: C.textPrimary, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', letterSpacing: -0.8 },
  listHeaderSub: { fontSize: 13, color: C.textSecondary, marginTop: 3 },
  newBtn: { backgroundColor: C.accent, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 10, alignSelf: 'flex-end' },
  newBtnText: { color: C.bg, fontWeight: '800', fontSize: 13 },
  bookCard: { backgroundColor: C.surface, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  accentBar: { height: 4, width: '100%' },
  bookInner: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
  coverThumb: { width: 72, height: 90, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  bookName: { fontSize: 17, fontWeight: '800', color: C.textPrimary, letterSpacing: -0.2 },
  bookMeta: { fontSize: 12, color: C.textSecondary },
  chevron: { fontSize: 22, color: C.textMuted, fontWeight: '200' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 22, fontWeight: '700', color: C.textPrimary },
  emptyText: { fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { backgroundColor: C.accent, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, marginTop: 8 },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  navArrow: { width: 32, alignItems: 'center', justifyContent: 'center', paddingVertical: 20 },
  navArrowText: { fontSize: 38, color: C.accent, fontWeight: '200' },
  coverDisplay: { width: PAGE_W, height: PAGE_H, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 3 },
  coverPreview: { width: '100%', height: 200, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 16 },
  floatingToolbar: { position: 'absolute', right: 6, top: '15%', backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, paddingVertical: 6, zIndex: 100, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 10 },
  floatBtn: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 3 },
  floatBtnLabel: { fontSize: 9, color: C.textSecondary },
  floatDivider: { height: 1, backgroundColor: C.border, marginHorizontal: 8 },
  toolbarToggleFloat: { position: 'absolute', right: 6, top: '9%', backgroundColor: C.accent, borderRadius: 20, width: 34, height: 34, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 8, zIndex: 200 },
  selBar: { backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border, paddingVertical: 10 },
  selBarBtn: { backgroundColor: C.surfaceHigh, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: C.border },
  selBarBtnText: { fontSize: 12, color: C.accent },
  bottomBar: { flexDirection: 'row', gap: 8, padding: 10, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border },
  bottomBtn: { flex: 1, backgroundColor: C.surfaceHigh, borderRadius: 10, padding: 11, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  bottomBtnText: { color: C.accent, fontWeight: '600', fontSize: 12 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 44, borderTopWidth: 1, borderColor: C.border },
  sheetScroll: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderTopWidth: 1, borderColor: C.border, paddingHorizontal: 24, paddingTop: 12, maxHeight: SH * 0.88 },
  sheetHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: C.textPrimary, marginBottom: 20 },
  label: { fontSize: 12, color: C.textSecondary, marginBottom: 10, fontWeight: '600' },
  input: { backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, color: C.textPrimary, fontSize: 15 },
  textarea: { backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, color: C.textPrimary, fontSize: 15, minHeight: 100, textAlignVertical: 'top' },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 20 },
  btnPri: { backgroundColor: C.accent, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 13, alignItems: 'center' },
  btnPriText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnSec: { backgroundColor: C.surfaceHigh, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 13, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  btnSecText: { color: C.textPrimary, fontSize: 15 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choiceBtn: { backgroundColor: C.surfaceHigh, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: C.border },
  choiceBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
  choiceBtnText: { fontSize: 12, color: C.textSecondary },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorDot: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { fontSize: 12, fontWeight: '700', color: C.accent },
  permBtn: { backgroundColor: C.surfaceHigh, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: C.border },
  permBtnText: { fontSize: 12, color: C.textSecondary },
  musicCard: { backgroundColor: C.surfaceHigh, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: C.border },
})