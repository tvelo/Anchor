import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ProjectChat from '../../components/ProjectChat';
import UnlockCelebration from '../../components/UnlockCelebration';
import { notifyMembers } from '../../lib/network';
import { scheduleUnlockReminder } from '../../lib/notifications';
import { supabase } from '../../lib/supabase';
import { useAnchorPlus } from '../../lib/useAnchorPlus';
import { useBiometricSetting } from '../../lib/useBiometricSetting';

const { width: SW, height: SH } = Dimensions.get('window');

// ─── Constants ───────────────────────────────────────────────────────────────
const FREE_TRAVEL_LIMIT = 0;  // travel capsules are Plus-only
const FREE_MEMBER_LIMIT = 4;      // free members a paid creator can invite
const PAID_MEMBER_LIMIT = 5;      // paid members a paid creator can invite (unlimited paid access)
const FREE_MEDIA_LIMIT = 16;
const PAID_MEDIA_LIMIT = 50;

// ─── Types ────────────────────────────────────────────────────────────────────
interface TravelCapsule {
  id: string;
  name: string;
  destination: string;
  description: string;
  visibility: 'locked' | 'public';
  unlock_date: string | null;
  is_unlocked: boolean;
  cover_url: string | null;
  created_by: string;
  canvas_id: string;
  media_count: number;
  member_count: number;
  created_at: string;
}

interface CapsuleMedia {
  id: string;
  capsule_id: string;
  url: string;
  type: 'photo' | 'video';
  uploaded_by: string;
  uploader_name: string;
  created_at: string;
}

interface CapsuleMember {
  id: string;
  capsule_id: string;
  user_id: string;
  display_name: string;
  is_paid: boolean;
  joined_at: string;
}

// ─── SQL to run in Supabase ───────────────────────────────────────────────────
/*
create table travel_capsules (
  id uuid primary key default gen_random_uuid(),
  canvas_id uuid references canvases(id) on delete cascade,
  name text not null,
  destination text not null default '',
  description text not null default '',
  visibility text not null default 'public' check (visibility in ('locked','public')),
  unlock_date timestamptz,
  is_unlocked boolean not null default false,
  cover_url text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table travel_capsule_media (
  id uuid primary key default gen_random_uuid(),
  capsule_id uuid references travel_capsules(id) on delete cascade,
  url text not null,
  type text not null default 'photo' check (type in ('photo','video')),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table travel_capsule_members (
  id uuid primary key default gen_random_uuid(),
  capsule_id uuid references travel_capsules(id) on delete cascade,
  user_id uuid references auth.users(id),
  is_paid boolean not null default false,
  joined_at timestamptz default now(),
  unique(capsule_id, user_id)
);

-- RLS
alter table travel_capsules enable row level security;
alter table travel_capsule_media enable row level security;
alter table travel_capsule_members enable row level security;

create policy "Members can view capsules" on travel_capsules for select
  using (id in (select capsule_id from travel_capsule_members where user_id = auth.uid())
    or created_by = auth.uid());

create policy "Owner can insert capsules" on travel_capsules for insert
  with check (created_by = auth.uid());

create policy "Owner can update capsules" on travel_capsules for update
  using (created_by = auth.uid());

create policy "Owner can delete capsules" on travel_capsules for delete
  using (created_by = auth.uid());

create policy "Members can view media" on travel_capsule_media for select
  using (capsule_id in (select capsule_id from travel_capsule_members where user_id = auth.uid()));

create policy "Members can insert media" on travel_capsule_media for insert
  with check (capsule_id in (select capsule_id from travel_capsule_members where user_id = auth.uid())
    and uploaded_by = auth.uid());

create policy "Uploader can delete media" on travel_capsule_media for delete
  using (uploaded_by = auth.uid());

create policy "Members can view members" on travel_capsule_members for select
  using (capsule_id in (select capsule_id from travel_capsule_members where user_id = auth.uid()));

create policy "Owner can manage members" on travel_capsule_members for all
  using (capsule_id in (select id from travel_capsules where created_by = auth.uid()));

create policy "Users can join capsules" on travel_capsule_members for insert
  with check (user_id = auth.uid());
*/

// ─── Palette & Fonts ─────────────────────────────────────────────────────────
const C = {
  bg: '#0E0E12',
  surface: '#16161C',
  surfaceHigh: '#1E1E28',
  border: '#2A2A38',
  accent: '#C8A96E',       // warm gold
  accentSoft: 'rgba(200,169,110,0.15)',
  accentGlow: 'rgba(200,169,110,0.08)',
  locked: '#7B6EF6',       // violet for locked capsules
  lockedSoft: 'rgba(123,110,246,0.15)',
  public: '#5EBA8A',       // green for public capsules
  publicSoft: 'rgba(94,186,138,0.15)',
  danger: '#E05C5C',
  textPrimary: '#F0EDE8',
  textSecondary: '#8A8799',
  textMuted: '#4A4A5A',
  white: '#FFFFFF',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeUntil(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Unlocking…';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h left`;
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hours}h ${mins}m left`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PlanBadge({ isPaid }: { isPaid: boolean }) {
  if (isPaid) return null;
  return (
    <View style={styles.freeBadge}>
      <Text style={styles.freeBadgeText}>FREE</Text>
    </View>
  );
}

function CapsuleCard({
  capsule,
  onPress,
  onLongPress,
}: {
  capsule: TravelCapsule;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const isLocked = capsule.visibility === 'locked' && !capsule.is_unlocked;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, tension: 300, friction: 20 }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 300, friction: 20 }).start();
  };

  const accentColor = isLocked ? C.locked : C.public;
  const accentSoftColor = isLocked ? C.lockedSoft : C.publicSoft;

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        style={[styles.card, { borderColor: isLocked ? 'rgba(123,110,246,0.3)' : 'rgba(94,186,138,0.3)' }]}
      >
        {/* Cover / Header */}
        <View style={[styles.cardHeader, { backgroundColor: accentSoftColor }]}>
          {capsule.cover_url ? (
            <Image source={{ uri: capsule.cover_url }} style={styles.cardCoverImg} />
          ) : (
            <View style={styles.cardCoverPlaceholder}>
              <Text style={styles.cardCoverEmoji}>{isLocked ? '🔒' : '✈️'}</Text>
              <Text style={[styles.cardDestinationLarge, { color: accentColor }]}>
                {capsule.destination || capsule.name}
              </Text>
            </View>
          )}
          {/* Visibility badge */}
          <View style={[styles.visibilityBadge, { backgroundColor: accentColor }]}>
            <Text style={styles.visibilityBadgeText}>
              {isLocked ? '🔒 LOCKED' : '📖 OPEN'}
            </Text>
          </View>
        </View>

        {/* Body */}
        <View style={styles.cardBody}>
          <Text style={styles.cardName}>{capsule.name}</Text>
          {capsule.destination ? (
            <Text style={styles.cardDestination}>📍 {capsule.destination}</Text>
          ) : null}

          {/* Countdown or unlock indicator */}
          {isLocked && capsule.unlock_date && (
            <View style={styles.countdownRow}>
              <Text style={[styles.countdownText, { color: C.locked }]}>
                ⏳ {timeUntil(capsule.unlock_date)}
              </Text>
            </View>
          )}
          {isLocked && !capsule.unlock_date && (
            <View style={styles.countdownRow}>
              <Text style={[styles.countdownText, { color: C.locked }]}>
                🔒 Manually unlocked by owner
              </Text>
            </View>
          )}

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{capsule.media_count}</Text>
              <Text style={styles.statLabel}>{isLocked ? 'memories waiting' : 'memories'}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statNum}>{capsule.member_count}</Text>
              <Text style={styles.statLabel}>travellers</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statLabel}>{formatDate(capsule.created_at)}</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Create Capsule Modal ─────────────────────────────────────────────────────
function CreateCapsuleModal({
  visible,
  onClose,
  onCreated,
  canvasId,
  userId,
  isPaid,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (c: TravelCapsule) => void;
  canvasId: string;
  userId: string;
  isPaid: boolean;
}) {
  const [step, setStep] = useState(0); // 0=basics, 1=visibility
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'locked' | 'public'>('public');
  const [unlockMode, setUnlockMode] = useState<'date' | 'manual' | 'both'>('both');
  const [unlockDate, setUnlockDate] = useState('');
  const [loading, setLoading] = useState(false);

  const slideAnim = useRef(new Animated.Value(0)).current;

  const goStep = (s: number) => {
    Animated.timing(slideAnim, {
      toValue: -s * SW,
      duration: 280,
      useNativeDriver: true,
    }).start(() => setStep(s));
    slideAnim.setValue(-s * SW);
  };

  const reset = () => {
    setStep(0); setName(''); setDestination(''); setDescription('');
    setVisibility('public'); setUnlockMode('both'); setUnlockDate('');
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give your travel capsule a name.');
      return;
    }
    if (visibility === 'locked' && unlockMode !== 'manual' && !unlockDate.trim()) {
      Alert.alert('Unlock date required', 'Enter a date or switch to manual unlock.');
      return;
    }

    setLoading(true);
    try {
      let parsedDate: string | null = null;
      if (visibility === 'locked' && unlockMode !== 'manual' && unlockDate) {
        const parts = unlockDate.split('/');
        if (parts.length === 3) {
          parsedDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).toISOString();
        }
      }

      const { data, error } = await supabase
        .from('travel_capsules')
        .insert({
          canvas_id: canvasId,
          name: name.trim(),
          destination: destination.trim(),
          description: description.trim(),
          visibility,
          unlock_date: parsedDate,
          is_unlocked: false,
          created_by: userId,
        })
        .select()
        .single();

      if (error) throw error;

      // auto-add creator as member
      await supabase.from('travel_capsule_members').insert({
        capsule_id: data.id,
        user_id: userId,
        is_paid: isPaid,
      });

      // Schedule 24h-before unlock reminder
      if (parsedDate) {
        scheduleUnlockReminder(name.trim(), new Date(parsedDate)).catch(() => {});
      }

      onCreated({ ...data, media_count: 0, member_count: 1 });
      reset();
      onClose();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => { reset(); onClose(); }}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>New Travel Capsule</Text>
            <View style={{ width: 60 }} />
          </View>

          {/* Progress dots */}
          <View style={styles.progressRow}>
            {[0, 1].map(i => (
              <View key={i} style={[styles.progressDot, step >= i && styles.progressDotActive]} />
            ))}
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
            {step === 0 && (
              <View>
                <Text style={styles.stepTitle}>Trip Details</Text>
                <Text style={styles.stepSubtitle}>Give your capsule a name and tell everyone where you're headed.</Text>

                <Text style={styles.fieldLabel}>Capsule Name *</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Japan Spring 2025"
                  placeholderTextColor={C.textMuted}
                />

                <Text style={styles.fieldLabel}>Destination</Text>
                <TextInput
                  style={styles.input}
                  value={destination}
                  onChangeText={setDestination}
                  placeholder="e.g. Tokyo, Japan"
                  placeholderTextColor={C.textMuted}
                />

                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="What's this trip about?"
                  placeholderTextColor={C.textMuted}
                  multiline
                />

                <TouchableOpacity
                  style={[styles.primaryBtn, !name.trim() && { opacity: 0.4 }]}
                  onPress={() => setStep(1)}
                  disabled={!name.trim()}
                >
                  <Text style={styles.primaryBtnText}>Next →</Text>
                </TouchableOpacity>
              </View>
            )}

            {step === 1 && (
              <View>
                <Text style={styles.stepTitle}>Visibility</Text>
                <Text style={styles.stepSubtitle}>Choose how memories are shared while the trip is happening.</Text>

                {/* Public option */}
                <TouchableOpacity
                  style={[styles.visibilityOption, visibility === 'public' && styles.visibilityOptionActive]}
                  onPress={() => setVisibility('public')}
                >
                  <View style={styles.visibilityIconBox}>
                    <Text style={{ fontSize: 28 }}>📖</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.visibilityOptionTitle}>Always Open</Text>
                    <Text style={styles.visibilityOptionDesc}>
                      Everyone in the group can see photos and videos as they're uploaded in real time.
                    </Text>
                  </View>
                  <View style={[styles.radioOuter, visibility === 'public' && styles.radioOuterActive]}>
                    {visibility === 'public' && <View style={styles.radioInner} />}
                  </View>
                </TouchableOpacity>

                {/* Locked option */}
                <TouchableOpacity
                  style={[styles.visibilityOption, visibility === 'locked' && styles.visibilityOptionActiveLocked]}
                  onPress={() => setVisibility('locked')}
                >
                  <View style={styles.visibilityIconBox}>
                    <Text style={{ fontSize: 28 }}>🔒</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.visibilityOptionTitle}>Hidden Until Unlocked</Text>
                    <Text style={styles.visibilityOptionDesc}>
                      Everyone can upload, but nobody sees the contents until the capsule is opened.
                    </Text>
                  </View>
                  <View style={[styles.radioOuter, visibility === 'locked' && styles.radioOuterActiveLocked]}>
                    {visibility === 'locked' && <View style={[styles.radioInner, { backgroundColor: C.locked }]} />}
                  </View>
                </TouchableOpacity>

                {/* Unlock settings */}
                {visibility === 'locked' && (
                  <View style={styles.unlockSettings}>
                    <Text style={styles.fieldLabel}>Unlock Condition</Text>

                    <View style={styles.segmentRow}>
                      {(['date', 'manual', 'both'] as const).map(m => (
                        <TouchableOpacity
                          key={m}
                          style={[styles.segment, unlockMode === m && styles.segmentActive]}
                          onPress={() => setUnlockMode(m)}
                        >
                          <Text style={[styles.segmentText, unlockMode === m && styles.segmentTextActive]}>
                            {m === 'date' ? '📅 Date' : m === 'manual' ? '👆 Manual' : '🔀 Both'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {unlockMode !== 'manual' && (
                      <>
                        <Text style={styles.fieldLabel}>Unlock Date (DD/MM/YYYY)</Text>
                        <TextInput
                          style={styles.input}
                          value={unlockDate}
                          onChangeText={setUnlockDate}
                          placeholder="31/12/2025"
                          placeholderTextColor={C.textMuted}
                          keyboardType="numbers-and-punctuation"
                        />
                      </>
                    )}

                    {unlockMode === 'manual' && (
                      <View style={styles.infoBox}>
                        <Text style={styles.infoText}>
                          Only you (the creator) can manually unlock this capsule from within the capsule settings.
                        </Text>
                      </View>
                    )}

                    {unlockMode === 'both' && (
                      <View style={styles.infoBox}>
                        <Text style={styles.infoText}>
                          Capsule auto-unlocks on the date, or you can unlock it manually before then.
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Media limit info */}
                <View style={[styles.infoBox, { marginTop: 16 }]}>
                  <Text style={styles.infoText}>
                    📸 Each member can upload up to {isPaid ? PAID_MEDIA_LIMIT : FREE_MEDIA_LIMIT} photos/videos.
                    {!isPaid ? ' Upgrade to Anchor Plus for 50 per person.' : ''}
                  </Text>
                </View>

                <View style={styles.btnRow}>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep(0)}>
                    <Text style={styles.secondaryBtnText}>← Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryBtn, { flex: 1, marginLeft: 12 }]}
                    onPress={handleCreate}
                    disabled={loading}
                  >
                    {loading
                      ? <ActivityIndicator color={C.bg} />
                      : <Text style={styles.primaryBtnText}>Create Capsule ✈️</Text>
                    }
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

// ─── Capsule Detail Screen ─────────────────────────────────────────────────────
function CapsuleDetailScreen({
  capsule: initialCapsule,
  userId,
  isPaid,
  onBack,
  onUpdated,
}: {
  capsule: TravelCapsule;
  userId: string;
  isPaid: boolean;
  onBack: () => void;
  onUpdated: (c: TravelCapsule) => void;
}) {
  const [capsule, setCapsule] = useState(initialCapsule);
  const [media, setMedia] = useState<CapsuleMedia[]>([]);
  const [members, setMembers] = useState<CapsuleMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [displayName, setDisplayName] = useState('Someone');
  const [unlockCelebration, setUnlockCelebration] = useState<{ name: string; mediaUrls: string[] } | null>(null);
  const isOwner = capsule.created_by === userId;
  const isLocked = capsule.visibility === 'locked' && !capsule.is_unlocked;
  const myMediaCount = media.filter(m => m.uploaded_by === userId).length;
  const mediaLimit = isPaid ? PAID_MEDIA_LIMIT : FREE_MEDIA_LIMIT;

  useEffect(() => {
    loadData();
    // Check auto-unlock
    if (capsule.visibility === 'locked' && !capsule.is_unlocked && capsule.unlock_date) {
      if (new Date(capsule.unlock_date) <= new Date()) {
        handleAutoUnlock();
      }
    }
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Fetch current user's display name for notifications
      const { data: userProf } = await supabase.from('users').select('display_name').eq('id', userId).maybeSingle();
      if (userProf?.display_name) setDisplayName(userProf.display_name);

      // Load media
      const { data: mediaData } = await supabase
        .from('travel_capsule_media')
        .select('*, users(display_name)')
        .eq('capsule_id', capsule.id)
        .order('created_at', { ascending: false });

      if (mediaData) {
        setMedia(mediaData.map((m: any) => ({
          ...m,
          uploader_name: m.users?.display_name ?? 'Unknown',
        })));
      }

      // Load members
      const { data: memberData } = await supabase
        .from('travel_capsule_members')
        .select('*, users(display_name)')
        .eq('capsule_id', capsule.id);

      if (memberData) {
        setMembers(memberData.map((m: any) => ({
          ...m,
          display_name: m.users?.display_name ?? 'Unknown',
        })));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAutoUnlock = async () => {
    const { data } = await supabase
      .from('travel_capsules')
      .update({ is_unlocked: true })
      .eq('id', capsule.id)
      .select()
      .single();
    if (data) {
      const updated = { ...capsule, is_unlocked: true };
      setCapsule(updated);
      onUpdated(updated);
      notifyMembers({ type: 'capsule_unlock', capsule_id: capsule.id, actor_id: userId, actor_name: displayName, title: 'Capsule unlocked 🔓', body: `"${capsule.name}" is now open — see everyone's memories!` }).catch(() => {});
      setUnlockCelebration({ name: capsule.name, mediaUrls: media.slice(0, 5).map(m => m.url) });
    }
  };

  const handleManualUnlock = () => {
    Alert.alert(
      'Unlock Capsule?',
      'Everyone will be able to see all memories immediately. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlock 🔓', style: 'destructive', onPress: async () => {
            await supabase.from('travel_capsules').update({ is_unlocked: true }).eq('id', capsule.id);
            const updated = { ...capsule, is_unlocked: true };
            setCapsule(updated);
            onUpdated(updated);
            notifyMembers({ type: 'capsule_unlock', capsule_id: capsule.id, actor_id: userId, actor_name: displayName, title: 'Capsule unlocked 🔓', body: `"${capsule.name}" is now open — see everyone's memories!` }).catch(() => {});
            setUnlockCelebration({ name: capsule.name, mediaUrls: media.slice(0, 5).map(m => m.url) });
          }
        },
      ]
    );
  };

  const handleUpload = async () => {
    if (myMediaCount >= mediaLimit) {
      Alert.alert(
        'Upload limit reached',
        isPaid
          ? `You've uploaded the maximum of ${PAID_MEDIA_LIMIT} items.`
          : `Free plan allows ${FREE_MEDIA_LIMIT} uploads. Upgrade to Anchor Plus for 50.`
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      selectionLimit: Math.min(10, mediaLimit - myMediaCount),
      quality: 0.85,
    });

    if (result.canceled || !result.assets.length) return;

    setUploading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    for (const asset of result.assets) {
      try {
        const ext = asset.uri.split('.').pop() ?? 'jpg';
        const fileName = `${capsule.id}/${userId}_${Date.now()}.${ext}`;
        const response = await fetch(asset.uri);
        const blob = await response.blob();

        const { error: uploadError } = await supabase.storage
          .from('canvas-images')
          .upload(fileName, blob, { contentType: asset.type === 'video' ? 'video/mp4' : 'image/jpeg' });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from('canvas-images').getPublicUrl(fileName);

        await supabase.from('travel_capsule_media').insert({
          capsule_id: capsule.id,
          url: urlData.publicUrl,
          type: asset.type === 'video' ? 'video' : 'photo',
          uploaded_by: userId,
        });
      } catch (e: any) {
        Alert.alert('Upload error', e.message);
      }
    }

    setUploading(false);
    loadData();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    notifyMembers({ type: 'capsule_media', capsule_id: capsule.id, actor_id: userId, actor_name: displayName, title: 'New memory added 📸', body: `${displayName} added to "${capsule.name}"` }).catch(() => {});
  };

  const handleInvite = async () => {
    const freeSlots = FREE_MEMBER_LIMIT - members.filter(m => !m.is_paid).length;
    const totalMembers = members.length;
    const maxMembers = isPaid ? 99 : FREE_MEMBER_LIMIT + 1; // +1 for creator

    if (!isPaid && totalMembers >= maxMembers) {
      Alert.alert(
        'Member limit reached',
        `Free accounts can have up to ${FREE_MEMBER_LIMIT} invited members. Upgrade to Anchor Plus to invite up to ${PAID_MEMBER_LIMIT} paid members and unlimited free members.`
      );
      return;
    }

    const inviteLink = `ahttps://yourusername.github.io/anchor-links/travel/${capsule.id}`;
    await Share.share({
      message: `Join my travel capsule "${capsule.name}" on Anchor!\n\n${inviteLink}`,
      title: `Join ${capsule.name}`,
    });
  };

  const accentColor = isLocked ? C.locked : C.public;
  const accentSoft = isLocked ? C.lockedSoft : C.publicSoft;

  return (
    <View style={styles.detailContainer}>
      {unlockCelebration && (
  <UnlockCelebration
    visible={true}
    capsuleName={unlockCelebration.name}
    mediaUrls={unlockCelebration.mediaUrls ?? []}
    onDismiss={() => { setUnlockCelebration(null); loadData(); }}
  />
)}
      {/* Header */}
      <View style={styles.detailHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹ Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.detailTitle} numberOfLines={1}>{capsule.name}</Text>
          {capsule.destination ? (
            <Text style={styles.detailSubtitle}>📍 {capsule.destination}</Text>
          ) : null}
        </View>
        <TouchableOpacity onPress={() => setShowMembers(true)} style={styles.membersBtn}>
          <Text style={styles.membersBtnText}>👥 {members.length}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setChatOpen(true)} style={[styles.membersBtn, { marginLeft: 8 }]}>
          <Text style={styles.membersBtnText}>💬</Text>
        </TouchableOpacity>
      </View>

      {/* Status Banner */}
      <View style={[styles.statusBanner, { backgroundColor: accentSoft, borderColor: accentColor + '40' }]}>
        <Text style={[styles.statusBannerText, { color: accentColor }]}>
          {isLocked
            ? capsule.unlock_date
              ? `🔒 Locked · ${timeUntil(capsule.unlock_date)}`
              : '🔒 Locked · Manual unlock only'
            : '📖 Open · Everyone can see memories'}
        </Text>
        {isLocked && isOwner && (
          <TouchableOpacity onPress={handleManualUnlock}>
            <Text style={[styles.unlockNowText, { color: accentColor }]}>Unlock now</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Upload bar */}
      <View style={styles.uploadBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.uploadBarLabel}>
            Your uploads: {myMediaCount} / {mediaLimit}
          </Text>
          <View style={styles.uploadProgressTrack}>
            <View style={[styles.uploadProgressFill, {
              width: `${Math.min(100, (myMediaCount / mediaLimit) * 100)}%` as any,
              backgroundColor: accentColor,
            }]} />
          </View>
        </View>
        <TouchableOpacity
          style={[styles.uploadBtn, { backgroundColor: accentColor }, (uploading || myMediaCount >= mediaLimit) && { opacity: 0.5 }]}
          onPress={handleUpload}
          disabled={uploading || myMediaCount >= mediaLimit}
        >
          {uploading
            ? <ActivityIndicator color={C.bg} size="small" />
            : <Text style={styles.uploadBtnText}>+ Add</Text>
          }
        </TouchableOpacity>
        <TouchableOpacity style={styles.inviteBtn} onPress={handleInvite}>
          <Text style={styles.inviteBtnText}>Invite</Text>
        </TouchableOpacity>
      </View>

      {/* Media Grid or Locked State */}
      {loading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={C.accent} size="large" />
        </View>
      ) : isLocked ? (
        // LOCKED: show count only
        <View style={styles.lockedCenter}>
          <Text style={styles.lockedEmoji}>🔒</Text>
          <Text style={styles.lockedCount}>{media.length}</Text>
          <Text style={styles.lockedCountLabel}>
            {media.length === 1 ? 'memory' : 'memories'} waiting
          </Text>
          {capsule.unlock_date && (
            <Text style={styles.lockedSubtext}>
              Unlocks automatically on {formatDate(capsule.unlock_date)}
            </Text>
          )}
          <Text style={styles.lockedSubtext}>
            Everyone can still add photos & videos now — they'll all be revealed together.
          </Text>
          {/* Show my own uploads count as reassurance */}
          <View style={styles.myUploadNote}>
            <Text style={styles.myUploadNoteText}>You've added {myMediaCount} {myMediaCount === 1 ? 'memory' : 'memories'}</Text>
          </View>
        </View>
      ) : (
        // OPEN: show grid
        media.length === 0 ? (
          <View style={styles.emptyCenter}>
            <Text style={{ fontSize: 48 }}>📷</Text>
            <Text style={styles.emptyText}>No memories yet</Text>
            <Text style={styles.emptySubtext}>Be the first to add a photo or video!</Text>
          </View>
        ) : (
          <FlatList
            data={media}
            keyExtractor={m => m.id}
            numColumns={3}
            contentContainerStyle={{ padding: 2 }}
            renderItem={({ item }) => (
              <View style={styles.gridItem}>
                <Image source={{ uri: item.url }} style={styles.gridImage} />
                {item.type === 'video' && (
                  <View style={styles.videoOverlay}>
                    <Text style={{ color: C.white, fontSize: 18 }}>▶</Text>
                  </View>
                )}
              </View>
            )}
          />
        )
      )}

      {/* Members Modal */}
      <Modal visible={showMembers} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowMembers(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowMembers(false)}>
              <Text style={styles.modalCancel}>Done</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Travellers ({members.length})</Text>
            <TouchableOpacity onPress={handleInvite}>
              <Text style={[styles.modalCancel, { color: C.accent }]}>+ Invite</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            {/* Limit info */}
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                {isPaid
                  ? `Paid plan: invite up to ${PAID_MEMBER_LIMIT} paid members + unlimited free members.`
                  : `Free plan: up to ${FREE_MEMBER_LIMIT} invited members. Upgrade to Anchor Plus for more.`
                }
              </Text>
            </View>
            {members.map(m => (
              <View key={m.id} style={styles.memberRow}>
                <View style={styles.memberAvatar}>
                  <Text style={{ color: C.textPrimary, fontWeight: '700' }}>
                    {m.display_name?.[0]?.toUpperCase() ?? '?'}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{m.display_name}</Text>
                  <Text style={styles.memberJoined}>Joined {formatDate(m.joined_at)}</Text>
                </View>
                {m.user_id === capsule.created_by && (
                  <View style={styles.ownerBadge}><Text style={styles.ownerBadgeText}>Owner</Text></View>
                )}
                {m.is_paid && m.user_id !== capsule.created_by && (
                  <View style={[styles.ownerBadge, { backgroundColor: C.accentSoft, borderColor: C.accent + '60' }]}>
                    <Text style={[styles.ownerBadgeText, { color: C.accent }]}>Plus</Text>
                  </View>
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>

      <ProjectChat
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        projectType="capsule"
        projectId={capsule.id}
        currentUserId={userId}
      />
    </View>
  );
}

// ─── Main Trips Screen ────────────────────────────────────────────────────────
export default function TripsScreen() {
  const [capsules, setCapsules] = useState<TravelCapsule[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState('');
  const [canvasId, setCanvasId] = useState('');
  const { isPlus: isPaid } = useAnchorPlus()
  const [showCreate, setShowCreate] = useState(false);
  const [activeCapsule, setActiveCapsule] = useState<TravelCapsule | null>(null);
  const { prompt: biometricPrompt } = useBiometricSetting();

  const headerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    initUser();
  }, []);

  useEffect(() => {
    Animated.timing(headerAnim, {
      toValue: 1, duration: 600, useNativeDriver: true,
    }).start();
  }, []);

  const initUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data: canvas } = await supabase
        .from('canvases')
        .select('id')
        .or(`owner_id.eq.${user.id},partner_id.eq.${user.id}`)
        .limit(1)
        .maybeSingle();

      let chosenCanvas = canvas;
      if (!chosenCanvas) {
        // Auto-create a default space silently
        const { data: newCanvas } = await supabase.from('canvases')
          .insert({ name: 'My Space', owner_id: user.id, background_type: 'color', background_value: '#1A1118', theme: 'none' })
          .select('id').single();
        chosenCanvas = newCanvas;
      }
      if (chosenCanvas?.id) {
        setCanvasId(chosenCanvas.id);
        await loadCapsules(chosenCanvas.id, user.id);
      } else {
        setCanvasId('');
        setCapsules([]);
      }
    } catch (e) {
      console.log('[Trips] init error:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadCapsules = async (cId: string, uId: string) => {
    setLoading(true);
    try {
      // get capsule IDs where user is a member
      const { data: memberships } = await supabase
        .from('travel_capsule_members')
        .select('capsule_id')
        .eq('user_id', uId);

      const capsuleIds = memberships?.map((m: any) => m.capsule_id) ?? [];
      if (!capsuleIds.length) { setLoading(false); return; }

      const { data } = await supabase
        .from('travel_capsules')
        .select('*')
        .in('id', capsuleIds)
        .order('created_at', { ascending: false });

      if (!data) { setLoading(false); return; }

      // Count media and members for each capsule
      const enriched = await Promise.all(data.map(async (c: any) => {
        const [{ count: mCount }, { count: memCount }] = await Promise.all([
          supabase.from('travel_capsule_media').select('*', { count: 'exact', head: true }).eq('capsule_id', c.id),
          supabase.from('travel_capsule_members').select('*', { count: 'exact', head: true }).eq('capsule_id', c.id),
        ]);
        // Auto-unlock check
        let is_unlocked = c.is_unlocked;
        if (c.visibility === 'locked' && !is_unlocked && c.unlock_date) {
          if (new Date(c.unlock_date) <= new Date()) {
            is_unlocked = true;
            await supabase.from('travel_capsules').update({ is_unlocked: true }).eq('id', c.id);
          }
        }
        return { ...c, is_unlocked, media_count: mCount ?? 0, member_count: memCount ?? 0 };
      }));

      setCapsules(enriched);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (capsule: TravelCapsule) => {
    if (capsule.created_by !== userId) {
      Alert.alert('Cannot delete', "You can only delete capsules you created.");
      return;
    }
    Alert.alert(
      'Delete Capsule?',
      `"${capsule.name}" and all its memories will be permanently deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            await supabase.from('travel_capsules').delete().eq('id', capsule.id);
            setCapsules(prev => prev.filter(c => c.id !== capsule.id));
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          }
        },
      ]
    );
  };

  const canCreate = isPaid;  // travel capsules are Plus-only

  // ── Active capsule detail view ──
  if (activeCapsule) {
    return (
      <CapsuleDetailScreen
        capsule={activeCapsule}
        userId={userId}
        isPaid={isPaid}
        onBack={() => setActiveCapsule(null)}
        onUpdated={(updated) => {
          setCapsules(prev => prev.map(c => c.id === updated.id ? updated : c));
          setActiveCapsule(updated);
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Hero Header */}
      <Animated.View style={[styles.heroHeader, {
        opacity: headerAnim,
        transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }],
      }]}>
        <View>
          <Text style={styles.heroTitle}>Travel</Text>
          <Text style={styles.heroSubtitle}>Shared memory capsules for your trips</Text>
        </View>
        <TouchableOpacity
          style={[styles.newCapsuleBtn, !canCreate && styles.newCapsuleBtnDisabled]}
          onPress={() => {
            if (!canCreate) {
              Alert.alert('Anchor Plus Feature', 'Travel capsules are an Anchor Plus feature. Upgrade to create and share trip memories.', [
                { text: 'Maybe later' },
                { text: 'Learn more', onPress: () => router.push('/plus' as any) },
              ]);
              return;
            }
            setShowCreate(true);
          }}
        >
          <Text style={styles.newCapsuleBtnText}>+ New</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Free limit notice */}
      {!isPaid && (
        <View style={styles.limitBar}>
          <Text style={styles.limitBarText}>
            ✈️ Travel capsules are an Anchor Plus feature
          </Text>
        </View>
      )}

      {loading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={C.accent} size="large" />
        </View>
      ) : capsules.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateEmoji}>✈️</Text>
          <Text style={styles.emptyStateTitle}>{isPaid ? 'No travel capsules yet' : 'Travel Capsules'}</Text>
          <Text style={styles.emptyStateDesc}>
            {isPaid
              ? 'Create a capsule for your next trip and invite friends to upload memories together.'
              : 'Create time-locked capsules for your trips — upload memories together and reveal them at the end. Available with Anchor Plus.'}
          </Text>
          <TouchableOpacity
            style={styles.emptyStateBtn}
            onPress={() => {
              if (!isPaid) {
                router.push('/plus' as any);
                return;
              }
              setShowCreate(true);
            }}
          >
            <Text style={styles.emptyStateBtnText}>{isPaid ? 'Create Your First Capsule' : 'Unlock with Anchor Plus ✦'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {capsules.map(c => (
            <CapsuleCard
              key={c.id}
              capsule={c}
              onPress={async () => { const ok = await biometricPrompt(); if (ok) setActiveCapsule(c); }}
              onLongPress={() => handleDelete(c)}
            />
          ))}

          {/* Locked ghost card */}
          {!isPaid && (
            <TouchableOpacity
              style={styles.ghostCard}
              onPress={() => Alert.alert('Anchor Plus', 'Unlimited travel capsules — coming soon!')}
            >
              <Text style={styles.ghostCardEmoji}>✈️</Text>
              <Text style={styles.ghostCardTitle}>More Capsules</Text>
              <Text style={styles.ghostCardSub}>Upgrade to Anchor Plus</Text>
              <View style={styles.ghostLockBadge}><Text style={styles.ghostLockText}>🔒 Plus</Text></View>
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
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // Hero
  heroHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16,
  },
  heroTitle: {
    fontSize: 34, fontWeight: '800', color: C.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', letterSpacing: -0.5,
  },
  heroSubtitle: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  newCapsuleBtn: {
    backgroundColor: C.accent, borderRadius: 20,
    paddingHorizontal: 18, paddingVertical: 9,
  },
  newCapsuleBtnDisabled: { backgroundColor: C.surfaceHigh },
  newCapsuleBtnText: { color: C.bg, fontWeight: '700', fontSize: 14 },

  // Limit bar
  limitBar: {
    backgroundColor: C.accentGlow, borderBottomWidth: 1, borderColor: C.border,
    paddingHorizontal: 20, paddingVertical: 8,
  },
  limitBarText: { color: C.textSecondary, fontSize: 12 },

  // Card
  card: {
    backgroundColor: C.surface, borderRadius: 16, marginBottom: 16,
    borderWidth: 1, overflow: 'hidden',
  },
  cardHeader: { height: 120, overflow: 'hidden' },
  cardCoverImg: { width: '100%', height: '100%' },
  cardCoverPlaceholder: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
  },
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

  // Ghost card
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

  // Empty state
  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 40, paddingBottom: 60,
  },
  emptyStateEmoji: { fontSize: 64, marginBottom: 16 },
  emptyStateTitle: { fontSize: 22, fontWeight: '800', color: C.textPrimary, textAlign: 'center', marginBottom: 10 },
  emptyStateDesc: { fontSize: 15, color: C.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  emptyStateBtn: {
    backgroundColor: C.accent, borderRadius: 24,
    paddingHorizontal: 28, paddingVertical: 14,
  },
  emptyStateBtnText: { color: C.bg, fontWeight: '700', fontSize: 15 },

  // Loading / empty
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: { fontSize: 18, fontWeight: '700', color: C.textPrimary, marginTop: 12 },
  emptySubtext: { fontSize: 14, color: C.textSecondary, textAlign: 'center', marginTop: 6 },

  // Modal
  modalContainer: { flex: 1, backgroundColor: C.bg },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 20, borderBottomWidth: 1, borderColor: C.border,
  },
  modalCancel: { fontSize: 16, color: C.textSecondary },
  modalTitle: { fontSize: 17, fontWeight: '700', color: C.textPrimary },

  // Progress
  progressRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 16 },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.border },
  progressDotActive: { backgroundColor: C.accent, width: 24 },

  // Step
  stepTitle: { fontSize: 24, fontWeight: '800', color: C.textPrimary, marginBottom: 6, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  stepSubtitle: { fontSize: 14, color: C.textSecondary, marginBottom: 24, lineHeight: 20 },

  // Input
  fieldLabel: { fontSize: 13, color: C.textSecondary, marginBottom: 6, fontWeight: '600', marginTop: 16 },
  input: {
    backgroundColor: C.surfaceHigh, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 12, color: C.textPrimary, fontSize: 15,
  },

  // Visibility options
  visibilityOption: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.surfaceHigh,
    borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1.5, borderColor: C.border, gap: 12,
  },
  visibilityOptionActive: { borderColor: C.public, backgroundColor: C.publicSoft },
  visibilityOptionActiveLocked: { borderColor: C.locked, backgroundColor: C.lockedSoft },
  visibilityIconBox: { width: 48, height: 48, borderRadius: 12, backgroundColor: C.border, alignItems: 'center', justifyContent: 'center' },
  visibilityOptionTitle: { fontSize: 16, fontWeight: '700', color: C.textPrimary, marginBottom: 3 },
  visibilityOptionDesc: { fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  radioOuter: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  radioOuterActive: { borderColor: C.public },
  radioOuterActiveLocked: { borderColor: C.locked },
  radioInner: { width: 11, height: 11, borderRadius: 6, backgroundColor: C.public },

  // Unlock settings
  unlockSettings: { marginTop: 4, padding: 16, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border },
  segmentRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  segment: { flex: 1, backgroundColor: C.surfaceHigh, borderRadius: 10, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  segmentActive: { backgroundColor: C.lockedSoft, borderColor: C.locked },
  segmentText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: C.locked },

  // Info box
  infoBox: { backgroundColor: C.surfaceHigh, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.border },
  infoText: { fontSize: 13, color: C.textSecondary, lineHeight: 18 },

  // Buttons
  primaryBtn: {
    backgroundColor: C.accent, borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', marginTop: 24,
  },
  primaryBtnText: { color: C.bg, fontWeight: '800', fontSize: 16 },
  secondaryBtn: {
    backgroundColor: C.surfaceHigh, borderRadius: 14, paddingVertical: 15,
    paddingHorizontal: 20, alignItems: 'center', borderWidth: 1, borderColor: C.border,
  },
  secondaryBtnText: { color: C.textSecondary, fontWeight: '700', fontSize: 16 },
  btnRow: { flexDirection: 'row', marginTop: 24, alignItems: 'center' },

  // Detail screen
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
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: C.border,
  },
  membersBtnText: { color: C.textSecondary, fontSize: 13, fontWeight: '600' },

  // Status banner
  statusBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1,
  },
  statusBannerText: { fontSize: 13, fontWeight: '600' },
  unlockNowText: { fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },

  // Upload bar
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

  // Locked center
  lockedCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  lockedEmoji: { fontSize: 56, marginBottom: 12 },
  lockedCount: { fontSize: 64, fontWeight: '900', color: C.locked, lineHeight: 72, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  lockedCountLabel: { fontSize: 18, color: C.textSecondary, marginBottom: 16 },
  lockedSubtext: { fontSize: 14, color: C.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 8 },
  myUploadNote: { marginTop: 16, backgroundColor: C.lockedSoft, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  myUploadNoteText: { color: C.locked, fontSize: 13, fontWeight: '600' },

  // Grid
  gridItem: { flex: 1/3, margin: 1, aspectRatio: 1 },
  gridImage: { width: '100%', height: '100%' },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Members
  memberRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border, gap: 12,
  },
  memberAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  memberName: { fontSize: 15, fontWeight: '600', color: C.textPrimary },
  memberJoined: { fontSize: 12, color: C.textMuted, marginTop: 1 },
  ownerBadge: {
    backgroundColor: C.accentSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: C.accent + '60',
  },
  ownerBadgeText: { color: C.accent, fontSize: 11, fontWeight: '700' },

  freeBadge: { backgroundColor: C.accentSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  freeBadgeText: { color: C.accent, fontSize: 10, fontWeight: '800' },
});
