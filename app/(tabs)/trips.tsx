import { ResizeMode, Video } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Dimensions, FlatList, Image,
  KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import ProjectChat from '../../components/ProjectChat';
import UnlockCelebration from '../../components/UnlockCelebration';
import { notifyMembers } from '../../lib/network';
import { scheduleUnlockReminder } from '../../lib/notifications';
import { storageUploadUrl } from '../../lib/storage';
import { supabase } from '../../lib/supabase';
import { useAnchorPlus } from '../../lib/useAnchorPlus';
import { useBiometricSetting } from '../../lib/useBiometricSetting';

const { width: SW, height: SH } = Dimensions.get('window');
const FREE_MEMBER_LIMIT = 4;
const PAID_MEMBER_LIMIT = 20;
const FREE_MEDIA_LIMIT = 16;
const PAID_MEDIA_LIMIT = 50;
const POLL_INTERVAL_MS = 30_000;

// ─── Types ────────────────────────────────────────────────────────────────────
interface TravelCapsule {
  id: string; name: string; destination: string; description: string;
  visibility: 'locked' | 'public'; unlock_date: string | null;
  is_unlocked: boolean; cover_url: string | null; created_by: string;
  canvas_id: string; media_count: number; member_count: number; created_at: string;
}
interface CapsuleMedia {
  id: string; capsule_id: string; url: string; type: 'photo' | 'video';
  uploaded_by: string; uploader_name: string; created_at: string;
}
interface CapsuleMember {
  id: string; capsule_id: string; user_id: string; display_name: string;
  is_paid: boolean; joined_at: string;
}
interface Friend { id: string; display_name: string | null; username: string | null; }

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg: '#0E0E12', surface: '#16161C', surfaceHigh: '#1E1E28', border: '#2A2A38',
  accent: '#C8A96E', accentSoft: 'rgba(200,169,110,0.15)', accentGlow: 'rgba(200,169,110,0.08)',
  locked: '#7B6EF6', lockedSoft: 'rgba(123,110,246,0.15)',
  public: '#5EBA8A', publicSoft: 'rgba(94,186,138,0.15)',
  danger: '#E05C5C', textPrimary: '#F0EDE8', textSecondary: '#8A8799',
  textMuted: '#4A4A5A', white: '#FFFFFF',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeUntil(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Unlocking…';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h left`;
  return `${hours}h ${Math.floor((diff % 3600000) / 60000)}m left`;
}

async function uploadToStorage(uri: string, path: string, mimeType: string): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const ext = mimeType.includes('video') ? 'mp4' : (uri.split('.').pop()?.split('?')[0] ?? 'jpg');
    const fd = new FormData();
    fd.append('file', { uri, name: `media.${ext}`, type: mimeType } as any);
    const res = await fetch(storageUploadUrl('canvas-images', path), {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'x-upsert': 'true' },
      body: fd,
    });
    if (!res.ok) { console.log('[Trips] upload failed:', await res.text()); return null; }
    return supabase.storage.from('canvas-images').getPublicUrl(path).data.publicUrl;
  } catch (e) { console.log('[Trips] upload error:', e); return null; }
}

// ─── Friend Invite Modal ──────────────────────────────────────────────────────
function FriendInviteModal({
  visible, capsule, userId, existingMemberIds, onClose, onAdded,
}: {
  visible: boolean; capsule: TravelCapsule; userId: string;
  existingMemberIds: Set<string>; onClose: () => void; onAdded: () => void;
}) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => { if (visible) loadFriends(); }, [visible]);

  const loadFriends = async () => {
    setLoading(true);
    try {
      const { data: rows } = await supabase
        .from('friends').select('requester_id, addressee_id')
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
        .eq('status', 'accepted');
      if (!rows?.length) { setFriends([]); setLoading(false); return; }
      const otherIds = rows.map((r: any) =>
        r.requester_id === userId ? r.addressee_id : r.requester_id
      );
      const { data: profiles } = await supabase.from('users')
        .select('id, display_name, username').in('id', otherIds);
      setFriends((profiles ?? []).filter((p: any) => !existingMemberIds.has(p.id)) as Friend[]);
    } catch (e) { console.log('[Trips] loadFriends error:', e); }
    setLoading(false);
  };

  const addFriend = async (friend: Friend) => {
    setAddingId(friend.id);
    try {
      const { data: existing } = await supabase
        .from('travel_capsule_members').select('id')
        .eq('capsule_id', capsule.id).eq('user_id', friend.id).maybeSingle();
      if (existing) {
        Alert.alert('Already a member', `${friend.display_name || '@' + friend.username} is already in this capsule.`);
        setAddingId(null); return;
      }
      const { error } = await supabase.from('travel_capsule_members').insert({
        capsule_id: capsule.id, user_id: friend.id, is_paid: false,
      });
      if (error) { console.error('[Trips] invite error:', JSON.stringify(error)); throw error; }
      Alert.alert('Added ✓', `${friend.display_name || '@' + friend.username} added to "${capsule.name}".`);
      onAdded(); onClose();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not add member.');
    }
    setAddingId(null);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.modalOverlay}>
        <View style={st.modalSheet}>
          <View style={st.modalHandle} />
          <Text style={st.modalTitle}>Invite to "{capsule.name}"</Text>
          <Text style={st.modalSub}>Choose a friend to add as a traveller</Text>
          {loading ? (
            <ActivityIndicator color={C.accent} style={{ marginVertical: 40 }} />
          ) : friends.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Text style={{ color: C.textSecondary, fontSize: 14, textAlign: 'center' }}>
                No friends to invite — all are already members, or you have no friends added yet.
              </Text>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {friends.map(f => (
                <View key={f.id} style={st.friendRow}>
                  <View style={st.friendAvatar}>
                    <Text style={st.friendAvatarText}>{(f.display_name || f.username || '?')[0].toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.friendName}>{f.display_name || f.username}</Text>
                    <Text style={st.friendUsername}>@{f.username}</Text>
                  </View>
                  <TouchableOpacity
                    style={[st.addFriendBtn, addingId === f.id && { opacity: 0.5 }]}
                    onPress={() => addFriend(f)} disabled={addingId === f.id}>
                    {addingId === f.id
                      ? <ActivityIndicator color={C.bg} size="small" />
                      : <Text style={st.addFriendBtnText}>Add</Text>}
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}
          <TouchableOpacity style={st.cancelBtn} onPress={onClose}>
            <Text style={st.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Media Viewer ─────────────────────────────────────────────────────────────
function MediaViewer({ media, initialIndex, visible, onClose }: {
  media: CapsuleMedia[]; initialIndex: number; visible: boolean; onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [downloading, setDownloading] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => { setIndex(initialIndex); }, [initialIndex, visible]);

  if (!visible || !media.length) return null;
  const item = media[index];
  if (!item) return null;

  const goPrev = () => { if (index > 0) { Haptics.selectionAsync(); setIndex(i => i - 1); } };
  const goNext = () => { if (index < media.length - 1) { Haptics.selectionAsync(); setIndex(i => i + 1); } };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow access to save to your photo library.'); return;
      }
      const ext = item.type === 'video' ? 'mp4' : 'jpg';
      const dest = (FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '') +
        `anchor_${item.id.slice(0, 8)}_${Date.now()}.${ext}`;
      const { uri } = await FileSystem.downloadAsync(item.url, dest);
      await MediaLibrary.saveToLibraryAsync(uri);
      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => { });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved!', 'Saved to your photo library.');
    } catch (e: any) {
      Alert.alert('Download failed', e.message);
    } finally { setDownloading(false); }
  };

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <View style={[mv.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={onClose} style={mv.headerBtn}>
            <Text style={mv.headerBtnText}>✕</Text>
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={mv.counter}>{index + 1} / {media.length}</Text>
            <Text style={mv.uploaderText} numberOfLines={1}>
              {item.uploader_name} · {formatDate(item.created_at)}
            </Text>
          </View>
          <TouchableOpacity onPress={handleDownload} style={mv.headerBtn} disabled={downloading}>
            {downloading
              ? <ActivityIndicator color={C.accent} size="small" />
              : <Text style={mv.downloadIcon}>⬇</Text>}
          </TouchableOpacity>
        </View>

        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {item.type === 'video' ? (
            <Video
              key={item.url} source={{ uri: item.url }}
              style={StyleSheet.absoluteFillObject}
              resizeMode={ResizeMode.CONTAIN}
              useNativeControls shouldPlay={false} isLooping={false}
              onError={(err) => {
                console.log('[Video] error:', err);
                Alert.alert('Playback error', 'Could not play this video.');
              }}
            />
          ) : (
            <ExpoImage
              source={{ uri: item.url }} style={StyleSheet.absoluteFillObject}
              contentFit="contain" cachePolicy="memory-disk" transition={200}
            />
          )}
        </View>

        <View style={mv.navRow}>
          <TouchableOpacity style={[mv.navBtn, index === 0 && { opacity: 0.2 }]} onPress={goPrev} disabled={index === 0}>
            <Text style={mv.navBtnText}>‹</Text>
          </TouchableOpacity>
          <View style={mv.typeBadge}>
            <Text style={mv.typeBadgeText}>{item.type === 'video' ? '🎬 Video' : '📷 Photo'}</Text>
          </View>
          <TouchableOpacity style={[mv.navBtn, index === media.length - 1 && { opacity: 0.2 }]} onPress={goNext} disabled={index === media.length - 1}>
            <Text style={mv.navBtnText}>›</Text>
          </TouchableOpacity>
        </View>

        {media.length > 1 && (
          <View style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={mv.thumbStrip}>
              {media.map((m, i) => (
                <TouchableOpacity key={m.id} onPress={() => { Haptics.selectionAsync(); setIndex(i); }}
                  style={[mv.thumb, i === index && mv.thumbActive]}>
                  <ExpoImage source={{ uri: m.url }} style={mv.thumbImg} contentFit="cover" cachePolicy="memory-disk" />
                  {m.type === 'video' && (
                    <View style={mv.thumbPlay}><Text style={{ color: '#fff', fontSize: 10 }}>▶</Text></View>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </View>
    </Modal>
  );
}

const mv = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.15)',
  },
  headerBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  downloadIcon: { color: C.accent, fontSize: 20, fontWeight: '700' },
  counter: { color: '#fff', fontSize: 14, fontWeight: '700' },
  uploaderText: { color: 'rgba(255,255,255,0.55)', fontSize: 11, marginTop: 2 },
  navRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10,
  },
  navBtn: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  navBtnText: { color: '#fff', fontSize: 36, fontWeight: '200', lineHeight: 44 },
  typeBadge: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8,
  },
  typeBadgeText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  thumbStrip: { paddingHorizontal: 16, gap: 6, paddingVertical: 8 },
  thumb: {
    width: 60, height: 60, borderRadius: 8, overflow: 'hidden',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)',
  },
  thumbActive: { borderColor: C.accent, borderWidth: 2.5 },
  thumbImg: { width: '100%', height: '100%' },
  thumbPlay: {
    ...StyleSheet.absoluteFillObject as any,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
});

// ─── CapsuleCard ──────────────────────────────────────────────────────────────
function CapsuleCard({ capsule, onPress, onLongPress }: {
  capsule: TravelCapsule; onPress: () => void; onLongPress: () => void;
}) {
  const isLocked = capsule.visibility === 'locked' && !capsule.is_unlocked;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const accentColor = isLocked ? C.locked : C.public;
  const handlePressIn = () =>
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, tension: 300, friction: 20 }).start();
  const handlePressOut = () =>
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 300, friction: 20 }).start();
  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        onPress={onPress} onLongPress={onLongPress}
        onPressIn={handlePressIn} onPressOut={handlePressOut}
        delayLongPress={300}
        activeOpacity={1}
        {...(Platform.OS === 'web' ? {
          onContextMenu: (e: any) => { e.preventDefault(); onLongPress(); }
        } : {})}
        style={[st.card, { borderColor: isLocked ? 'rgba(123,110,246,0.3)' : 'rgba(94,186,138,0.3)' }]}>
        <View style={[st.cardHeader, { backgroundColor: isLocked ? C.lockedSoft : C.publicSoft }]}>
          {capsule.cover_url
            ? <Image source={{ uri: capsule.cover_url }} style={st.cardCoverImg} />
            : <View style={st.cardCoverPlaceholder}>
              <Text style={st.cardCoverEmoji}>{isLocked ? '🔒' : '✈️'}</Text>
              <Text style={[st.cardDestinationLarge, { color: accentColor }]}>
                {capsule.destination || capsule.name}
              </Text>
            </View>}
          <View style={[st.visibilityBadge, { backgroundColor: accentColor }]}>
            <Text style={st.visibilityBadgeText}>{isLocked ? '🔒 LOCKED' : '📖 OPEN'}</Text>
          </View>
        </View>
        <View style={st.cardBody}>
          <Text style={st.cardName}>{capsule.name}</Text>
          {capsule.destination ? <Text style={st.cardDestination}>📍 {capsule.destination}</Text> : null}
          {isLocked && capsule.unlock_date && (
            <View style={st.countdownRow}>
              <Text style={[st.countdownText, { color: C.locked }]}>⏳ {timeUntil(capsule.unlock_date)}</Text>
            </View>
          )}
          {isLocked && !capsule.unlock_date && (
            <View style={st.countdownRow}>
              <Text style={[st.countdownText, { color: C.locked }]}>🔒 Manual unlock only</Text>
            </View>
          )}
          <View style={st.statsRow}>
            <View style={st.stat}>
              <Text style={st.statNum}>{capsule.media_count}</Text>
              <Text style={st.statLabel}>{isLocked ? 'waiting' : 'memories'}</Text>
            </View>
            <View style={st.statDivider} />
            <View style={st.stat}>
              <Text style={st.statNum}>{capsule.member_count}</Text>
              <Text style={st.statLabel}>travellers</Text>
            </View>
            <View style={st.statDivider} />
            <View style={st.stat}><Text style={st.statLabel}>{formatDate(capsule.created_at)}</Text></View>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Create Capsule Modal ─────────────────────────────────────────────────────
function CreateCapsuleModal({ visible, onClose, onCreated, canvasId, userId, isPaid }: {
  visible: boolean; onClose: () => void; onCreated: (c: TravelCapsule) => void;
  canvasId: string; userId: string; isPaid: boolean;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'locked' | 'public'>('public');
  const [unlockMode, setUnlockMode] = useState<'date' | 'manual' | 'both'>('both');
  const [unlockDate, setUnlockDate] = useState('');
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setStep(0); setName(''); setDestination(''); setDescription('');
    setVisibility('public'); setUnlockMode('both'); setUnlockDate('');
  };

  const handleCreate = async () => {
    if (!name.trim()) { Alert.alert('Name required'); return; }
    if (visibility === 'locked' && unlockMode !== 'manual' && !unlockDate.trim()) {
      Alert.alert('Unlock date required'); return;
    }
    setLoading(true);
    try {
      let parsedDate: string | null = null;
      if (visibility === 'locked' && unlockMode !== 'manual' && unlockDate) {
        const parts = unlockDate.split('/');
        if (parts.length === 3)
          parsedDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).toISOString();
      }

      // Use RPC to insert capsule + member atomically, avoiding the RLS
      // chicken-and-egg: SELECT policy (anchor_is_capsule_member) would block
      // the RETURNING clause before the member row exists.
      const { data: newId, error } = await supabase.rpc('create_travel_capsule', {
        p_name: name.trim(),
        p_canvas_id: canvasId || null,
        p_destination: destination.trim(),
        p_description: description.trim(),
        p_visibility: visibility,
        p_unlock_date: parsedDate,
      });
      if (error) throw error;

      // Member row now exists, so SELECT policy passes
      const { data, error: fetchErr } = await supabase
        .from('travel_capsules').select('*').eq('id', newId).single();
      if (fetchErr) throw fetchErr;

      if (parsedDate) scheduleUnlockReminder(name.trim(), new Date(parsedDate)).catch(() => { });
      onCreated({ ...data, media_count: 0, member_count: 1 });
      reset(); onClose();
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setLoading(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={st.modalContainer}>
          <View style={st.modalHeader}>
            <TouchableOpacity onPress={() => { reset(); onClose(); }}>
              <Text style={st.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={st.modalTitle}>New Travel Capsule</Text>
            <View style={{ width: 60 }} />
          </View>
          <View style={st.progressRow}>
            {[0, 1].map(i => <View key={i} style={[st.progressDot, step >= i && st.progressDotActive]} />)}
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
            {step === 0 && (
              <View>
                <Text style={st.stepTitle}>Trip Details</Text>
                <Text style={st.stepSubtitle}>Give your capsule a name and destination.</Text>
                <Text style={st.fieldLabel}>Capsule Name *</Text>
                <TextInput style={st.input} value={name} onChangeText={setName}
                  placeholder="e.g. Japan Spring 2025" placeholderTextColor={C.textMuted} />
                <Text style={st.fieldLabel}>Destination</Text>
                <TextInput style={st.input} value={destination} onChangeText={setDestination}
                  placeholder="e.g. Tokyo, Japan" placeholderTextColor={C.textMuted} />
                <Text style={st.fieldLabel}>Description</Text>
                <TextInput style={[st.input, { height: 90, textAlignVertical: 'top' }]}
                  value={description} onChangeText={setDescription}
                  placeholder="What's this trip about?" placeholderTextColor={C.textMuted} multiline />
                <TouchableOpacity style={[st.primaryBtn, !name.trim() && { opacity: 0.4 }]}
                  onPress={() => setStep(1)} disabled={!name.trim()}>
                  <Text style={st.primaryBtnText}>Next →</Text>
                </TouchableOpacity>
              </View>
            )}
            {step === 1 && (
              <View>
                <Text style={st.stepTitle}>Visibility</Text>
                <Text style={st.stepSubtitle}>How should memories be shared?</Text>
                <TouchableOpacity style={[st.visibilityOption, visibility === 'public' && st.visibilityOptionActive]}
                  onPress={() => setVisibility('public')}>
                  <View style={st.visibilityIconBox}><Text style={{ fontSize: 28 }}>📖</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.visibilityOptionTitle}>Always Open</Text>
                    <Text style={st.visibilityOptionDesc}>Photos visible as they're uploaded.</Text>
                  </View>
                  <View style={[st.radioOuter, visibility === 'public' && st.radioOuterActive]}>
                    {visibility === 'public' && <View style={st.radioInner} />}
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={[st.visibilityOption, visibility === 'locked' && st.visibilityOptionActiveLocked]}
                  onPress={() => setVisibility('locked')}>
                  <View style={st.visibilityIconBox}><Text style={{ fontSize: 28 }}>🔒</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.visibilityOptionTitle}>Hidden Until Unlocked</Text>
                    <Text style={st.visibilityOptionDesc}>Everyone uploads, nothing revealed until you unlock.</Text>
                  </View>
                  <View style={[st.radioOuter, visibility === 'locked' && st.radioOuterActiveLocked]}>
                    {visibility === 'locked' && <View style={[st.radioInner, { backgroundColor: C.locked }]} />}
                  </View>
                </TouchableOpacity>
                {visibility === 'locked' && (
                  <View style={st.unlockSettings}>
                    <Text style={st.fieldLabel}>Unlock Condition</Text>
                    <View style={st.segmentRow}>
                      {(['date', 'manual', 'both'] as const).map(m => (
                        <TouchableOpacity key={m} style={[st.segment, unlockMode === m && st.segmentActive]}
                          onPress={() => setUnlockMode(m)}>
                          <Text style={[st.segmentText, unlockMode === m && st.segmentTextActive]}>
                            {m === 'date' ? '📅 Date' : m === 'manual' ? '👆 Manual' : '🔀 Both'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {unlockMode !== 'manual' && (
                      <>
                        <Text style={st.fieldLabel}>Unlock Date (DD/MM/YYYY)</Text>
                        <TextInput style={st.input} value={unlockDate} onChangeText={setUnlockDate}
                          placeholder="31/12/2025" placeholderTextColor={C.textMuted}
                          keyboardType="numbers-and-punctuation" />
                      </>
                    )}
                    {unlockMode === 'manual' && (
                      <View style={st.infoBox}>
                        <Text style={st.infoText}>Only you can manually unlock from within the capsule.</Text>
                      </View>
                    )}
                  </View>
                )}
                <View style={[st.infoBox, { marginTop: 16 }]}>
                  <Text style={st.infoText}>
                    📸 Each member: up to {isPaid ? PAID_MEDIA_LIMIT : FREE_MEDIA_LIMIT} photos/videos.
                    {!isPaid ? ' Upgrade for more.' : ''}
                  </Text>
                </View>
                <View style={st.btnRow}>
                  <TouchableOpacity style={st.secondaryBtn} onPress={() => setStep(0)}>
                    <Text style={st.secondaryBtnText}>← Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[st.primaryBtn, { flex: 1, marginLeft: 12 }]}
                    onPress={handleCreate} disabled={loading}>
                    {loading
                      ? <ActivityIndicator color={C.bg} />
                      : <Text style={st.primaryBtnText}>Create Capsule ✈️</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Capsule Detail Screen ────────────────────────────────────────────────────
function CapsuleDetailScreen({ capsule: initialCapsule, userId, isPaid, onBack, onUpdated }: {
  capsule: TravelCapsule; userId: string; isPaid: boolean;
  onBack: () => void; onUpdated: (c: TravelCapsule) => void;
}) {
  const [capsule, setCapsule] = useState(initialCapsule);
  const [media, setMedia] = useState<CapsuleMedia[]>([]);
  const [members, setMembers] = useState<CapsuleMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [displayName, setDisplayName] = useState('Someone');
  const [unlockCelebration, setUnlockCelebration] = useState<{ name: string; mediaUrls: string[] } | null>(null);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const isOwner = capsule.created_by === userId;
  const isLocked = capsule.visibility === 'locked' && !capsule.is_unlocked;
  const myMediaCount = media.filter(m => m.uploaded_by === userId).length;
  const mediaLimit = isPaid ? PAID_MEDIA_LIMIT : FREE_MEDIA_LIMIT;
  const accentColor = isLocked ? C.locked : C.public;
  const accentSoft = isLocked ? C.lockedSoft : C.publicSoft;
  const memberIdSet = new Set(members.map(m => m.user_id));

  // Stable ref so realtime/polling callbacks always call the latest loadData
  const loadDataRef = useRef<((isRefresh?: boolean) => Promise<void>) | undefined>(undefined)

  const loadData = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const { data: userProf } = await supabase.from('users')
        .select('display_name').eq('id', userId).maybeSingle();
      if (userProf?.display_name) setDisplayName(userProf.display_name);

      const { data: mediaData } = await supabase.from('travel_capsule_media')
        .select('id, capsule_id, url, type, uploaded_by, created_at')
        .eq('capsule_id', capsule.id).order('created_at', { ascending: false });

      if (mediaData?.length) {
        const ids = [...new Set(mediaData.map((m: any) => m.uploaded_by))];
        const { data: profiles } = await supabase.from('users').select('id, display_name').in('id', ids);
        const nameMap: Record<string, string> = {};
        (profiles ?? []).forEach((p: any) => { nameMap[p.id] = p.display_name; });
        setMedia(mediaData.map((m: any) => ({ ...m, uploader_name: nameMap[m.uploaded_by] ?? 'Unknown' })));
      } else { setMedia([]); }

      const { data: memberData } = await supabase.from('travel_capsule_members')
        .select('id, capsule_id, user_id, is_paid, joined_at').eq('capsule_id', capsule.id);
      if (memberData?.length) {
        const ids = memberData.map((m: any) => m.user_id);
        const { data: profiles } = await supabase.from('users').select('id, display_name').in('id', ids);
        const nameMap: Record<string, string> = {};
        (profiles ?? []).forEach((p: any) => { nameMap[p.id] = p.display_name; });
        setMembers(memberData.map((m: any) => ({ ...m, display_name: nameMap[m.user_id] ?? 'Unknown' })));
      } else { setMembers([]); }

      // Re-fetch the capsule itself so unlock state is always fresh
      const { data: freshCapsule } = await supabase.from('travel_capsules')
        .select('*').eq('id', capsule.id).single();
      if (freshCapsule) {
        const updated = { ...freshCapsule, media_count: mediaData?.length ?? 0, member_count: memberData?.length ?? 0 } as TravelCapsule;
        setCapsule(updated);
        onUpdated(updated);
      }
    } catch (e) { console.log('[Trips] loadData error:', e); }
    finally { setLoading(false); }
  }, [capsule.id, userId]);

  // Keep ref current
  useEffect(() => { loadDataRef.current = loadData; }, [loadData]);

  // Initial load + auto-unlock check
  useEffect(() => {
    loadData();
    if (capsule.visibility === 'locked' && !capsule.is_unlocked && capsule.unlock_date &&
      new Date(capsule.unlock_date) <= new Date()) {
      handleAutoUnlock();
    }
  }, []);

  // ── Realtime subscription for the detail screen ──────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`capsule-detail-${capsule.id}`)
      // Capsule row updated (unlocked remotely, cover changed, etc.)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public',
        table: 'travel_capsules',
        filter: `id=eq.${capsule.id}`,
      }, (payload) => {
        const updated = { ...capsule, ...payload.new } as TravelCapsule;
        setCapsule(updated);
        onUpdated(updated);
      })
      // New media uploaded by any member
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public',
        table: 'travel_capsule_media',
        filter: `capsule_id=eq.${capsule.id}`,
      }, () => {
        loadDataRef.current?.();
      })
      // New member joined
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public',
        table: 'travel_capsule_members',
        filter: `capsule_id=eq.${capsule.id}`,
      }, () => {
        loadDataRef.current?.();
      })
      .subscribe();

    // 30s polling fallback in case realtime drops
    const poll = setInterval(() => { loadDataRef.current?.(true as any); }, POLL_INTERVAL_MS);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [capsule.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  };

  const handleAutoUnlock = async () => {
    const { data } = await supabase.from('travel_capsules')
      .update({ is_unlocked: true }).eq('id', capsule.id).select().single();
    if (data) {
      const updated = { ...capsule, is_unlocked: true };
      setCapsule(updated); onUpdated(updated);
      notifyMembers({
        type: 'capsule_unlock', capsule_id: capsule.id, actor_id: userId,
        actor_name: displayName, title: 'Capsule unlocked 🔓',
        body: `"${capsule.name}" is now open!`,
      }).catch(() => { });
      setUnlockCelebration({ name: capsule.name, mediaUrls: media.slice(0, 5).map(m => m.url) });
    }
  };

  const handleManualUnlock = () => {
    Alert.alert('Unlock Capsule?', 'Everyone will see all memories immediately. Cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlock 🔓', style: 'destructive', onPress: async () => {
          const { data } = await supabase.from('travel_capsules')
            .update({ is_unlocked: true }).eq('id', capsule.id).select().single();
          if (data) {
            const updated = { ...data, media_count: media.length, member_count: members.length } as TravelCapsule;
            setCapsule(updated); onUpdated(updated);
          }
          notifyMembers({
            type: 'capsule_unlock', capsule_id: capsule.id, actor_id: userId,
            actor_name: displayName, title: 'Capsule unlocked 🔓',
            body: `"${capsule.name}" is now open!`,
          }).catch(() => { });
          setUnlockCelebration({ name: capsule.name, mediaUrls: media.slice(0, 5).map(m => m.url) });
        },
      },
    ]);
  };

  const handleUpload = async () => {
    if (myMediaCount >= mediaLimit) {
      Alert.alert('Upload limit reached', `Max ${mediaLimit} uploads per member.`); return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo library access to upload.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All, allowsMultipleSelection: true,
      selectionLimit: Math.min(10, mediaLimit - myMediaCount), quality: 0.85,
    });
    if (result.canceled || !result.assets.length) return;
    setUploading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    let successCount = 0;
    for (const asset of result.assets) {
      try {
        const isVideo = asset.type === 'video';
        const mimeType = isVideo ? 'video/mp4' : 'image/jpeg';
        const ext = isVideo ? 'mp4' : (asset.uri.split('.').pop()?.split('?')[0] ?? 'jpg');
        const path = `travel/${capsule.id}/${userId}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const url = await uploadToStorage(asset.uri, path, mimeType);
        if (!url) continue;
        const { error } = await supabase.from('travel_capsule_media').insert({
          capsule_id: capsule.id, url, type: isVideo ? 'video' : 'photo', uploaded_by: userId,
        });
        if (!error) successCount++;
      } catch (e) { console.log('[Trips] upload loop error:', e); }
    }
    setUploading(false);
    if (successCount > 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await loadData(true);
      notifyMembers({
        type: 'capsule_media', capsule_id: capsule.id, actor_id: userId,
        actor_name: displayName, title: 'New memory added 📸',
        body: `${displayName} added ${successCount} ${successCount === 1 ? 'memory' : 'memories'} to "${capsule.name}"`,
      }).catch(() => { });
    }
  };

  // Current isLocked state derived from latest capsule state
  const currentlyLocked = capsule.visibility === 'locked' && !capsule.is_unlocked;

  return (
    <View style={st.detailContainer}>
      {unlockCelebration && (
        <UnlockCelebration visible capsuleName={unlockCelebration.name}
          mediaUrls={unlockCelebration.mediaUrls ?? []}
          onDismiss={() => { setUnlockCelebration(null); loadData(true); }} />
      )}
      <MediaViewer media={media} initialIndex={viewerIndex} visible={viewerVisible}
        onClose={() => setViewerVisible(false)} />
      <FriendInviteModal visible={showInvite} capsule={capsule} userId={userId}
        existingMemberIds={memberIdSet} onClose={() => setShowInvite(false)} onAdded={() => loadData(true)} />

      {/* Header */}
      <View style={st.detailHeader}>
        <TouchableOpacity onPress={onBack} style={st.backBtn}>
          <Text style={st.backBtnText}>‹ Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={st.detailTitle} numberOfLines={1}>{capsule.name}</Text>
          {capsule.destination ? <Text style={st.detailSubtitle}>📍 {capsule.destination}</Text> : null}
        </View>
        <TouchableOpacity onPress={() => setShowMembers(true)} style={st.membersBtn}>
          <Text style={st.membersBtnText}>👥 {members.length}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setChatOpen(true)} style={[st.membersBtn, { marginLeft: 8 }]}>
          <Text style={st.membersBtnText}>💬</Text>
        </TouchableOpacity>
      </View>

      {/* Status banner — always reflects live capsule state */}
      <View style={[st.statusBanner, {
        backgroundColor: currentlyLocked ? C.lockedSoft : C.publicSoft,
        borderColor: (currentlyLocked ? C.locked : C.public) + '40',
      }]}>
        <Text style={[st.statusBannerText, { color: currentlyLocked ? C.locked : C.public }]}>
          {currentlyLocked
            ? capsule.unlock_date
              ? `🔒 Locked · ${timeUntil(capsule.unlock_date)}`
              : '🔒 Locked · Manual only'
            : '📖 Open · Everyone can see memories'}
        </Text>
        {currentlyLocked && isOwner && (
          <TouchableOpacity onPress={handleManualUnlock}>
            <Text style={[st.unlockNowText, { color: C.locked }]}>Unlock now</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Upload bar */}
      <View style={st.uploadBar}>
        <View style={{ flex: 1 }}>
          <Text style={st.uploadBarLabel}>Your uploads: {myMediaCount} / {mediaLimit}</Text>
          <View style={st.uploadProgressTrack}>
            <View style={[st.uploadProgressFill, {
              width: `${Math.min(100, (myMediaCount / mediaLimit) * 100)}%` as any,
              backgroundColor: currentlyLocked ? C.locked : C.public,
            }]} />
          </View>
        </View>
        <TouchableOpacity
          style={[st.uploadBtn, { backgroundColor: currentlyLocked ? C.locked : C.public },
          (uploading || myMediaCount >= mediaLimit) && { opacity: 0.5 }]}
          onPress={handleUpload} disabled={uploading || myMediaCount >= mediaLimit}>
          {uploading
            ? <ActivityIndicator color={C.bg} size="small" />
            : <Text style={st.uploadBtnText}>+ Add</Text>}
        </TouchableOpacity>
        {isOwner && (
          <TouchableOpacity style={st.inviteBtn} onPress={() => setShowInvite(true)}>
            <Text style={st.inviteBtnText}>Invite</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Content */}
      {loading ? (
        <View style={st.loadingCenter}><ActivityIndicator color={C.accent} size="large" /></View>
      ) : currentlyLocked ? (
        <ScrollView
          contentContainerStyle={st.lockedCenter}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.locked} />}>
          <Text style={st.lockedEmoji}>🔒</Text>
          <Text style={st.lockedCount}>{media.length}</Text>
          <Text style={st.lockedCountLabel}>{media.length === 1 ? 'memory' : 'memories'} waiting</Text>
          {capsule.unlock_date && <Text style={st.lockedSubtext}>Unlocks on {formatDate(capsule.unlock_date)}</Text>}
          <Text style={st.lockedSubtext}>Keep adding — all revealed together when unlocked.</Text>
          <View style={st.myUploadNote}>
            <Text style={st.myUploadNoteText}>You've added {myMediaCount} {myMediaCount === 1 ? 'memory' : 'memories'}</Text>
          </View>
          <TouchableOpacity
            style={[st.uploadBtn, { backgroundColor: C.locked, marginTop: 24, paddingHorizontal: 28, paddingVertical: 13 }]}
            onPress={handleUpload} disabled={uploading}>
            <Text style={st.uploadBtnText}>{uploading ? 'Uploading…' : '+ Add Memory'}</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : media.length === 0 ? (
        <ScrollView
          contentContainerStyle={st.emptyCenter}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}>
          <Text style={{ fontSize: 52 }}>📷</Text>
          <Text style={st.emptyText}>No memories yet</Text>
          <Text style={st.emptySubtext}>Be the first to add a photo or video!</Text>
          <TouchableOpacity
            style={[st.uploadBtn, { backgroundColor: C.public, marginTop: 24, paddingHorizontal: 28, paddingVertical: 13 }]}
            onPress={handleUpload} disabled={uploading}>
            <Text style={st.uploadBtnText}>+ Add First Memory</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <FlatList
          data={media} keyExtractor={m => m.id} numColumns={3}
          contentContainerStyle={{ padding: 2 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
          renderItem={({ item, index }) => (
            <TouchableOpacity style={st.gridItem}
              onPress={() => { setViewerIndex(index); setViewerVisible(true); }} activeOpacity={0.82}>
              <ExpoImage
                source={{ uri: item.url }} style={st.gridImage}
                contentFit="cover" cachePolicy="memory-disk" transition={150}
              />
              {item.type === 'video' && (
                <View style={st.videoOverlay}>
                  <View style={st.videoPlayBtn}>
                    <Text style={{ color: '#fff', fontSize: 16 }}>▶</Text>
                  </View>
                </View>
              )}
            </TouchableOpacity>
          )}
        />
      )}

      {/* Members modal */}
      <Modal visible={showMembers} animationType="slide" presentationStyle="formSheet"
        onRequestClose={() => setShowMembers(false)}>
        <View style={st.modalContainer}>
          <View style={st.modalHeader}>
            <TouchableOpacity onPress={() => setShowMembers(false)}>
              <Text style={st.modalCancel}>Done</Text>
            </TouchableOpacity>
            <Text style={st.modalTitle}>Travellers ({members.length})</Text>
            {isOwner
              ? <TouchableOpacity onPress={() => { setShowMembers(false); setShowInvite(true); }}>
                <Text style={[st.modalCancel, { color: C.accent }]}>+ Invite</Text>
              </TouchableOpacity>
              : <View style={{ width: 60 }} />}
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <View style={st.infoBox}>
              <Text style={st.infoText}>
                {isPaid
                  ? `Paid plan: up to ${PAID_MEMBER_LIMIT} members.`
                  : `Free plan: up to ${FREE_MEMBER_LIMIT} invited members.`}
              </Text>
            </View>
            {members.map(m => (
              <View key={m.id} style={st.memberRow}>
                <View style={st.memberAvatar}>
                  <Text style={{ color: C.textPrimary, fontWeight: '700' }}>
                    {m.display_name?.[0]?.toUpperCase() ?? '?'}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.memberName}>{m.display_name}</Text>
                  <Text style={st.memberJoined}>Joined {formatDate(m.joined_at)}</Text>
                </View>
                {m.user_id === capsule.created_by && (
                  <View style={st.ownerBadge}><Text style={st.ownerBadgeText}>Owner</Text></View>
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>

      <ProjectChat visible={chatOpen} onClose={() => setChatOpen(false)}
        projectType="capsule" projectId={capsule.id} currentUserId={userId} />
    </View>
  );
}

// ─── Main Trips Screen ────────────────────────────────────────────────────────
export default function TripsScreen() {
  const [capsules, setCapsules] = useState<TravelCapsule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState('');
  const [canvasId, setCanvasId] = useState('');
  const { isPlus: isPaid } = useAnchorPlus();
  const [showCreate, setShowCreate] = useState(false);
  const [activeCapsule, setActiveCapsule] = useState<TravelCapsule | null>(null);
  const { prompt: biometricPrompt } = useBiometricSetting();
  const headerAnim = useRef(new Animated.Value(0)).current;

  // Stable refs — prevent realtime/polling callbacks from going stale
  const userIdRef = useRef('');
  const loadCapsulesRef = useRef<((uid: string, isRefresh?: boolean) => Promise<void>) | undefined>(undefined)

  // ── Load capsules ─────────────────────────────────────────────────────
  const loadCapsules = useCallback(async (uId: string, isRefresh = false) => {
    // Only show the full-screen spinner on the very first load.
    // Pull-to-refresh and polling use setRefreshing instead.
    if (!isRefresh) setLoading(true);
    try {
      const { data: memberships } = await supabase
        .from('travel_capsule_members').select('capsule_id').eq('user_id', uId);
      const ids = (memberships ?? []).map((m: any) => m.capsule_id);
      if (!ids.length) { setCapsules([]); return; }

      const { data, error } = await supabase
        .from('travel_capsules').select('*').in('id', ids)
        .order('created_at', { ascending: false });
      if (error || !data) return;

      const enriched = await Promise.all(data.map(async (c: any) => {
        const [{ count: mCount }, { count: memCount }] = await Promise.all([
          supabase.from('travel_capsule_media').select('*', { count: 'exact', head: true }).eq('capsule_id', c.id),
          supabase.from('travel_capsule_members').select('*', { count: 'exact', head: true }).eq('capsule_id', c.id),
        ]);
        let is_unlocked = c.is_unlocked;
        if (c.visibility === 'locked' && !is_unlocked && c.unlock_date && new Date(c.unlock_date) <= new Date()) {
          is_unlocked = true;
          await supabase.from('travel_capsules').update({ is_unlocked: true }).eq('id', c.id);
        }
        return { ...c, is_unlocked, media_count: mCount ?? 0, member_count: memCount ?? 0 };
      }));
      setCapsules(enriched);
    } catch (e) {
      console.log('[Trips] loadCapsules error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Keep ref current every render
  useEffect(() => { loadCapsulesRef.current = loadCapsules; }, [loadCapsules]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // ── Init ─────────────────────────────────────────────────────────────
  const initUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      userIdRef.current = user.id;

      const { data: canvas } = await supabase
        .from('canvases').select('id')
        .or(`owner_id.eq.${user.id},partner_id.eq.${user.id}`)
        .limit(1).maybeSingle();

      if (canvas?.id) {
        setCanvasId(canvas.id);
      } else {
        supabase.from('canvases').insert({
          name: 'My Space', owner_id: user.id,
          background_type: 'color', background_value: '#1A1118', theme: 'none',
        }).select('id').single().then(({ data: nc }) => {
          if (nc?.id) setCanvasId(nc.id);
        });
      }

      await loadCapsules(user.id);
    } catch (e) {
      console.log('[Trips] init error:', e);
      setLoading(false);
    }
  };

  useEffect(() => {
    initUser();
    Animated.timing(headerAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, []);

  // ── Single realtime channel + 30s polling fallback ────────────────────
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`trips-realtime-${userId}`)
      // Membership added/removed → reload list
      .on('postgres_changes', {
        event: '*', schema: 'public',
        table: 'travel_capsule_members',
        filter: `user_id=eq.${userId}`,
      }, () => loadCapsulesRef.current?.(userIdRef.current, true))
      // Capsule updated (unlocked, etc.) → patch in place
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public',
        table: 'travel_capsules',
      }, (payload) => {
        setCapsules(prev =>
          prev.map(c => c.id === payload.new.id ? { ...c, ...payload.new } : c)
        );
        // Keep active capsule in sync too
        setActiveCapsule(prev =>
          prev?.id === payload.new.id ? { ...prev, ...(payload.new as TravelCapsule) } : prev
        );
      })
      // New media → bump count on list card
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public',
        table: 'travel_capsule_media',
      }, (payload) => {
        setCapsules(prev =>
          prev.map(c =>
            c.id === payload.new.capsule_id
              ? { ...c, media_count: c.media_count + 1 } : c
          )
        );
      })
      .subscribe();

    // Polling fallback — fires even when realtime WebSocket drops
    const poll = setInterval(
      () => loadCapsulesRef.current?.(userIdRef.current, true),
      POLL_INTERVAL_MS
    );

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [userId]);

  // ── Pull-to-refresh ───────────────────────────────────────────────────
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadCapsules(userId, true);
    setRefreshing(false);
  }, [userId, loadCapsules]);

  // ── Delete ────────────────────────────────────────────────────────────
  const handleDelete = (capsule: TravelCapsule) => {
    if (capsule.created_by !== userId) {
      Alert.alert('Cannot delete', 'Only the creator can delete this capsule.'); return;
    }
    Alert.alert('Delete Capsule?', `"${capsule.name}" will be permanently deleted.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('travel_capsules').delete().eq('id', capsule.id);
          setCapsules(prev => prev.filter(c => c.id !== capsule.id));
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        },
      },
    ]);
  };

  // ── Detail view ───────────────────────────────────────────────────────
  if (activeCapsule) {
    return (
      <CapsuleDetailScreen
        capsule={activeCapsule}
        userId={userId}
        isPaid={isPaid}
        onBack={() => setActiveCapsule(null)}
        onUpdated={(u) => {
          setCapsules(prev => prev.map(c => c.id === u.id ? u : c));
          setActiveCapsule(u);
        }}
      />
    );
  }

  // ── List view ─────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={st.root} edges={['top']}>
      <Animated.View style={[st.heroHeader, {
        opacity: headerAnim,
        transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }],
      }]}>
        <View>
          <Text style={st.heroTitle}>Travel</Text>
          <Text style={st.heroSubtitle}>Shared memory capsules for your trips</Text>
        </View>
        <TouchableOpacity
          style={[st.newCapsuleBtn, !isPaid && st.newCapsuleBtnDisabled]}
          onPress={() => {
            if (!isPaid) {
              Alert.alert('Anchor Plus Feature', 'Travel capsules require Anchor Plus.', [
                { text: 'Maybe later' },
                { text: 'Learn more', onPress: () => router.push('/plus' as any) },
              ]); return;
            }
            setShowCreate(true);
          }}>
          <Text style={st.newCapsuleBtnText}>+ New</Text>
        </TouchableOpacity>
      </Animated.View>

      {!isPaid && (
        <View style={st.limitBar}>
          <Text style={st.limitBarText}>✈️ Travel capsules are an Anchor Plus feature</Text>
        </View>
      )}

      {loading ? (
        <View style={st.loadingCenter}>
          <ActivityIndicator color={C.accent} size="large" />
        </View>
      ) : capsules.length === 0 ? (
        <ScrollView
          contentContainerStyle={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}>
          <View style={st.emptyState}>
            <Text style={st.emptyStateEmoji}>✈️</Text>
            <Text style={st.emptyStateTitle}>
              {isPaid ? 'No travel capsules yet' : 'Travel Capsules'}
            </Text>
            <Text style={st.emptyStateDesc}>
              {isPaid
                ? 'Create a capsule for your next trip and invite friends.'
                : 'Time-locked capsules for your trips. Available with Anchor Plus.'}
            </Text>
            <TouchableOpacity
              style={st.emptyStateBtn}
              onPress={() => {
                if (!isPaid) { router.push('/plus' as any); return; }
                setShowCreate(true);
              }}>
              <Text style={st.emptyStateBtnText}>
                {isPaid ? 'Create Your First Capsule' : 'Unlock with Anchor Plus ✦'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}>
          {capsules.map(c => (
            <CapsuleCard
              key={c.id}
              capsule={c}
              onPress={async () => {
                const ok = await biometricPrompt();
                if (ok) setActiveCapsule(c);
              }}
              onLongPress={() => handleDelete(c)}
            />
          ))}
          {!isPaid && (
            <TouchableOpacity style={st.ghostCard} onPress={() => router.push('/plus' as any)}>
              <Text style={st.ghostCardEmoji}>✈️</Text>
              <Text style={st.ghostCardTitle}>Unlimited Capsules</Text>
              <Text style={st.ghostCardSub}>Upgrade to Anchor Plus</Text>
              <View style={st.ghostLockBadge}>
                <Text style={st.ghostLockText}>🔒 Plus</Text>
              </View>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      <CreateCapsuleModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(c) => setCapsules(prev => [c, ...prev])}
        canvasId={canvasId}
        userId={userId}
        isPaid={isPaid}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  heroHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16,
  },
  heroTitle: {
    fontSize: 34, fontWeight: '800', color: C.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', letterSpacing: -0.5,
  },
  heroSubtitle: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  newCapsuleBtn: { backgroundColor: C.accent, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 9 },
  newCapsuleBtnDisabled: { backgroundColor: C.surfaceHigh },
  newCapsuleBtnText: { color: C.bg, fontWeight: '700', fontSize: 14 },
  limitBar: {
    backgroundColor: C.accentGlow, borderBottomWidth: 1,
    borderColor: C.border, paddingHorizontal: 20, paddingVertical: 8,
  },
  limitBarText: { color: C.textSecondary, fontSize: 12 },
  card: {
    backgroundColor: C.surface, borderRadius: 16,
    marginBottom: 16, borderWidth: 1, overflow: 'hidden',
  },
  cardHeader: { height: 120, overflow: 'hidden' },
  cardCoverImg: { width: '100%', height: '100%' },
  cardCoverPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cardCoverEmoji: { fontSize: 32, marginBottom: 4 },
  cardDestinationLarge: { fontSize: 15, fontWeight: '700' },
  visibilityBadge: {
    position: 'absolute', top: 10, right: 10,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
  },
  visibilityBadgeText: { color: C.white, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  cardBody: { padding: 14 },
  cardName: { fontSize: 17, fontWeight: '700', color: C.textPrimary, marginBottom: 2 },
  cardDestination: { fontSize: 13, color: C.textSecondary, marginBottom: 8 },
  countdownRow: { marginBottom: 8 },
  countdownText: { fontSize: 13, fontWeight: '600' },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  stat: { alignItems: 'center' },
  statNum: { fontSize: 15, fontWeight: '700', color: C.textPrimary },
  statLabel: { fontSize: 11, color: C.textSecondary, marginTop: 1 },
  statDivider: { width: 1, height: 24, backgroundColor: C.border, marginHorizontal: 12 },
  ghostCard: {
    backgroundColor: C.surfaceHigh, borderRadius: 16, borderWidth: 1,
    borderColor: C.border, borderStyle: 'dashed', padding: 24,
    alignItems: 'center', marginBottom: 16, position: 'relative',
  },
  ghostCardEmoji: { fontSize: 32, opacity: 0.3, marginBottom: 8 },
  ghostCardTitle: { fontSize: 16, fontWeight: '700', color: C.textMuted },
  ghostCardSub: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  ghostLockBadge: {
    position: 'absolute', top: 12, right: 12,
    backgroundColor: C.surfaceHigh, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: C.border,
  },
  ghostLockText: { color: C.textMuted, fontSize: 11, fontWeight: '600' },
  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 40, paddingBottom: 60,
  },
  emptyStateEmoji: { fontSize: 64, marginBottom: 16 },
  emptyStateTitle: {
    fontSize: 22, fontWeight: '800', color: C.textPrimary,
    textAlign: 'center', marginBottom: 10,
  },
  emptyStateDesc: {
    fontSize: 15, color: C.textSecondary, textAlign: 'center',
    lineHeight: 22, marginBottom: 28,
  },
  emptyStateBtn: { backgroundColor: C.accent, borderRadius: 24, paddingHorizontal: 28, paddingVertical: 14 },
  emptyStateBtnText: { color: C.bg, fontWeight: '700', fontSize: 15 },
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: { fontSize: 18, fontWeight: '700', color: C.textPrimary, marginTop: 12 },
  emptySubtext: { fontSize: 14, color: C.textSecondary, textAlign: 'center', marginTop: 6 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 44, borderTopWidth: 1, borderColor: C.border, maxHeight: '75%',
  },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.textPrimary, marginBottom: 4 },
  modalSub: { fontSize: 13, color: C.textSecondary, marginBottom: 20 },
  modalContainer: { flex: 1, backgroundColor: C.bg },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 20, borderBottomWidth: 1, borderColor: C.border,
  },
  modalCancel: { fontSize: 16, color: C.textSecondary },
  friendRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border,
  },
  friendAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center',
  },
  friendAvatarText: { color: C.accent, fontSize: 16, fontWeight: '800' },
  friendName: { flex: 1, color: C.textPrimary, fontSize: 15, fontWeight: '600' },
  friendUsername: { color: C.textSecondary, fontSize: 12, marginTop: 1 },
  addFriendBtn: { backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  addFriendBtnText: { color: C.bg, fontWeight: '700', fontSize: 13 },
  cancelBtn: {
    marginTop: 16, backgroundColor: C.surfaceHigh, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: C.border,
  },
  cancelBtnText: { color: C.textPrimary, fontSize: 15 },
  progressRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 16 },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.border },
  progressDotActive: { backgroundColor: C.accent, width: 24 },
  stepTitle: {
    fontSize: 24, fontWeight: '800', color: C.textPrimary, marginBottom: 6,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
  },
  stepSubtitle: { fontSize: 14, color: C.textSecondary, marginBottom: 24, lineHeight: 20 },
  fieldLabel: { fontSize: 13, color: C.textSecondary, marginBottom: 6, fontWeight: '600', marginTop: 16 },
  input: {
    backgroundColor: C.surfaceHigh, borderRadius: 12, borderWidth: 1,
    borderColor: C.border, paddingHorizontal: 14, paddingVertical: 12,
    color: C.textPrimary, fontSize: 15,
  },
  visibilityOption: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.surfaceHigh,
    borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1.5, borderColor: C.border, gap: 12,
  },
  visibilityOptionActive: { borderColor: C.public, backgroundColor: C.publicSoft },
  visibilityOptionActiveLocked: { borderColor: C.locked, backgroundColor: C.lockedSoft },
  visibilityIconBox: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  visibilityOptionTitle: { fontSize: 16, fontWeight: '700', color: C.textPrimary, marginBottom: 3 },
  visibilityOptionDesc: { fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  radioOuter: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  radioOuterActive: { borderColor: C.public },
  radioOuterActiveLocked: { borderColor: C.locked },
  radioInner: { width: 11, height: 11, borderRadius: 6, backgroundColor: C.public },
  unlockSettings: {
    marginTop: 4, padding: 16, backgroundColor: C.surface,
    borderRadius: 14, borderWidth: 1, borderColor: C.border,
  },
  segmentRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  segment: {
    flex: 1, backgroundColor: C.surfaceHigh, borderRadius: 10,
    paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: C.border,
  },
  segmentActive: { backgroundColor: C.lockedSoft, borderColor: C.locked },
  segmentText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: C.locked },
  infoBox: {
    backgroundColor: C.surfaceHigh, borderRadius: 10,
    padding: 12, borderWidth: 1, borderColor: C.border,
  },
  infoText: { fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  primaryBtn: {
    backgroundColor: C.accent, borderRadius: 14,
    paddingVertical: 15, alignItems: 'center', marginTop: 24,
  },
  primaryBtnText: { color: C.bg, fontWeight: '800', fontSize: 16 },
  secondaryBtn: {
    backgroundColor: C.surfaceHigh, borderRadius: 14, paddingVertical: 15,
    paddingHorizontal: 20, alignItems: 'center', borderWidth: 1, borderColor: C.border,
  },
  secondaryBtnText: { color: C.textSecondary, fontWeight: '700', fontSize: 16 },
  btnRow: { flexDirection: 'row', marginTop: 24, alignItems: 'center' },
  detailContainer: { flex: 1, backgroundColor: C.bg },
  detailHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12,
    borderBottomWidth: 1, borderColor: C.border,
  },
  backBtn: { paddingRight: 12 },
  backBtnText: { fontSize: 17, color: C.accent },
  detailTitle: { fontSize: 17, fontWeight: '700', color: C.textPrimary },
  detailSubtitle: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  membersBtn: {
    backgroundColor: C.surfaceHigh, borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: C.border,
  },
  membersBtnText: { color: C.textSecondary, fontSize: 13, fontWeight: '600' },
  statusBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1,
  },
  statusBannerText: { fontSize: 13, fontWeight: '600' },
  unlockNowText: { fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  uploadBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderColor: C.border,
  },
  uploadBarLabel: { fontSize: 11, color: C.textSecondary, marginBottom: 4 },
  uploadProgressTrack: { height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden' },
  uploadProgressFill: { height: '100%', borderRadius: 2 },
  uploadBtn: {
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8,
    alignItems: 'center', justifyContent: 'center', minWidth: 60,
  },
  uploadBtnText: { color: C.bg, fontWeight: '700', fontSize: 13 },
  inviteBtn: {
    backgroundColor: C.surfaceHigh, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: C.border,
  },
  inviteBtnText: { color: C.textSecondary, fontWeight: '600', fontSize: 13 },
  lockedCenter: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  lockedEmoji: { fontSize: 56, marginBottom: 12 },
  lockedCount: {
    fontSize: 64, fontWeight: '900', color: C.locked, lineHeight: 72,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
  },
  lockedCountLabel: { fontSize: 18, color: C.textSecondary, marginBottom: 16 },
  lockedSubtext: { fontSize: 14, color: C.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 8 },
  myUploadNote: {
    marginTop: 16, backgroundColor: C.lockedSoft,
    borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8,
  },
  myUploadNoteText: { color: C.locked, fontSize: 13, fontWeight: '600' },
  gridItem: { flex: 1 / 3, margin: 1, aspectRatio: 1 },
  gridImage: { width: '100%', height: '100%' },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject as any,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  videoPlayBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.75)',
  },
  memberRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border, gap: 12,
  },
  memberAvatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  memberName: { fontSize: 15, fontWeight: '600', color: C.textPrimary },
  memberJoined: { fontSize: 12, color: C.textMuted, marginTop: 1 },
  ownerBadge: {
    backgroundColor: C.accentSoft, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: C.accent + '60',
  },
  ownerBadgeText: { color: C.accent, fontSize: 11, fontWeight: '700' },
});
