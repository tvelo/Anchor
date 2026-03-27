import { useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { VideoView, useVideoPlayer } from 'expo-video';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Dimensions, FlatList, Image,
  KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView,
  StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAudioManager } from '../../lib/AudioManager';
import { safeString } from '../../lib/safeContent';
import { useTheme } from '../../lib/ThemeContext';
import { storageUploadUrl } from '../../lib/storage';
import { supabase } from '../../lib/supabase';

const { width: SW, height: SH } = Dimensions.get('window');

const SOCIAL_EXTRAS = {
  borderLight: '#2E2E48',
  purple: '#7B6EF6', purpleSoft: 'rgba(123,110,246,0.15)',
  green: '#5EBA8A', greenSoft: 'rgba(94,186,138,0.15)',
  gold: '#FFD700',
};

function useSocialColors() {
  const { colors } = useTheme();
  return { ...colors, ...SOCIAL_EXTRAS };
}

type FeedMode = 'fyp' | 'following';
type Tab = 'feed' | 'discover' | 'profile';
type ProfileTab = 'posts' | 'saved';
type ContentFilter = 'all' | 'scrapbook' | 'capsule';

interface SocialProfile {
  id: string; username: string; display_name: string;
  bio: string | null; avatar_url: string | null;
  privacy?: 'public' | 'followers' | 'friends';
}
interface SocialPost {
  id: string; user_id: string; type: 'scrapbook' | 'capsule';
  reference_id: string; caption: string | null; thumbnail_url: string | null;
  title: string | null; created_at: string; music_url?: string | null; music_name?: string | null;
  profile?: SocialProfile; like_count?: number; liked_by_me?: boolean;
  comment_count?: number; favourited_by_me?: boolean;
}
interface SavedSong { id: string; post_id: string; music_url: string; music_name: string; created_at: string; }
interface Comment {
  id: string; post_id: string; user_id: string; content: string; created_at: string;
  profile?: SocialProfile;
}
interface SlideItem {
  id: string; type: 'photo' | 'video' | 'page';
  url?: string; bgColor?: string; bgPhotoUrl?: string; bgDim?: number; elements?: any[];
}

const CONTENT_H = SW * (16 / 9);

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function uploadToStorage(uri: string, path: string): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const ext = uri.split('.').pop()?.split('?')[0] || 'jpg';
    const fd = new FormData();
    fd.append('file', { uri, name: `file.${ext}`, type: 'image/jpeg' } as any);
    const res = await fetch(
      storageUploadUrl('canvas-images', path),
      { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'x-upsert': 'true' }, body: fd }
    );
    if (!res.ok) return null;
    return supabase.storage.from('canvas-images').getPublicUrl(path).data.publicUrl;
  } catch { return null; }
}

function fmt(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now'; if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ─── Privacy filter — applied after enrichPosts ───────────────────────────────
async function filterByPrivacy(posts: SocialPost[], userId: string): Promise<SocialPost[]> {
  if (!posts.length || !userId) return posts;

  const [myFollowsRes, myFollowersRes] = await Promise.all([
    supabase.from('social_follows').select('following_id').eq('follower_id', userId),
    supabase.from('social_follows').select('follower_id').eq('following_id', userId),
  ]);

  const iFollowSet   = new Set((myFollowsRes.data   ?? []).map((f: any) => f.following_id));
  const followsMeSet = new Set((myFollowersRes.data  ?? []).map((f: any) => f.follower_id));

  return posts.filter(post => {
    if (post.user_id === userId) return true;
    const privacy = (post.profile as any)?.privacy ?? 'public';
    if (privacy === 'public')    return true;
    if (privacy === 'followers') return iFollowSet.has(post.user_id);
    if (privacy === 'friends')   return iFollowSet.has(post.user_id) && followsMeSet.has(post.user_id);
    return true;
  });
}

function Avatar({ profile, size = 36 }: { profile?: SocialProfile | null; size?: number }) {
  const C = useSocialColors();
  const letter = (profile?.display_name || profile?.username || '?')[0]?.toUpperCase();
  if (profile?.avatar_url) return (
    <Image source={{ uri: profile.avatar_url }} style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: C.borderLight }} />
  );
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.accentSoft, borderWidth: 1.5, borderColor: C.accent + '50', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: C.accent, fontWeight: '800', fontSize: size * 0.38 }}>{letter}</Text>
    </View>
  );
}

// ─── Page Slide ───────────────────────────────────────────────────────────────
function PageSlide({ page }: { page: SlideItem }) {
  const srcW = SW - 48;
  const srcH = srcW * (16 / 9);
  const scale = SW / srcW;

  const photos   = (page.elements || []).filter((e: any) => e.type === 'photo' && e.url);
  const texts    = (page.elements || []).filter((e: any) => e.type === 'text');
  const stickers = (page.elements || []).filter((e: any) => e.type === 'sticker');

  return (
    <View style={{ width: SW, height: CONTENT_H, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: srcW, height: srcH, backgroundColor: page.bgColor || '#FFF8F0', overflow: 'hidden', transform: [{ scale }] }}>
        {page.bgPhotoUrl && (
          <Image source={{ uri: page.bgPhotoUrl }} style={{ position: 'absolute', width: srcW, height: srcH }} resizeMode="cover" />
        )}
        {(page.bgDim ?? 0) > 0 && (
          <View style={{ position: 'absolute', width: srcW, height: srcH, backgroundColor: `rgba(0,0,0,${page.bgDim ?? 0})` }} />
        )}
        {photos.map((el: any) => (
          <Image key={el.id} source={{ uri: el.url }} style={{
            position: 'absolute', left: el.x ?? 20, top: el.y ?? 60,
            width: el.w ?? srcW * 0.8, height: el.h ?? 300,
            transform: [{ rotate: `${el.rotation ?? 0}deg` }],
          }} resizeMode="cover" />
        ))}
        {texts.map((el: any) => (
          <Text key={el.id} style={{
            position: 'absolute', left: el.x ?? 20, top: el.y ?? 20,
            color: el.color || '#1A1118', fontSize: el.fontSize || 18,
            fontWeight: el.bold ? '700' : '400', fontStyle: el.italic ? 'italic' : 'normal',
            fontFamily: el.fontFamily && el.fontFamily !== 'System' ? el.fontFamily : undefined,
            maxWidth: srcW - 40, transform: [{ rotate: `${el.rotation ?? 0}deg` }],
          }}>{el.text}</Text>
        ))}
        {stickers.map((el: any) => (
          <Text key={el.id} style={{
            position: 'absolute', left: el.x ?? 60, top: el.y ?? 60,
            fontSize: (el.w ?? 60) * 0.75,
            transform: [{ rotate: `${el.rotation ?? 0}deg` }],
          }}>{el.emoji}</Text>
        ))}
      </View>
    </View>
  );
}

// ─── Content Filter Dropdown ──────────────────────────────────────────────────
function ContentFilterDropdown({ value, onChange }: { value: ContentFilter; onChange: (v: ContentFilter) => void }) {
  const C = useSocialColors();
  const st = makeStyles(C);
  const [open, setOpen] = useState(false);
  const OPTIONS: { key: ContentFilter; label: string; emoji: string }[] = [
    { key: 'all',       label: 'All',        emoji: '✦' },
    { key: 'scrapbook', label: 'Scrapbooks', emoji: '📖' },
    { key: 'capsule',   label: 'Trips',      emoji: '✈️' },
  ];
  const current = OPTIONS.find(o => o.key === value)!;

  return (
    <>
      <TouchableOpacity style={st.dropdownBtn} onPress={() => { Haptics.selectionAsync(); setOpen(true); }}>
        <Text style={st.dropdownBtnText}>{current.emoji} {current.label}</Text>
        <Text style={{ color: C.textMuted, fontSize: 10 }}>▾</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={st.dropdownMenu}>
            <Text style={st.dropdownMenuTitle}>Show</Text>
            {OPTIONS.map(opt => (
              <TouchableOpacity key={opt.key}
                style={[st.dropdownItem, value === opt.key && st.dropdownItemActive]}
                onPress={() => { Haptics.selectionAsync(); onChange(opt.key); setOpen(false); }}>
                <Text style={{ fontSize: 20 }}>{opt.emoji}</Text>
                <Text style={[st.dropdownItemText, value === opt.key && { color: C.accent }]}>{opt.label}</Text>
                {value === opt.key && <Text style={{ color: C.accent }}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ─── Comments Sheet ───────────────────────────────────────────────────────────
function CommentsSheet({ post, currentUserId, onClose, onCountChange }: {
  post: SocialPost; currentUserId: string; onClose: () => void;
  onCountChange?: (postId: string, delta: number) => void;
}) {
  const C = useSocialColors();
  const st = makeStyles(C);
  const insets = useSafeAreaInsets();
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const slideAnim = useRef(new Animated.Value(SH)).current;

  useEffect(() => {
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start();
    loadComments();
  }, []);

  const loadComments = async () => {
    const { data } = await supabase.from('social_comments').select('*').eq('post_id', post.id).order('created_at', { ascending: true });
    if (!data?.length) { setComments([]); setLoaded(true); return; }
    const userIds = [...new Set(data.map((c: any) => c.user_id))];
    const { data: profiles } = await supabase.from('social_profiles').select('*').in('id', userIds);
    const pMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));
    setComments(data.map((c: any) => ({ ...c, profile: pMap[c.user_id] })));
    setLoaded(true);
  };

  const handlePost = async () => {
    if (!safeString(commentText).trim()) return;
    const text = safeString(commentText).trim(); setCommentText(''); setPosting(true);
    const { data } = await supabase.from('social_comments').insert({ post_id: post.id, user_id: currentUserId, content: text }).select().single();
    if (data) {
      const { data: profile } = await supabase.from('social_profiles').select('*').eq('id', currentUserId).maybeSingle();
      setComments(prev => [...prev, { ...data, profile }]);
      onCountChange?.(post.id, 1);
    }
    setPosting(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const doClose = () => Animated.timing(slideAnim, { toValue: SH, duration: 260, useNativeDriver: true }).start(onClose);

  return (
    <Modal visible animationType="none" transparent onRequestClose={doClose}>
      <View style={{ flex: 1 }} pointerEvents="box-none">
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={doClose} />
        <Animated.View style={[st.commentsSheet, { paddingBottom: insets.bottom + 8, transform: [{ translateY: slideAnim }] }]}>
          <View style={st.sheetHandle} />
          <Text style={st.commentsTitle}>Comments {comments.length > 0 ? `(${comments.length})` : ''}</Text>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <FlatList
              data={comments}
              keyExtractor={c => c.id}
              contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
              ListEmptyComponent={
                loaded
                  ? <Text style={st.noCommentsText}>No comments yet — be first ✨</Text>
                  : <ActivityIndicator color={C.accent} style={{ marginTop: 24 }} />
              }
              renderItem={({ item: c }) => (
                <TouchableOpacity
                  onLongPress={() => {
                    if (c.user_id !== currentUserId) return;
                    Alert.alert('Delete comment?', '', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: async () => {
                        await supabase.from('social_comments').delete().eq('id', c.id);
                        setComments(prev => prev.filter(x => x.id !== c.id));
                        onCountChange?.(post.id, -1);
                      }},
                    ]);
                  }}
                  style={st.commentRow}
                  activeOpacity={0.85}
                >
                  <Avatar profile={c.profile} size={30} />
                  <View style={st.commentBubble}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={st.commentAuthor}>{c.profile?.display_name || c.profile?.username || 'User'}</Text>
                      <Text style={st.commentTime}>{fmt(c.created_at)}</Text>
                    </View>
                    <Text style={st.commentText}>{c.content}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
            <View style={st.commentInputRow}>
              <TextInput style={st.commentInputField} value={commentText} onChangeText={setCommentText}
                placeholder="Add a comment..." placeholderTextColor={C.textMuted} multiline maxLength={280} />
              <TouchableOpacity onPress={handlePost} disabled={!commentText.trim() || posting}
                style={[st.commentSendBtn, (!commentText.trim() || posting) && { opacity: 0.4 }]}>
                {posting ? <ActivityIndicator color={C.bg} size="small" /> : <Text style={st.commentSendText}>↑</Text>}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Music Picker Sheet ───────────────────────────────────────────────────────
function MusicPickerSheet({ visible, existingMusicUrl, existingMusicName, onSelect, onClose }: {
  visible: boolean; existingMusicUrl?: string | null; existingMusicName?: string | null;
  onSelect: (url: string, name: string) => void; onClose: () => void;
}) {
  const C = useSocialColors();
  const st = makeStyles(C);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=10`);
      const json = await res.json();
      setResults(json.results ?? []);
    } catch { Alert.alert('Search failed'); }
    setSearching(false);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={st.modalHeader}>
          <TouchableOpacity onPress={onClose}><Text style={st.modalCancel}>Cancel</Text></TouchableOpacity>
          <Text style={st.modalTitle}>Choose Music</Text>
          <View style={{ width: 60 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
          {existingMusicUrl && (
            <>
              <Text style={[st.fieldLabel, { marginBottom: 10 }]}>From your scrapbook</Text>
              <TouchableOpacity style={[st.itemRow, { marginBottom: 20, borderColor: C.accent }]}
                onPress={() => { onSelect(existingMusicUrl, existingMusicName || 'Scrapbook music'); onClose(); }}>
                <View style={[st.itemThumb, { backgroundColor: C.accentSoft }]}><Text style={{ fontSize: 22 }}>🎵</Text></View>
                <Text style={st.itemName}>{existingMusicName || 'Scrapbook music'}</Text>
                <Text style={{ color: C.accent }}>Use ›</Text>
              </TouchableOpacity>
            </>
          )}
          <Text style={st.fieldLabel}>Search for a song</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            <TextInput style={[st.input, { flex: 1 }]} value={query} onChangeText={setQuery}
              placeholder="Artist or song name..." placeholderTextColor={C.textMuted}
              returnKeyType="search" onSubmitEditing={search} />
            <TouchableOpacity style={[st.primaryBtn, { paddingHorizontal: 18, paddingVertical: 0, justifyContent: 'center', marginTop: 0, minWidth: 56 }]} onPress={search}>
              <Text style={st.primaryBtnText}>{searching ? '…' : 'Go'}</Text>
            </TouchableOpacity>
          </View>
          {results.map(r => (
            <TouchableOpacity key={r.trackId} style={[st.itemRow, { marginBottom: 8 }]}
              onPress={() => {
                if (!r.previewUrl) { Alert.alert('No preview available for this track'); return; }
                onSelect(r.previewUrl, `${r.trackName} — ${r.artistName}`);
                onClose();
              }}>
              {r.artworkUrl60 && <Image source={{ uri: r.artworkUrl60 }} style={{ width: 44, height: 44, borderRadius: 8 }} />}
              <View style={{ flex: 1 }}>
                <Text style={st.itemName} numberOfLines={1}>{r.trackName}</Text>
                <Text style={{ fontSize: 12, color: C.textMuted }}>{r.artistName}</Text>
                {!r.previewUrl && <Text style={{ fontSize: 10, color: C.danger }}>No preview</Text>}
              </View>
              <Text style={{ color: C.accent, fontSize: 18 }}>+</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Video Slide ──────────────────────────────────────────────────────────────
function VideoSlide({ url, musicPlayer, contentH, onDoubleTap }: {
  url: string; musicPlayer: any; contentH: number; onDoubleTap: () => void;
}) {
  const C = useSocialColors();
  const [paused, setPaused] = useState(false);
  const lastTapRef = useRef(0);
  const player = useVideoPlayer({ uri: url }, p => {
    p.loop = true;
    p.play();
  });

  useEffect(() => {
    const sub = player.addListener('playingChange', ({ isPlaying }: { isPlaying: boolean }) => {
      if (musicPlayer) {
        try { musicPlayer.volume = isPlaying ? 0.15 : 0.5; } catch {}
      }
    });
    return () => sub.remove();
  }, [player, musicPlayer]);

  const handleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      onDoubleTap();
    } else {
      try {
        if (paused) {
          player.play(); setPaused(false);
          if (musicPlayer) try { musicPlayer.volume = 0.15; musicPlayer.play(); } catch {}
        } else {
          player.pause(); setPaused(true);
          if (musicPlayer) try { musicPlayer.pause(); } catch {}
        }
      } catch {}
    }
    lastTapRef.current = now;
  };

  return (
    <View style={{ width: SW, height: contentH, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <VideoView player={player} style={{ width: SW, height: contentH }} contentFit="contain" nativeControls={false} />
      <TouchableOpacity activeOpacity={1} style={{ position: 'absolute', top: 0, left: 0, right: 80, bottom: 100 }} onPress={handleTap} />
      {paused && (
        <View pointerEvents="none" style={{ position: 'absolute', width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 26, marginLeft: 4 }}>▶</Text>
        </View>
      )}
    </View>
  );
}

// Module-level audio ref removed — using AudioManager context instead

// ─── TikTok Slide ─────────────────────────────────────────────────────────────
function TikTokSlide({ post, isActive, isVisible, currentUserId, onLike, onFavourite, onSaveSong, onComment, onProfilePress, onDeletePost, onReport }: {
  post: SocialPost; isActive: boolean; isVisible: boolean; currentUserId: string;
  onLike: (id: string, liked: boolean) => void;
  onFavourite: (id: string, faved: boolean) => void;
  onSaveSong: (post: SocialPost) => void;
  onComment: (post: SocialPost) => void;
  onProfilePress: (p: SocialProfile) => void;
  onDeletePost: (id: string) => void;
  onReport: (postId: string) => void;
}) {
  const C = useSocialColors();
  const st = makeStyles(C);
  const insets = useSafeAreaInsets();
  const { setActiveId } = useAudioManager();
  const [slides, setSlides] = useState<SlideItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [slideIndex, setSlideIndex] = useState(0);
  const [menuVisible, setMenuVisible] = useState(false);
  const innerRef = useRef<FlatList>(null);
  const heartAnim = useRef(new Animated.Value(1)).current;
  const starAnim = useRef(new Animated.Value(1)).current;
  const doubleTapAnim = useRef(new Animated.Value(0)).current;
  const musicSpinAnim = useRef(new Animated.Value(0)).current;
  const lastTapRef = useRef(0);

  const audioPlayer = useAudioPlayer(
    isVisible && post.music_url ? { uri: post.music_url } : null
  );

  useEffect(() => {
    if (!audioPlayer || !post.music_url) return;
    try {
      audioPlayer.loop = true;
      if (isActive) {
        audioPlayer.volume = 0.5;
        audioPlayer.play();
        setActiveId(post.music_url);
        startSpinning();
      } else {
        audioPlayer.volume = 0;
        audioPlayer.play();
        musicSpinAnim.stopAnimation();
      }
    } catch {}
    return () => { try { audioPlayer.pause(); } catch {} };
  }, [isActive, audioPlayer]);

  function startSpinning() {
    musicSpinAnim.setValue(0);
    Animated.loop(Animated.timing(musicSpinAnim, { toValue: 1, duration: 4000, useNativeDriver: true })).start();
  }

  const loadSlides = async () => {
    setLoading(true);
    try {
      if (post.type === 'scrapbook') {
        const { data } = await supabase.from('scrapbook_entries').select('*').eq('scrapbook_id', post.reference_id).order('created_at', { ascending: true });
        setSlides((data ?? []).map((p: any) => ({
          id: p.id, type: 'page' as const, bgColor: p.bg_color, bgPhotoUrl: p.bg_photo_url,
          elements: typeof p.elements === 'string' ? JSON.parse(p.elements || '[]') : (p.elements || []),
        })));
      } else {
        const { data } = await supabase.from('travel_capsule_media').select('*').eq('capsule_id', post.reference_id).order('created_at', { ascending: true });
        setSlides((data ?? []).map((m: any) => ({ id: m.id, type: m.type === 'video' ? 'video' : 'photo', url: m.url })));
      }
    } finally { setLoading(false); }
  };

  const handleDoubleTap = () => {
    if (!post.liked_by_me) {
      onLike(post.id, true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      Animated.sequence([
        Animated.spring(doubleTapAnim, { toValue: 1, useNativeDriver: true, tension: 200 }),
        Animated.delay(700),
        Animated.timing(doubleTapAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }
  };

  useEffect(() => { if (isVisible && slides.length === 0) loadSlides(); }, [isVisible]);
  useEffect(() => { if (slides.length === 0) loadSlides(); }, []);
  useEffect(() => {
    if (!isActive) { setSlideIndex(0); innerRef.current?.scrollToOffset({ offset: 0, animated: false }); }
  }, [isActive]);

  const handleLike = () => {
    Animated.sequence([
      Animated.spring(heartAnim, { toValue: 1.5, useNativeDriver: true, tension: 300 }),
      Animated.spring(heartAnim, { toValue: 1, useNativeDriver: true, tension: 300 }),
    ]).start();
    onLike(post.id, !post.liked_by_me);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleFavourite = () => {
    Animated.sequence([
      Animated.spring(starAnim, { toValue: 1.5, useNativeDriver: true, tension: 300 }),
      Animated.spring(starAnim, { toValue: 1, useNativeDriver: true, tension: 300 }),
    ]).start();
    onFavourite(post.id, !post.favourited_by_me);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const isScrapbook = post.type === 'scrapbook';
  const totalSlides = slides.length;
  const musicSpin = musicSpinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const tapZone = (
    <TouchableOpacity
      activeOpacity={1}
      style={{ position: 'absolute', top: 0, left: 0, right: 80, bottom: 100 }}
      onPress={() => {
        const now = Date.now();
        if (now - lastTapRef.current < 280) handleDoubleTap();
        lastTapRef.current = now;
      }}
    />
  );

  const renderInnerSlide = ({ item }: { item: SlideItem }) => {
    if (item.type === 'page') return (
      <View style={{ width: SW, height: CONTENT_H }}>
        <PageSlide page={item} />
        {tapZone}
      </View>
    );
    if (item.type === 'video' && item.url) {
      if (!isActive) return (
        <View style={{ width: SW, height: CONTENT_H, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 48, opacity: 0.4 }}>▶</Text>
          {tapZone}
        </View>
      );
      return <VideoSlide url={item.url} musicPlayer={audioPlayer} contentH={CONTENT_H} onDoubleTap={handleDoubleTap} />;
    }
    if (item.type === 'photo' && item.url) return (
      <View style={{ width: SW, height: CONTENT_H, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <Image source={{ uri: item.url }} style={{ width: SW, height: CONTENT_H }} resizeMode="contain" />
        {tapZone}
      </View>
    );
    return <View style={{ width: SW, height: CONTENT_H, backgroundColor: '#000' }}>{tapZone}</View>;
  };

  return (
    <View style={{ width: SW, height: SH, backgroundColor: '#111' }}>
      <View style={{ height: 52, backgroundColor: '#000' }} />
      <View style={{ width: SW, height: CONTENT_H, overflow: 'hidden', backgroundColor: '#000' }}>
        {loading || slides.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {post.thumbnail_url
              ? <Image source={{ uri: post.thumbnail_url }} style={{ position: 'absolute', width: SW, height: CONTENT_H }} resizeMode="cover" />
              : <Text style={{ fontSize: 72, opacity: 0.25 }}>{isScrapbook ? '📖' : '✈️'}</Text>
            }
            {loading && <ActivityIndicator color={C.accent} style={{ position: 'absolute' }} />}
          </View>
        ) : (
          <FlatList
            ref={innerRef}
            data={slides}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={s => s.id}
            windowSize={3}
            initialNumToRender={2}
            maxToRenderPerBatch={2}
            removeClippedSubviews={false}
            getItemLayout={(_, i) => ({ length: SW, offset: SW * i, index: i })}
            onMomentumScrollEnd={e => setSlideIndex(Math.round(e.nativeEvent.contentOffset.x / SW))}
            renderItem={renderInnerSlide}
            style={{ flex: 1 }}
          />
        )}

        {/* Double-tap heart */}
        <Animated.View pointerEvents="none"
          style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center', zIndex: 20 }, {
            opacity: doubleTapAnim,
            transform: [{ scale: doubleTapAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.3, 1.4, 1] }) }],
          }]}>
          <Text style={{ fontSize: 90, color: C.danger }}>♥</Text>
        </Animated.View>

        {/* Slide dots */}
        {totalSlides > 1 && totalSlides <= 16 && (
          <View style={[st.dotRow, { bottom: 10 }]}>
            {slides.map((_, i) => (
              <View key={i} style={[st.dot, i === slideIndex && st.dotActive]} />
            ))}
          </View>
        )}

        {/* Right actions */}
        <View style={[st.postActions, { bottom: 12 }]}>
          <TouchableOpacity style={st.actionBtn} onPress={handleLike}>
            <View style={st.actionIconWrap}>
              <Animated.Text style={[st.actionIcon, { transform: [{ scale: heartAnim }], color: post.liked_by_me ? C.danger : C.white }]}>
                {post.liked_by_me ? '♥' : '♡'}
              </Animated.Text>
            </View>
            <Text style={st.actionCount}>{post.like_count ?? 0}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={st.actionBtn} onPress={() => onComment(post)}>
            <View style={st.actionIconWrap}>
              <Text style={{ fontSize: 24, color: C.white, lineHeight: 28 }}>💬</Text>
            </View>
            <Text style={st.actionCount}>{post.comment_count ?? 0}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={st.actionBtn} onPress={handleFavourite}>
            <View style={[st.actionIconWrap, post.favourited_by_me && { backgroundColor: 'rgba(255,215,0,0.25)' }]}>
              <Animated.Text style={[st.actionIcon, { fontSize: 24, transform: [{ scale: starAnim }], color: post.favourited_by_me ? C.gold : C.white }]}>
                {post.favourited_by_me ? '★' : '☆'}
              </Animated.Text>
            </View>
            <Text style={[st.actionCount, post.favourited_by_me && { color: C.gold }]}>
              {post.favourited_by_me ? 'Saved' : 'Save'}
            </Text>
          </TouchableOpacity>

          {post.music_url && (
            <TouchableOpacity style={st.actionBtn} onPress={() => onSaveSong(post)}>
              <Animated.View style={[st.musicDisc, { transform: [{ rotate: musicSpin }] }]}>
                <Text style={{ fontSize: 16 }}>🎵</Text>
              </Animated.View>
              <Text style={st.actionCount}>Song</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={st.actionBtn} onPress={() => setMenuVisible(true)}>
            <View style={st.actionIconWrap}>
              <Text style={[st.actionIcon, { fontSize: 18, letterSpacing: 1 }]}>···</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Info bar below content */}
      <View style={{ paddingHorizontal: 14, paddingTop: 10, paddingRight: 70, flex: 1 }} pointerEvents="box-none">
        <TouchableOpacity onPress={() => post.profile && onProfilePress(post.profile)} style={st.postInfoAuthor}>
          <Avatar profile={post.profile} size={32} />
          <View style={{ flex: 1 }}>
            <Text style={st.postInfoName}>{post.profile?.display_name || post.profile?.username || 'User'}</Text>
            <Text style={st.postInfoHandle}>@{post.profile?.username} · {fmt(post.created_at)}</Text>
          </View>
          {/* Privacy badge */}
          {post.profile?.privacy && post.profile.privacy !== 'public' && (
            <View style={{ backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 6 }}>
              <Text style={{ color: '#fff', fontSize: 10 }}>
                {post.profile.privacy === 'followers' ? '👥 Followers' : '🔒 Friends'}
              </Text>
            </View>
          )}
        </TouchableOpacity>
        {post.title && <Text style={[st.postInfoTitle, { marginTop: 4, color: C.textPrimary }]} numberOfLines={1}>{post.title}</Text>}
        {post.caption && <Text style={[st.postInfoCaption, { color: C.textSecondary }]} numberOfLines={3}>{post.caption}</Text>}
      </View>

      {/* ··· Options menu */}
      {menuVisible && (
        <Modal visible animationType="fade" transparent onRequestClose={() => setMenuVisible(false)}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} activeOpacity={1} onPress={() => setMenuVisible(false)}>
            <View style={st.menuSheet}>
              <View style={st.sheetHandle} />
              {post.user_id === currentUserId ? (
                <TouchableOpacity style={st.menuItem} onPress={() => {
                  setMenuVisible(false);
                  Alert.alert('Delete post?', 'This removes it from the feed permanently.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => onDeletePost(post.id) },
                  ]);
                }}>
                  <Text style={{ fontSize: 20 }}>🗑</Text>
                  <Text style={[st.menuItemText, { color: C.danger }]}>Delete post</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={st.menuItem} onPress={() => {
                  setMenuVisible(false);
                  Alert.alert('Report post', 'What\'s the issue?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Spam', onPress: () => onReport(post.id) },
                    { text: 'Inappropriate content', onPress: () => onReport(post.id) },
                    { text: 'Harassment', onPress: () => onReport(post.id) },
                  ]);
                }}>
                  <Text style={{ fontSize: 20 }}>🚩</Text>
                  <Text style={st.menuItemText}>Report post</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={st.menuItem} onPress={() => setMenuVisible(false)}>
                <Text style={{ fontSize: 20 }}>✕</Text>
                <Text style={[st.menuItemText, { color: C.textMuted }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
}

// ─── TikTok Feed Viewer ───────────────────────────────────────────────────────
function TikTokFeedViewer({ posts: initialPosts, startIndex, currentUserId, onClose, onLike, onFavourite, onSaveSong, onProfilePress, onDeletePost, onReport }: {
  posts: SocialPost[]; startIndex: number; currentUserId: string;
  onClose: () => void; onLike: (id: string, liked: boolean) => void;
  onFavourite: (id: string, faved: boolean) => void;
  onSaveSong: (post: SocialPost) => void;
  onProfilePress: (p: SocialProfile) => void;
  onDeletePost: (id: string) => void;
  onReport: (postId: string) => void;
}) {
  const C = useSocialColors();
  const st = makeStyles(C);
  const [posts, setPosts] = useState(initialPosts);
  const [activeIndex, setActiveIndex] = useState(startIndex);
  const [commentPost, setCommentPost] = useState<SocialPost | null>(null);
  const flatRef = useRef<FlatList>(null);

  useEffect(() => {
    setTimeout(() => flatRef.current?.scrollToIndex({ index: startIndex, animated: false }), 50);
  }, []);

  const handleLikeInner = (id: string, liked: boolean) => {
    setPosts(prev => prev.map(p => p.id === id
      ? { ...p, liked_by_me: liked, like_count: Math.max(0, (p.like_count ?? 0) + (liked ? 1 : -1)) }
      : p
    ));
    onLike(id, liked);
  };

  const handleFavouriteInner = (id: string, faved: boolean) => {
    setPosts(prev => prev.map(p => p.id === id ? { ...p, favourited_by_me: faved } : p));
    onFavourite(id, faved);
  };

  const handleDelete = (id: string) => {
    onDeletePost(id);
    const remaining = posts.filter(p => p.id !== id);
    if (remaining.length === 0) { onClose(); return; }
    setPosts(remaining);
    setActiveIndex(prev => Math.min(prev, remaining.length - 1));
  };

  const handleCommentCount = (postId: string, delta: number) => {
    setPosts(prev => prev.map(p => p.id === postId
      ? { ...p, comment_count: Math.max(0, (p.comment_count ?? 0) + delta) }
      : p
    ));
  };

  return (
    <Modal visible animationType="fade" transparent={false} onRequestClose={onClose}>
      <StatusBar hidden />
      {commentPost && <CommentsSheet post={commentPost} currentUserId={currentUserId} onClose={() => setCommentPost(null)} onCountChange={handleCommentCount} />}
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <TouchableOpacity style={st.closeBtn} onPress={onClose}>
          <Text style={st.closeBtnText}>✕</Text>
        </TouchableOpacity>
        <FlatList
          ref={flatRef}
          data={posts}
          keyExtractor={p => p.id}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          snapToInterval={SH}
          decelerationRate="fast"
          windowSize={5}
          initialNumToRender={1}
          maxToRenderPerBatch={1}
          removeClippedSubviews={false}
          getItemLayout={(_, i) => ({ length: SH, offset: SH * i, index: i })}
          initialScrollIndex={startIndex}
          onMomentumScrollEnd={e => {
            const idx = Math.round(e.nativeEvent.contentOffset.y / SH);
            setActiveIndex(idx);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
          renderItem={({ item, index }) => (
            <TikTokSlide
              post={item}
              isActive={index === activeIndex}
              isVisible={Math.abs(index - activeIndex) <= 2}
              currentUserId={currentUserId}
              onLike={handleLikeInner}
              onFavourite={handleFavouriteInner}
              onSaveSong={onSaveSong}
              onComment={setCommentPost}
              onProfilePress={onProfilePress}
              onDeletePost={handleDelete}
              onReport={onReport}
            />
          )}
        />
      </View>
    </Modal>
  );
}

// ─── Post Card ────────────────────────────────────────────────────────────────
function PostCard({ post, onPress }: { post: SocialPost; onPress: () => void }) {
  const C = useSocialColors();
  const st = makeStyles(C);
  const scale = useRef(new Animated.Value(1)).current;
  const isScrapbook = post.type === 'scrapbook';
  const seed = post.id.charCodeAt(0) + post.id.charCodeAt(1);
  const imgH = 140 + (seed % 80);

  return (
    <Animated.View style={[st.postCard, { transform: [{ scale }], marginBottom: 10 }]}>
      <TouchableOpacity activeOpacity={1} onPress={onPress}
        onPressIn={() => Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, tension: 300, friction: 20 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 20 }).start()}>
        <View style={[st.postThumb, { height: imgH }]}>
          {post.thumbnail_url
            ? <Image source={{ uri: post.thumbnail_url }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
            : <View style={[StyleSheet.absoluteFillObject, { backgroundColor: isScrapbook ? C.purpleSoft : C.greenSoft, alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ fontSize: 36, opacity: 0.5 }}>{isScrapbook ? '📖' : '✈️'}</Text>
              </View>
          }
          <View style={[st.typeBadge, { backgroundColor: isScrapbook ? C.purple : C.green }]}>
            <Text style={st.typeBadgeText}>{isScrapbook ? '📖' : '✈️'}</Text>
          </View>
          {/* Privacy badge on card */}
          {post.profile?.privacy && post.profile.privacy !== 'public' && (
            <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}>
              <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>
                {post.profile.privacy === 'followers' ? '👥' : '🔒'}
              </Text>
            </View>
          )}
          <View style={st.playIndicator}>
            <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 9, fontWeight: '700' }}>▶ PLAY</Text>
          </View>
        </View>
        <View style={st.postContent}>
          {post.title && <Text style={st.postTitle} numberOfLines={2}>{post.title}</Text>}
          {post.caption && <Text style={st.postCaption} numberOfLines={1}>{post.caption}</Text>}
          <View style={st.postFooter}>
            <Avatar profile={post.profile} size={14} />
            <Text style={st.postAuthorName} numberOfLines={1}>{post.profile?.display_name || post.profile?.username || 'User'}</Text>
            <Text style={{ fontSize: 10, color: post.liked_by_me ? C.danger : C.textMuted }}>{post.liked_by_me ? '♥' : '♡'} {post.like_count ?? 0}</Text>
            {post.favourited_by_me && <Text style={{ fontSize: 10, color: C.gold }}>★</Text>}
            {post.music_url && <Text style={{ fontSize: 10 }}>🎵</Text>}
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Saved Song Card ──────────────────────────────────────────────────────────
function SavedSongCard({ song, isPlaying, onPlay, onPause, onDelete }: {
  song: SavedSong; isPlaying: boolean;
  onPlay: () => void; onPause: () => void; onDelete: () => void;
}) {
  const C = useSocialColors();
  const st = makeStyles(C);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (isPlaying) {
      spinLoop.current = Animated.loop(Animated.timing(spinAnim, { toValue: 1, duration: 3000, useNativeDriver: true }));
      spinLoop.current.start();
    } else {
      spinLoop.current?.stop();
      spinAnim.setValue(0);
    }
  }, [isPlaying]);

  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <TouchableOpacity style={[st.songCard, isPlaying && { borderColor: C.accent, backgroundColor: C.accentSoft }]}
      onLongPress={onDelete} activeOpacity={0.85}>
      <Animated.View style={[st.songCardDisc, { backgroundColor: isPlaying ? C.accent + '30' : C.accentSoft, transform: [{ rotate: spin }] }]}>
        <Text style={{ fontSize: 22 }}>🎵</Text>
      </Animated.View>
      <View style={{ flex: 1 }}>
        <Text style={[st.songCardName, isPlaying && { color: C.accent }]} numberOfLines={1}>{song.music_name}</Text>
        <Text style={{ fontSize: 11, color: C.textMuted }}>{isPlaying ? 'Now playing' : 'Tap to play'} · hold to remove</Text>
      </View>
      <TouchableOpacity onPress={isPlaying ? onPause : onPlay} style={[st.songCardPlay, isPlaying && { backgroundColor: C.accent + '30' }]}>
        <Text style={{ color: C.accent, fontSize: 18 }}>{isPlaying ? '⏸' : '▶'}</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── Profile View ─────────────────────────────────────────────────────────────
function ProfileView({ profile, currentUserId, isOwnProfile, onBack, onFollowChange, onPostPress }: {
  profile: SocialProfile; currentUserId: string; isOwnProfile: boolean;
  onBack: () => void; onFollowChange?: () => void;
  onPostPress: (posts: SocialPost[], index: number) => void;
}) {
  const C = useSocialColors();
  const st = makeStyles(C);
  const [profileTab, setProfileTab] = useState<ProfileTab>('posts');
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [savedPosts, setSavedPosts] = useState<SocialPost[]>([]);
  const [savedSongs, setSavedSongs] = useState<SavedSong[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [counts, setCounts] = useState({ followers: 0, following: 0, posts: 0 });
  const [loading, setLoading] = useState(true);
  const [playingSongId, setPlayingSongId] = useState<string | null>(null);
  const [playingSongUrl, setPlayingSongUrl] = useState<string | null>(null);
  const songPlayer = useAudioPlayer(playingSongUrl ? { uri: playingSongUrl } : null);

  useEffect(() => {
    if (songPlayer && playingSongUrl) { songPlayer.loop = true; songPlayer.volume = 0.7; songPlayer.play(); }
  }, [songPlayer, playingSongUrl]);
  useEffect(() => { return () => { try { songPlayer?.pause(); } catch {} }; }, []);
  useEffect(() => { load(); }, [profile.id]);

  const load = async () => {
    setLoading(true);
    const [postsRes, followersRes, followingRes, followCheckRes] = await Promise.all([
      supabase.from('social_posts').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }),
      supabase.from('social_follows').select('*', { count: 'exact', head: true }).eq('following_id', profile.id),
      supabase.from('social_follows').select('*', { count: 'exact', head: true }).eq('follower_id', profile.id),
      supabase.from('social_follows').select('id').eq('follower_id', currentUserId).eq('following_id', profile.id).maybeSingle(),
    ]);
    const raw = postsRes.data ?? [];
    if (raw.length) {
      const [likesRes, commentsRes, favsRes] = await Promise.all([
        supabase.from('social_likes').select('post_id, user_id').in('post_id', raw.map((p: any) => p.id)),
        supabase.from('social_comments').select('post_id').in('post_id', raw.map((p: any) => p.id)),
        supabase.from('social_favourites').select('post_id').eq('user_id', currentUserId).in('post_id', raw.map((p: any) => p.id)),
      ]);
      setPosts(raw.map((p: any) => ({
        ...p, profile,
        like_count: (likesRes.data ?? []).filter((l: any) => l.post_id === p.id).length,
        liked_by_me: (likesRes.data ?? []).some((l: any) => l.post_id === p.id && l.user_id === currentUserId),
        comment_count: (commentsRes.data ?? []).filter((c: any) => c.post_id === p.id).length,
        favourited_by_me: (favsRes.data ?? []).some((f: any) => f.post_id === p.id),
      })));
    } else setPosts([]);

    if (isOwnProfile) {
      const { data: favData } = await supabase.from('social_favourites').select('post_id').eq('user_id', currentUserId);
      if (favData?.length) {
        const postIds = favData.map((f: any) => f.post_id);
        const { data: favPosts } = await supabase.from('social_posts').select('*').in('id', postIds);
        if (favPosts?.length) {
          const userIds = [...new Set(favPosts.map((p: any) => p.user_id))];
          const { data: profiles } = await supabase.from('social_profiles').select('*').in('id', userIds);
          const pMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));
          setSavedPosts(favPosts.map((p: any) => ({ ...p, profile: pMap[p.user_id], favourited_by_me: true })));
        }
      }
      const { data: songs } = await supabase.from('social_saved_songs').select('*').eq('user_id', currentUserId).order('created_at', { ascending: false });
      setSavedSongs((songs ?? []) as SavedSong[]);
    }

    setCounts({ followers: followersRes.count ?? 0, following: followingRes.count ?? 0, posts: raw.length });
    setIsFollowing(!!followCheckRes.data);
    setLoading(false);
  };

  const handleFollow = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isFollowing) {
      await supabase.from('social_follows').delete().eq('follower_id', currentUserId).eq('following_id', profile.id);
      setIsFollowing(false); setCounts(c => ({ ...c, followers: c.followers - 1 }));
    } else {
      await supabase.from('social_follows').insert({ follower_id: currentUserId, following_id: profile.id });
      setIsFollowing(true); setCounts(c => ({ ...c, followers: c.followers + 1 }));
    }
    onFollowChange?.();
  };

  function playSong(id: string, url: string) {
    if (playingSongId === id) { try { songPlayer?.pause(); } catch {}; setPlayingSongId(null); setPlayingSongUrl(null); return; }
    try { songPlayer?.pause(); } catch {};
    setPlayingSongUrl(url); setPlayingSongId(id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  const displayPosts = profileTab === 'posts' ? posts : savedPosts;
  const cols = [displayPosts.filter((_, i) => i % 2 === 0), displayPosts.filter((_, i) => i % 2 === 1)];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {!isOwnProfile && (
        <View style={st.profileHeader}>
          <TouchableOpacity onPress={onBack} style={{ padding: 8 }}><Text style={{ fontSize: 20, color: C.accent }}>‹</Text></TouchableOpacity>
          <Text style={st.profileHeaderTitle}>@{profile.username}</Text>
          <View style={{ width: 40 }} />
        </View>
      )}
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={st.profileHero}>
          <Avatar profile={profile} size={88} />
          <Text style={st.profileDisplayName}>{profile.display_name || profile.username}</Text>
          <Text style={st.profileUsername}>@{profile.username}</Text>
          {/* Privacy badge on profile */}
          {profile.privacy && profile.privacy !== 'public' && (
            <View style={{ backgroundColor: C.surfaceHigh, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: C.border }}>
              <Text style={{ color: C.textSecondary, fontSize: 12, fontWeight: '600' }}>
                {profile.privacy === 'followers' ? '👥 Followers only' : '🔒 Friends only'}
              </Text>
            </View>
          )}
          {profile.bio && <Text style={st.profileBio}>{profile.bio}</Text>}
          <View style={st.statsRow}>
            {[['Posts', counts.posts], ['Followers', counts.followers], ['Following', counts.following]].map(([label, val], i) => (
              <React.Fragment key={label as string}>
                {i > 0 && <View style={st.statDivider} />}
                <View style={st.statItem}><Text style={st.statNum}>{val}</Text><Text style={st.statLabel}>{label}</Text></View>
              </React.Fragment>
            ))}
          </View>
          {!isOwnProfile && (
            <TouchableOpacity style={[st.followBtn, isFollowing && st.followBtnActive]} onPress={handleFollow}>
              <Text style={[st.followBtnText, isFollowing && { color: C.accent }]}>{isFollowing ? '✓ Following' : '+ Follow'}</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={st.profileTabRow}>
          <TouchableOpacity style={[st.profileTabBtn, profileTab === 'posts' && st.profileTabBtnActive]}
            onPress={() => { Haptics.selectionAsync(); setProfileTab('posts'); }}>
            <Text style={{ fontSize: 15 }}>⊞</Text>
            <Text style={[st.profileTabLabel, profileTab === 'posts' && { color: C.accent }]}>Posts</Text>
          </TouchableOpacity>
          {isOwnProfile && (
            <TouchableOpacity style={[st.profileTabBtn, profileTab === 'saved' && st.profileTabBtnActive]}
              onPress={() => { Haptics.selectionAsync(); setProfileTab('saved'); }}>
              <Text style={{ fontSize: 15 }}>★</Text>
              <Text style={[st.profileTabLabel, profileTab === 'saved' && { color: C.gold }]}>Saved</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={C.accent} /></View>
        ) : profileTab === 'saved' ? (
          <View style={{ paddingBottom: 40 }}>
            {savedPosts.length > 0 && (
              <>
                <Text style={[st.fieldLabel, { paddingHorizontal: 16, marginTop: 16, marginBottom: 10 }]}>☆ Saved posts</Text>
                <View style={[st.masonryGrid, { paddingHorizontal: 12 }]}>
                  <View style={st.masonryCol}>{savedPosts.filter((_, i) => i % 2 === 0).map(p => <PostCard key={p.id} post={p} onPress={() => onPostPress(savedPosts, savedPosts.indexOf(p))} />)}</View>
                  <View style={st.masonryCol}>{savedPosts.filter((_, i) => i % 2 === 1).map(p => <PostCard key={p.id} post={p} onPress={() => onPostPress(savedPosts, savedPosts.indexOf(p))} />)}</View>
                </View>
              </>
            )}
            {savedSongs.length > 0 && (
              <>
                <Text style={[st.fieldLabel, { paddingHorizontal: 16, marginTop: 20, marginBottom: 10 }]}>🎵 Saved songs</Text>
                <View style={{ paddingHorizontal: 16, gap: 8 }}>
                  {savedSongs.map(s => (
                    <SavedSongCard key={s.id} song={s}
                      isPlaying={playingSongId === s.id}
                      onPlay={() => playSong(s.id, s.music_url)}
                      onPause={() => { try { songPlayer?.pause(); } catch {}; setPlayingSongId(null); setPlayingSongUrl(null); }}
                      onDelete={() => Alert.alert('Remove?', '', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => {
                        await supabase.from('social_saved_songs').delete().eq('id', s.id);
                        setSavedSongs(prev => prev.filter(x => x.id !== s.id));
                      }}])} />
                  ))}
                </View>
              </>
            )}
            {savedPosts.length === 0 && savedSongs.length === 0 && (
              <View style={st.emptyProfile}>
                <Text style={{ fontSize: 40 }}>☆</Text>
                <Text style={st.emptyProfileText}>Nothing saved yet</Text>
                <Text style={{ color: C.textMuted, fontSize: 13, textAlign: 'center', marginTop: 4 }}>Tap ★ on posts or 🎵 on songs to save them here</Text>
              </View>
            )}
          </View>
        ) : displayPosts.length === 0 ? (
          <View style={st.emptyProfile}>
            <Text style={{ fontSize: 40 }}>{isOwnProfile ? '📤' : '🔍'}</Text>
            <Text style={st.emptyProfileText}>{isOwnProfile ? 'Share your first creation!' : 'No posts yet'}</Text>
          </View>
        ) : (
          <View style={[st.masonryGrid, { paddingHorizontal: 12, paddingBottom: 40 }]}>
            {cols.map((col, ci) => (
              <View key={ci} style={st.masonryCol}>
                {col.map(p => <PostCard key={p.id} post={p} onPress={() => onPostPress(displayPosts, displayPosts.indexOf(p))} />)}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Share Modal ──────────────────────────────────────────────────────────────
function ShareToFeedModal({ visible, userId, canvasId, onClose, onShared }: {
  visible: boolean; userId: string; canvasId: string; onClose: () => void; onShared: () => void;
}) {
  const C = useSocialColors();
  const st = makeStyles(C);
  const [type, setType] = useState<'scrapbook' | 'capsule'>('scrapbook');
  const [step, setStep] = useState(0);
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState('');
  const [caption, setCaption] = useState('');
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(null);
  const [thumbnailFromPage, setThumbnailFromPage] = useState<string | null>(null);
  const [selectedPages, setSelectedPages] = useState<any[]>([]);
  const [musicUrl, setMusicUrl] = useState('');
  const [musicName, setMusicName] = useState('');
  const [showMusicPicker, setShowMusicPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => { if (visible) { loadItems(); setStep(0); } }, [visible, type]);

  const loadItems = async () => {
    setLoading(true); setSelected(''); setItems([]);
    setThumbnailUri(null); setThumbnailFromPage(null); setMusicUrl(''); setMusicName('');
    if (type === 'scrapbook') {
      const { data } = await supabase.from('scrapbooks').select('id, name, front_cover, bg_music_url, bg_music_name').eq('canvas_id', canvasId);
      const enriched = await Promise.all((data ?? []).map(async (d: any) => {
        const { data: pages } = await supabase.from('scrapbook_entries').select('id, bg_color, bg_photo_url, elements').eq('scrapbook_id', d.id).order('created_at', { ascending: true }).limit(6);
        return { id: d.id, name: d.name, pages: pages || [], frontCover: d.front_cover, musicUrl: d.bg_music_url, musicName: d.bg_music_name };
      }));
      setItems(enriched);
    } else {
      const { data } = await supabase.from('travel_capsules').select('id, name').eq('created_by', userId).eq('is_unlocked', true);
      const enriched = await Promise.all((data ?? []).map(async (d: any) => {
        const { data: media } = await supabase.from('travel_capsule_media').select('url').eq('capsule_id', d.id).eq('type', 'photo').order('created_at', { ascending: true }).limit(4);
        return { id: d.id, name: d.name, pages: (media ?? []).map((m: any, i: number) => ({ id: String(i), bgPhotoUrl: m.url, bg_color: '#000', elements: [] })) };
      }));
      setItems(enriched);
    }
    setLoading(false);
  };

  // ── Auto-populate thumbnail when item is selected ─────────────────────────
  const handleSelectItem = (item: any) => {
    setSelected(item.id);
    setSelectedPages(item.pages || []);
    if (item.musicUrl) { setMusicUrl(item.musicUrl); setMusicName(item.musicName || 'Scrapbook music'); }
    else { setMusicUrl(''); setMusicName(''); }
    setThumbnailUri(null);

    // Priority: front_cover photo → first page bg photo → first photo element
    let auto: string | null = null;
    if (item.frontCover?.bgPhotoUrl) {
      auto = item.frontCover.bgPhotoUrl;
    } else if (item.pages?.length) {
      const p0 = item.pages[0];
      if (p0?.bgPhotoUrl) {
        auto = p0.bgPhotoUrl;
      } else {
        const els: any[] = typeof p0?.elements === 'string'
          ? JSON.parse(p0.elements || '[]')
          : (p0?.elements || []);
        auto = els.find((e: any) => e.type === 'photo' && e.url)?.url ?? null;
      }
    }
    setThumbnailFromPage(auto);
  };

  const pickCustomThumb = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.85, allowsEditing: true, aspect: [9, 16] });
    if (!result.canceled) { setThumbnailUri(result.assets[0].uri); setThumbnailFromPage(null); }
  };

  const isColorThumb = (v: string | null) => v?.startsWith('color:') ?? false;

  const handleShare = async () => {
    if (!selected) { Alert.alert('Choose an item'); return; }
    if (!hasThumb) { Alert.alert('Choose a thumbnail', 'Pick a page or upload a custom image.'); return; }
    if (!musicUrl) { Alert.alert('Choose music', 'Add a song before sharing.'); return; }
    setSharing(true);

    // ── Resolve thumbnail ─────────────────────────────────────────────────────
    let thumbnail_url: string | null = null;
    if (thumbnailUri) {
      thumbnail_url = await uploadToStorage(thumbnailUri, `thumbnails/${userId}-${Date.now()}.jpg`);
    } else if (thumbnailFromPage && !isColorThumb(thumbnailFromPage)) {
      thumbnail_url = thumbnailFromPage;
    } else {
      // Fallback: grab from item data at share time
      const si = items.find(i => i.id === selected) as any;
      if (si?.frontCover?.bgPhotoUrl) {
        thumbnail_url = si.frontCover.bgPhotoUrl;
      } else if (si?.pages?.length) {
        const p0 = si.pages[0];
        if (p0?.bgPhotoUrl) {
          thumbnail_url = p0.bgPhotoUrl;
        } else {
          const els: any[] = typeof p0?.elements === 'string'
            ? JSON.parse(p0.elements || '[]')
            : (p0?.elements || []);
          thumbnail_url = els.find((e: any) => e.type === 'photo' && e.url)?.url ?? null;
        }
      }
    }

    const selectedItem = items.find(i => i.id === selected);
    await supabase.from('social_posts').insert({
      user_id: userId, type, reference_id: selected,
      caption: safeString(caption).trim() || null, thumbnail_url,
      title: selectedItem?.name ?? null, music_url: musicUrl || null, music_name: musicName || null,
    });
    setSharing(false); setCaption(''); setSelected(''); setThumbnailUri(null); setThumbnailFromPage(null); setMusicUrl(''); setMusicName('');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onShared(); onClose();
  };

  const selectedItem = items.find(i => i.id === selected) as any;
  const thumbPreview = thumbnailUri || (thumbnailFromPage && !isColorThumb(thumbnailFromPage) ? thumbnailFromPage : null);
  const hasThumb = !!thumbnailUri || !!thumbnailFromPage;
  const stepLabels = ['Pick', 'Thumbnail', 'Music', 'Caption'];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <MusicPickerSheet visible={showMusicPicker}
        existingMusicUrl={selectedItem?.musicUrl} existingMusicName={selectedItem?.musicName}
        onSelect={(url, name) => { setMusicUrl(url); setMusicName(name); }}
        onClose={() => setShowMusicPicker(false)} />
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={st.modalHeader}>
          <TouchableOpacity onPress={() => step === 0 ? onClose() : setStep(s => s - 1)}>
            <Text style={st.modalCancel}>{step === 0 ? 'Cancel' : '← Back'}</Text>
          </TouchableOpacity>
          <Text style={st.modalTitle}>Share · {stepLabels[step]}</Text>
          {step === 3 ? (
            <TouchableOpacity onPress={handleShare} disabled={sharing}>
              <Text style={[st.modalCancel, { color: C.accent }]}>{sharing ? '…' : 'Post'}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => {
              if (step === 0 && !selected) { Alert.alert('Select an item'); return; }
              if (step === 1 && !hasThumb) { Alert.alert('Choose a thumbnail'); return; }
              if (step === 2 && !musicUrl) { Alert.alert('Choose music'); return; }
              setStep(s => s + 1);
            }}>
              <Text style={[st.modalCancel, { color: C.accent }]}>Next →</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Progress bar */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 6, marginBottom: 8 }}>
          {stepLabels.map((_, i) => (
            <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= step ? C.accent : C.border }} />
          ))}
        </View>

        <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
          {step === 0 && (
            <>
              <View style={st.typeSelector}>
                {(['scrapbook', 'capsule'] as const).map(t => (
                  <TouchableOpacity key={t} style={[st.typeBtn, type === t && st.typeBtnActive]} onPress={() => { Haptics.selectionAsync(); setType(t); }}>
                    <Text style={{ fontSize: 24 }}>{t === 'scrapbook' ? '📖' : '✈️'}</Text>
                    <Text style={[st.typeBtnLabel, type === t && { color: C.accent }]}>{t === 'scrapbook' ? 'Scrapbook' : 'Trip'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {loading ? <ActivityIndicator color={C.accent} style={{ marginVertical: 20 }} /> :
                items.length === 0 ? <View style={st.emptyShare}><Text style={st.emptyShareText}>{type === 'capsule' ? 'No unlocked capsules' : 'No scrapbooks yet'}</Text></View> :
                  <View style={{ gap: 8 }}>
                    {items.map((item: any) => (
                      <TouchableOpacity key={item.id} style={[st.itemRow, selected === item.id && st.itemRowSelected]}
                        onPress={() => { Haptics.selectionAsync(); handleSelectItem(item); }}>
                        <View style={st.itemThumb}>
                          {/* Show front cover photo if available, else first page */}
                          {item.frontCover?.bgPhotoUrl || item.pages?.[0]?.bgPhotoUrl
                            ? <Image source={{ uri: item.frontCover?.bgPhotoUrl || item.pages[0].bgPhotoUrl }} style={{ width: '100%', height: '100%', borderRadius: 8 }} resizeMode="cover" />
                            : <Text style={{ fontSize: 20 }}>{type === 'scrapbook' ? '📖' : '✈️'}</Text>}
                        </View>
                        <Text style={st.itemName}>{item.name}</Text>
                        {selected === item.id && <Text style={{ color: C.accent, fontSize: 18 }}>✓</Text>}
                      </TouchableOpacity>
                    ))}
                  </View>
              }
            </>
          )}

          {step === 1 && (
            <>
              <Text style={st.stepHint}>Required — this is how your post looks in the feed.</Text>
              <TouchableOpacity style={[st.thumbActionBtn, { marginBottom: 16 }]} onPress={pickCustomThumb}>
                <Text style={st.thumbActionBtnText}>📷 Upload custom (9:16)</Text>
              </TouchableOpacity>
              {selectedPages.length > 0 && (
                <>
                  <Text style={[st.fieldLabel, { marginBottom: 10 }]}>Or pick a page</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
                    {selectedPages.map((page: any, idx: number) => {
                      const els = typeof page.elements === 'string' ? JSON.parse(page.elements || '[]') : (page.elements || []);
                      const pagePhoto = page.bgPhotoUrl || els.find((e: any) => e.type === 'photo' && e.url)?.url;
                      const bgColor = page.bg_color || '#FFF8F0';
                      const isSelected = !thumbnailUri && (
                        pagePhoto ? thumbnailFromPage === pagePhoto : thumbnailFromPage === `color:${bgColor}:${idx}`
                      );
                      return (
                        <TouchableOpacity key={page.id || idx}
                          style={[{ width: SW * 0.36, aspectRatio: 9 / 16, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: isSelected ? C.accent : C.border, backgroundColor: bgColor }]}
                          onPress={() => {
                            if (pagePhoto) { setThumbnailFromPage(pagePhoto); setThumbnailUri(null); }
                            else { setThumbnailFromPage(`color:${bgColor}:${idx}`); setThumbnailUri(null); }
                          }}>
                          {pagePhoto
                            ? <Image source={{ uri: pagePhoto }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                            : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: bgColor }}>
                                {els.filter((e: any) => e.type === 'text').slice(0, 3).map((e: any, ti: number) => (
                                  <Text key={ti} style={{ color: e.color || '#1A1118', fontSize: 9, textAlign: 'center', paddingHorizontal: 4 }} numberOfLines={2}>{e.text}</Text>
                                ))}
                                {els.filter((e: any) => e.type === 'sticker').slice(0, 2).map((e: any, si: number) => (
                                  <Text key={si} style={{ fontSize: 18 }}>{e.emoji}</Text>
                                ))}
                                {els.length === 0 && <Text style={{ fontSize: 18, opacity: 0.3 }}>📄</Text>}
                              </View>
                          }
                          <View style={{ position: 'absolute', bottom: 4, left: 0, right: 0, alignItems: 'center' }}>
                            <Text style={{ color: '#fff', fontSize: 9, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 4, borderRadius: 4 }}>Page {idx + 1}</Text>
                          </View>
                          {isSelected && <View style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 12 }}>✓</Text></View>}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </>
              )}
              {hasThumb && (
                <View style={{ alignItems: 'center', marginTop: 16 }}>
                  {thumbPreview
                    ? <Image source={{ uri: thumbPreview }} style={{ width: SW * 0.45, height: (SW * 0.45) * (16 / 9), borderRadius: 12, borderWidth: 1, borderColor: C.accent }} resizeMode="cover" />
                    : <View style={{ width: SW * 0.45, height: (SW * 0.45) * (16 / 9), borderRadius: 12, borderWidth: 1, borderColor: C.accent, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: C.textMuted, fontSize: 13 }}>Colour page selected</Text>
                      </View>
                  }
                  <Text style={{ color: C.textMuted, fontSize: 11, marginTop: 8 }}>Preview</Text>
                </View>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <Text style={st.stepHint}>Required — add a song to your post.</Text>
              {musicUrl ? (
                <View style={[st.itemRow, { marginBottom: 16, borderColor: C.accent }]}>
                  <View style={[st.itemThumb, { backgroundColor: C.accentSoft }]}><Text style={{ fontSize: 22 }}>🎵</Text></View>
                  <View style={{ flex: 1 }}><Text style={st.itemName} numberOfLines={1}>{musicName}</Text><Text style={{ fontSize: 11, color: C.textMuted }}>Tap to change</Text></View>
                  <TouchableOpacity onPress={() => setShowMusicPicker(true)}><Text style={{ color: C.accent, fontSize: 13 }}>Change</Text></TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={[st.primaryBtn, { marginBottom: 16 }]} onPress={() => setShowMusicPicker(true)}>
                  <Text style={st.primaryBtnText}>🎵 Choose a song</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <Text style={st.stepHint}>Almost done — add a caption (optional).</Text>
              {thumbPreview && (
                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16, alignItems: 'flex-start' }}>
                  <Image source={{ uri: thumbPreview }} style={{ width: 72, aspectRatio: 9 / 16, borderRadius: 8 }} resizeMode="cover" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.textPrimary, fontWeight: '700', fontSize: 14 }}>{selectedItem?.name}</Text>
                    {musicName && <Text style={{ color: C.textMuted, fontSize: 12, marginTop: 4 }}>🎵 {musicName}</Text>}
                  </View>
                </View>
              )}
              <TextInput style={[st.captionInput, { minHeight: 100 }]} value={caption} onChangeText={setCaption}
                placeholder="Say something..." placeholderTextColor={C.textMuted} multiline maxLength={280} autoFocus />
              <Text style={st.charCount}>{caption.length}/280</Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Setup Profile ────────────────────────────────────────────────────────────
function SetupProfileModal({ visible, userId, onComplete }: { visible: boolean; userId: string; onComplete: (p: SocialProfile) => void }) {
  const C = useSocialColors();
  const st = makeStyles(C);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const handleCreate = async () => {
    const uname = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!uname || uname.length < 3) { setErr('Min 3 characters'); return; }
    setLoading(true); setErr('');
    const { data: exists } = await supabase.from('social_profiles').select('id').eq('username', uname).maybeSingle();
    if (exists) { setErr('Username taken'); setLoading(false); return; }
    const { data, error } = await supabase.from('social_profiles').insert({
      id: userId, username: uname, display_name: displayName.trim() || uname,
      bio: bio.trim() || null, avatar_url: null, privacy: 'public',
    }).select().single();
    setLoading(false);
    if (error) { Alert.alert('Error', error.message); return; }
    onComplete(data as SocialProfile);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 28, paddingTop: 80 }} keyboardShouldPersistTaps="handled">
          <Text style={st.setupTitle}>Create your profile</Text>
          <Text style={st.setupSubtitle}>Join the Anchor community.</Text>
          <Text style={st.fieldLabel}>Username *</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Text style={{ fontSize: 18, fontWeight: '600', color: C.textMuted }}>@</Text>
            <TextInput style={[st.input, { flex: 1 }]} value={username} onChangeText={v => { setUsername(v); setErr(''); }}
              placeholder="yourname" placeholderTextColor={C.textMuted} autoCapitalize="none" autoCorrect={false} />
          </View>
          {err ? <Text style={{ color: C.danger, fontSize: 12, marginBottom: 8 }}>{err}</Text> : null}
          <Text style={[st.fieldLabel, { marginTop: 16 }]}>Display name</Text>
          <TextInput style={st.input} value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor={C.textMuted} />
          <Text style={[st.fieldLabel, { marginTop: 16 }]}>Bio</Text>
          <TextInput style={[st.input, { height: 80, textAlignVertical: 'top' }]} value={bio} onChangeText={setBio}
            placeholder="Tell people about yourself..." placeholderTextColor={C.textMuted} multiline maxLength={150} />
          <TouchableOpacity style={[st.primaryBtn, (!username.trim() || loading) && { opacity: 0.5 }]}
            onPress={handleCreate} disabled={!username.trim() || loading}>
            {loading ? <ActivityIndicator color={C.bg} /> : <Text style={st.primaryBtnText}>Create Profile ✦</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SocialScreen() {
  const C = useSocialColors();
  const st = makeStyles(C);
  const [tab, setTab] = useState<Tab>('feed');
  const [feedMode, setFeedMode] = useState<FeedMode>('fyp');
  const [contentFilter, setContentFilter] = useState<ContentFilter>('all');
  const [userId, setUserId] = useState('');
  const [canvasId, setCanvasId] = useState('');
  const [myProfile, setMyProfile] = useState<SocialProfile | null>(null);
  const [setupVisible, setSetupVisible] = useState(false);
  const [shareVisible, setShareVisible] = useState(false);
  const [tikTokPosts, setTikTokPosts] = useState<SocialPost[]>([]);
  const [tikTokStartIdx, setTikTokStartIdx] = useState(0);
  const [tikTokVisible, setTikTokVisible] = useState(false);
  const [viewingProfile, setViewingProfile] = useState<SocialProfile | null>(null);
  const [fypPosts, setFypPosts] = useState<SocialPost[]>([]);
  const [followingPosts, setFollowingPosts] = useState<SocialPost[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const [discoverPosts, setDiscoverPosts] = useState<SocialPost[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ profiles: SocialProfile[]; posts: SocialPost[] }>({ profiles: [], posts: [] });
  const [searching, setSearching] = useState(false);

  useEffect(() => { init(); }, []);
  useEffect(() => { if (userId) { loadFYP(); loadFollowing(); loadDiscover(); } }, [userId]);

  const init = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const { data: canvas } = await supabase.from('canvases').select('id').or(`owner_id.eq.${user.id},partner_id.eq.${user.id}`).limit(1).maybeSingle();
      if (canvas) setCanvasId(canvas.id);
      const { data: profile } = await supabase.from('social_profiles').select('*').eq('id', user.id).maybeSingle();
      if (profile) setMyProfile(profile as SocialProfile);
    } catch (e) {
      console.log('[Social] init error:', e);
    }
  };

  const profileCacheRef = useRef<Record<string, SocialProfile>>({});

  const enrichPosts = async (posts: any[]): Promise<SocialPost[]> => {
    if (!posts.length) return [];
    const postIds = posts.map(p => p.id);
    const allUserIds = [...new Set<string>(posts.map(p => p.user_id))];
    const missingIds = allUserIds.filter(id => !profileCacheRef.current[id]);

    const [profilesRes, likesRes, commentsRes, favsRes] = await Promise.all([
      missingIds.length
        // ── PATCH 7: include privacy field ───────────────────────────────────
        ? supabase.from('social_profiles').select('id,username,display_name,bio,avatar_url,privacy').in('id', missingIds)
        : Promise.resolve({ data: [] }),
      supabase.from('social_likes').select('post_id,user_id').in('post_id', postIds),
      supabase.from('social_comments').select('post_id').in('post_id', postIds),
      userId
        ? supabase.from('social_favourites').select('post_id').eq('user_id', userId).in('post_id', postIds)
        : Promise.resolve({ data: [] }),
    ]);

    for (const p of profilesRes.data ?? []) profileCacheRef.current[p.id] = p as SocialProfile;

    return posts.map(p => ({
      ...p,
      profile: profileCacheRef.current[p.user_id],
      like_count: (likesRes.data ?? []).filter((l: any) => l.post_id === p.id).length,
      liked_by_me: (likesRes.data ?? []).some((l: any) => l.post_id === p.id && l.user_id === userId),
      comment_count: (commentsRes.data ?? []).filter((c: any) => c.post_id === p.id).length,
      favourited_by_me: (favsRes.data ?? []).some((f: any) => f.post_id === p.id),
    }));
  };

  const loadFYP = async () => {
    setFeedLoading(true);
    try {
      const { data } = await supabase.from('social_posts').select('*').order('created_at', { ascending: false }).limit(80);
      setFypPosts(await filterByPrivacy(await enrichPosts(data ?? []), userId));
    } catch (e) {
      console.log('[Social] loadFYP error:', e);
      setFypPosts([]);
    } finally {
      setFeedLoading(false);
    }
  };

  const loadFollowing = async () => {
    try {
      const { data: follows } = await supabase.from('social_follows').select('following_id').eq('follower_id', userId);
      const followIds = (follows ?? []).map((f: any) => f.following_id);
      if (!followIds.length) { setFollowingPosts([]); return; }
      const { data } = await supabase.from('social_posts').select('*').in('user_id', followIds).order('created_at', { ascending: false }).limit(80);
      setFollowingPosts(await filterByPrivacy(await enrichPosts(data ?? []), userId));
    } catch (e) {
      console.log('[Social] loadFollowing error:', e);
      setFollowingPosts([]);
    }
  };

  const loadDiscover = async () => {
    setDiscoverLoading(true);
    try {
      const { data } = await supabase.from('social_posts').select('*').order('created_at', { ascending: false }).limit(80);
      setDiscoverPosts(await filterByPrivacy(await enrichPosts(data ?? []), userId));
    } catch (e) {
      console.log('[Social] loadDiscover error:', e);
      setDiscoverPosts([]);
    } finally {
      setDiscoverLoading(false);
    }
  };

  const handleDeletePost = async (postId: string) => {
    await supabase.from('social_posts').delete().eq('id', postId);
    const remove = (arr: SocialPost[]) => arr.filter(p => p.id !== postId);
    setFypPosts(remove); setFollowingPosts(remove); setDiscoverPosts(remove);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleReport = async (postId: string) => {
    await supabase.from('social_reports').insert({ post_id: postId, reported_by: userId, created_at: new Date().toISOString() });
    Alert.alert('Reported', 'Thanks for letting us know. We\'ll review this post.');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleLike = async (postId: string, liked: boolean) => {
    const upd = (arr: SocialPost[]) => arr.map(p => p.id === postId
      ? { ...p, liked_by_me: liked, like_count: Math.max(0, (p.like_count ?? 0) + (liked ? 1 : -1)) }
      : p
    );
    setFypPosts(upd); setFollowingPosts(upd); setDiscoverPosts(upd); setTikTokPosts(upd);
    if (liked) await supabase.from('social_likes').upsert({ user_id: userId, post_id: postId }, { onConflict: 'user_id,post_id' });
    else await supabase.from('social_likes').delete().eq('user_id', userId).eq('post_id', postId);
  };

  const handleFavourite = async (postId: string, faved: boolean) => {
    const upd = (arr: SocialPost[]) => arr.map(p => p.id === postId ? { ...p, favourited_by_me: faved } : p);
    setFypPosts(upd); setFollowingPosts(upd); setDiscoverPosts(upd); setTikTokPosts(upd);
    if (faved) await supabase.from('social_favourites').upsert({ user_id: userId, post_id: postId }, { onConflict: 'user_id,post_id' });
    else await supabase.from('social_favourites').delete().eq('user_id', userId).eq('post_id', postId);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleSaveSong = async (post: SocialPost) => {
    if (!post.music_url) return;
    const { data: exists } = await supabase.from('social_saved_songs').select('id').eq('user_id', userId).eq('post_id', post.id).maybeSingle();
    if (exists) { Alert.alert('Already saved', 'This song is already in your saved songs.'); return; }
    await supabase.from('social_saved_songs').insert({ user_id: userId, post_id: post.id, music_url: post.music_url, music_name: post.music_name || 'Song' });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Saved! 🎵', `"${post.music_name}" added to your saved songs.`);
  };

  const openTikTok = (posts: SocialPost[], index: number) => {
    setTikTokPosts(posts); setTikTokStartIdx(index); setTikTokVisible(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults({ profiles: [], posts: [] }); return; }
    setSearching(true);
    const [profilesRes, postsRes] = await Promise.all([
      supabase.from('social_profiles').select('*').or(`username.ilike.%${q}%,display_name.ilike.%${q}%`).limit(8),
      supabase.from('social_posts').select('*').ilike('title', `%${q}%`).limit(20),
    ]);
    const enrichedPosts = await filterByPrivacy(await enrichPosts(postsRes.data ?? []), userId);
    setSearchResults({ profiles: (profilesRes.data ?? []) as SocialProfile[], posts: enrichedPosts });
    setSearching(false);
  };

  const onRefreshFeed = useCallback(async () => {
    setFeedRefreshing(true); await loadFYP(); await loadFollowing(); setFeedRefreshing(false);
  }, [userId]);

  const activeFeedPosts = feedMode === 'fyp' ? fypPosts : followingPosts;
  const filteredPosts = contentFilter === 'all' ? activeFeedPosts : activeFeedPosts.filter(p => p.type === (contentFilter === 'scrapbook' ? 'scrapbook' : 'capsule'));

  const renderMasonry = (posts: SocialPost[], loading: boolean, onTap: (idx: number) => void) => {
    if (loading) return <View style={{ padding: 60, alignItems: 'center' }}><ActivityIndicator color={C.accent} size="large" /></View>;
    if (!posts.length) return (
      <View style={st.emptyFeed}>
        <Text style={{ fontSize: 48 }}>✨</Text>
        <Text style={st.emptyFeedTitle}>{feedMode === 'following' ? 'Follow people to see their posts' : 'Nothing here yet'}</Text>
        <Text style={st.emptyFeedSub}>Tap + Share to post your first creation</Text>
      </View>
    );
    const left = posts.filter((_, i) => i % 2 === 0);
    const right = posts.filter((_, i) => i % 2 === 1);
    return (
      <View style={st.masonryGrid}>
        <View style={st.masonryCol}>{left.map(p => <PostCard key={p.id} post={p} onPress={() => onTap(posts.indexOf(p))} />)}</View>
        <View style={st.masonryCol}>{right.map(p => <PostCard key={p.id} post={p} onPress={() => onTap(posts.indexOf(p))} />)}</View>
      </View>
    );
  };

  if (viewingProfile) {
    return (
      <SafeAreaView style={st.root} edges={['top']}>
        {tikTokVisible && (
          <TikTokFeedViewer
            posts={tikTokPosts} startIndex={tikTokStartIdx} currentUserId={userId}
            onClose={() => setTikTokVisible(false)}
            onLike={handleLike} onFavourite={handleFavourite} onSaveSong={handleSaveSong}
            onDeletePost={handleDeletePost} onReport={handleReport}
            onProfilePress={p => { setTikTokVisible(false); setViewingProfile(p); }}
          />
        )}
        <ProfileView
          profile={viewingProfile} currentUserId={userId}
          isOwnProfile={viewingProfile.id === userId}
          onBack={() => setViewingProfile(null)}
          onFollowChange={() => { loadFYP(); loadFollowing(); }}
          onPostPress={(posts, idx) => openTikTok(posts, idx)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.root} edges={['top']}>
      <SetupProfileModal visible={setupVisible} userId={userId} onComplete={p => { setMyProfile(p); setSetupVisible(false); }} />
      <ShareToFeedModal visible={shareVisible} userId={userId} canvasId={canvasId} onClose={() => setShareVisible(false)} onShared={() => { loadFYP(); loadDiscover(); }} />
      {tikTokVisible && (
        <TikTokFeedViewer
          posts={tikTokPosts} startIndex={tikTokStartIdx} currentUserId={userId}
          onClose={() => setTikTokVisible(false)}
          onLike={handleLike} onFavourite={handleFavourite} onSaveSong={handleSaveSong}
          onDeletePost={handleDeletePost} onReport={handleReport}
          onProfilePress={p => { setTikTokVisible(false); setViewingProfile(p); }}
        />
      )}

      {/* Header */}
      <View style={st.topBar}>
        <Text style={st.topBarTitle}>Socials</Text>
        <TouchableOpacity style={st.shareBtn} onPress={() => { if (!myProfile) { setSetupVisible(true); return; } setShareVisible(true); }}>
          <Text style={st.shareBtnText}>+ Share</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={st.tabBar}>
        {(['feed', 'discover', 'profile'] as Tab[]).map(t => (
          <TouchableOpacity key={t} style={[st.tabItem, tab === t && st.tabItemActive]} onPress={() => { Haptics.selectionAsync(); setTab(t); }}>
            <Text style={{ fontSize: 14 }}>{t === 'feed' ? '🏠' : t === 'discover' ? '🔍' : '👤'}</Text>
            <Text style={[st.tabLabel, tab === t && st.tabLabelActive]}>{t === 'feed' ? 'Feed' : t === 'discover' ? 'Discover' : 'Profile'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Feed ── */}
      {tab === 'feed' && (
        <>
          <View style={st.feedModeRow}>
            <TouchableOpacity style={[st.feedModeBtn, feedMode === 'fyp' && st.feedModeBtnActive]} onPress={() => { Haptics.selectionAsync(); setFeedMode('fyp'); }}>
              <Text style={[st.feedModeBtnText, feedMode === 'fyp' && { color: C.accent }]}>For You</Text>
            </TouchableOpacity>
            <View style={st.feedModeDivider} />
            <TouchableOpacity style={[st.feedModeBtn, feedMode === 'following' && st.feedModeBtnActive]} onPress={() => { Haptics.selectionAsync(); setFeedMode('following'); }}>
              <Text style={[st.feedModeBtnText, feedMode === 'following' && { color: C.accent }]}>Following</Text>
            </TouchableOpacity>
          </View>
          <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
            <ContentFilterDropdown value={contentFilter} onChange={setContentFilter} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 40, paddingTop: 4 }}
            refreshControl={<RefreshControl refreshing={feedRefreshing} onRefresh={onRefreshFeed} tintColor={C.accent} />}>
            {renderMasonry(filteredPosts, feedLoading, idx => openTikTok(filteredPosts, idx))}
          </ScrollView>
        </>
      )}

      {/* ── Discover ── */}
      {tab === 'discover' && (
        <>
          <View style={st.searchWrap}>
            <View style={st.searchBar}>
              <Text style={{ fontSize: 15, opacity: 0.5 }}>🔍</Text>
              <TextInput style={st.searchInput} value={searchQuery} onChangeText={handleSearch}
                placeholder="Search people or posts..." placeholderTextColor={C.textMuted} autoCapitalize="none" />
              {searching && <ActivityIndicator color={C.accent} size="small" />}
            </View>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
            {searchQuery.trim() ? (
              <View style={{ paddingHorizontal: 16 }}>
                {searchResults.profiles.length > 0 && (
                  <>
                    <Text style={[st.fieldLabel, { marginBottom: 10 }]}>People</Text>
                    {searchResults.profiles.map(p => (
                      <TouchableOpacity key={p.id} style={st.userRow} onPress={() => setViewingProfile(p)}>
                        <Avatar profile={p} size={44} />
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={st.userRowName}>{p.display_name || p.username}</Text>
                            {p.privacy && p.privacy !== 'public' && (
                              <Text style={{ fontSize: 11, color: C.textMuted }}>{p.privacy === 'followers' ? '👥' : '🔒'}</Text>
                            )}
                          </View>
                          <Text style={st.userRowUsername}>@{p.username}</Text>
                          {p.bio && <Text style={st.userRowBio} numberOfLines={1}>{p.bio}</Text>}
                        </View>
                        <Text style={{ color: C.textMuted, fontSize: 20 }}>›</Text>
                      </TouchableOpacity>
                    ))}
                  </>
                )}
                {searchResults.posts.length > 0 && (
                  <>
                    <Text style={[st.fieldLabel, { marginTop: 16, marginBottom: 10 }]}>Posts</Text>
                    <View style={st.masonryGrid}>
                      <View style={st.masonryCol}>{searchResults.posts.filter((_, i) => i % 2 === 0).map(p => <PostCard key={p.id} post={p} onPress={() => openTikTok(searchResults.posts, searchResults.posts.indexOf(p))} />)}</View>
                      <View style={st.masonryCol}>{searchResults.posts.filter((_, i) => i % 2 === 1).map(p => <PostCard key={p.id} post={p} onPress={() => openTikTok(searchResults.posts, searchResults.posts.indexOf(p))} />)}</View>
                    </View>
                  </>
                )}
                {!searching && !searchResults.profiles.length && !searchResults.posts.length && (
                  <Text style={[st.emptyFeedSub, { textAlign: 'center', marginTop: 40 }]}>No results for "{searchQuery}"</Text>
                )}
              </View>
            ) : (
              <View style={{ paddingHorizontal: 12 }}>
                {renderMasonry(discoverPosts, discoverLoading, idx => openTikTok(discoverPosts, idx))}
              </View>
            )}
          </ScrollView>
        </>
      )}

      {/* ── Profile ── */}
      {tab === 'profile' && (
        myProfile ? (
          <ProfileView profile={myProfile} currentUserId={userId} isOwnProfile
            onBack={() => {}} onFollowChange={() => {}}
            onPostPress={(posts, idx) => openTikTok(posts, idx)} />
        ) : (
          <View style={st.noProfile}>
            <Text style={{ fontSize: 56 }}>✦</Text>
            <Text style={st.noProfileTitle}>No profile yet</Text>
            <Text style={st.noProfileSub}>Create a profile to share your scrapbooks and travels.</Text>
            <TouchableOpacity style={st.primaryBtn} onPress={() => setSetupVisible(true)}>
              <Text style={st.primaryBtnText}>Create profile</Text>
            </TouchableOpacity>
          </View>
        )
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (C: ReturnType<typeof useSocialColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 },
  topBarTitle: { fontSize: 28, fontWeight: '800', color: C.textPrimary, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  shareBtn: { backgroundColor: C.accent, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 9 },
  shareBtnText: { color: C.bg, fontWeight: '800', fontSize: 14 },

  tabBar: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  tabItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, borderRadius: 26, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  tabItemActive: { backgroundColor: C.accentSoft, borderColor: C.accent + '50' },
  tabLabel: { fontSize: 12, fontWeight: '600', color: C.textMuted },
  tabLabelActive: { color: C.accent },

  feedModeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  feedModeBtn: { paddingHorizontal: 22, paddingVertical: 7 },
  feedModeBtnActive: { borderBottomWidth: 2, borderBottomColor: C.accent },
  feedModeBtnText: { fontSize: 15, fontWeight: '700', color: C.textMuted },
  feedModeDivider: { width: 1, height: 16, backgroundColor: C.border },

  dropdownBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignSelf: 'flex-start' },
  dropdownBtnText: { fontSize: 13, fontWeight: '600', color: C.textSecondary },
  dropdownMenu: { position: 'absolute', top: '20%', left: 20, right: 20, backgroundColor: C.surfaceHigh, borderRadius: 18, borderWidth: 1, borderColor: C.border, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 20, elevation: 20 },
  dropdownMenuTitle: { fontSize: 12, fontWeight: '700', color: C.textMuted, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderColor: C.border },
  dropdownItemActive: { backgroundColor: C.accentSoft },
  dropdownItemText: { flex: 1, fontSize: 15, fontWeight: '600', color: C.textPrimary },

  masonryGrid: { flexDirection: 'row', gap: 10 },
  masonryCol: { flex: 1 },
  postCard: { backgroundColor: C.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.border, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
  postThumb: { width: '100%', overflow: 'hidden', position: 'relative', backgroundColor: C.surfaceHigh },
  typeBadge: { position: 'absolute', top: 8, left: 8, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 },
  typeBadgeText: { color: '#fff', fontSize: 12 },
  playIndicator: { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 },
  postContent: { padding: 10, paddingTop: 8 },
  postTitle: { fontSize: 13, fontWeight: '700', color: C.textPrimary, marginBottom: 3, lineHeight: 17 },
  postCaption: { fontSize: 11, color: C.textSecondary, lineHeight: 15, marginBottom: 7 },
  postFooter: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  postAuthorName: { fontSize: 10, color: C.textSecondary, flex: 1 },

  postInfoAuthor: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  postInfoName: { fontSize: 15, fontWeight: '800', color: C.white },
  postInfoHandle: { fontSize: 12, color: 'rgba(255,255,255,0.65)' },
  postInfoTitle: { fontSize: 16, fontWeight: '800', lineHeight: 21 },
  postInfoCaption: { fontSize: 13, lineHeight: 18 },
  postActions: { position: 'absolute', right: 12, gap: 20, alignItems: 'center' },
  actionBtn: { alignItems: 'center', gap: 4 },
  actionIconWrap: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  actionIcon: { fontSize: 26, color: C.white },
  actionCount: { fontSize: 11, color: C.white, fontWeight: '700' },
  musicDisc: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  dotRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive: { backgroundColor: C.white, width: 16 },
  closeBtn: { position: 'absolute', top: Platform.OS === 'ios' ? 56 : 24, left: 16, zIndex: 100, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: C.white, fontSize: 16, fontWeight: '700' },

  commentsSheet: { backgroundColor: C.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: SH * 0.78, flex: 1, borderTopWidth: 1, borderColor: C.border },
  sheetHandle: { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 2 },
  commentsTitle: { fontSize: 15, fontWeight: '700', color: C.textPrimary, textAlign: 'center', paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border },
  noCommentsText: { color: C.textMuted, fontSize: 14, textAlign: 'center', padding: 32 },
  commentRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  commentBubble: { flex: 1, backgroundColor: C.surfaceHigh, borderRadius: 14, padding: 11, borderWidth: 1, borderColor: C.border },
  commentAuthor: { fontSize: 12, fontWeight: '700', color: C.accent },
  commentText: { fontSize: 14, color: C.textPrimary, lineHeight: 19, marginTop: 3 },
  commentTime: { fontSize: 10, color: C.textMuted },
  commentInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 12, borderTopWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  commentInputField: { flex: 1, backgroundColor: C.surfaceHigh, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, color: C.textPrimary, fontSize: 14, maxHeight: 100, borderWidth: 1, borderColor: C.border },
  commentSendBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  commentSendText: { color: C.bg, fontSize: 18, fontWeight: '800' },

  profileHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14, borderBottomWidth: 1, borderColor: C.border },
  profileHeaderTitle: { fontSize: 15, fontWeight: '700', color: C.textPrimary },
  profileHero: { alignItems: 'center', padding: 28, gap: 8, borderBottomWidth: 1, borderColor: C.border },
  profileDisplayName: { fontSize: 22, fontWeight: '800', color: C.textPrimary, marginTop: 10 },
  profileUsername: { fontSize: 13, color: C.textMuted },
  profileBio: { fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 20, maxWidth: 280 },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  statItem: { alignItems: 'center', paddingHorizontal: 26 },
  statNum: { fontSize: 20, fontWeight: '800', color: C.textPrimary },
  statLabel: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: C.border },
  followBtn: { backgroundColor: C.surface, borderRadius: 26, paddingHorizontal: 32, paddingVertical: 11, borderWidth: 1.5, borderColor: C.border, marginTop: 10 },
  followBtnActive: { backgroundColor: C.accentSoft, borderColor: C.accent },
  followBtnText: { color: C.textPrimary, fontWeight: '700', fontSize: 15 },
  profileTabRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: C.border },
  profileTabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  profileTabBtnActive: { borderBottomWidth: 2, borderBottomColor: C.accent },
  profileTabLabel: { fontSize: 13, fontWeight: '600', color: C.textMuted },
  emptyProfile: { alignItems: 'center', padding: 48, gap: 12 },
  emptyProfileText: { color: C.textMuted, fontSize: 15 },

  songCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: C.surfaceHigh, borderRadius: 16, borderWidth: 1, borderColor: C.border },
  songCardDisc: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  songCardName: { fontSize: 14, fontWeight: '600', color: C.textPrimary },
  songCardPlay: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },

  searchWrap: { padding: 16, paddingBottom: 10 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: C.border, gap: 8 },
  searchInput: { flex: 1, color: C.textPrimary, fontSize: 15 },
  userRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderColor: C.border, gap: 12 },
  userRowName: { fontSize: 15, fontWeight: '600', color: C.textPrimary },
  userRowUsername: { fontSize: 12, color: C.textMuted },
  userRowBio: { fontSize: 12, color: C.textSecondary, marginTop: 2 },

  emptyFeed: { alignItems: 'center', padding: 60, gap: 12 },
  emptyFeedTitle: { fontSize: 18, fontWeight: '700', color: C.textPrimary, textAlign: 'center' },
  emptyFeedSub: { fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 20 },
  noProfile: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 14 },
  noProfileTitle: { fontSize: 24, fontWeight: '800', color: C.textPrimary },
  noProfileSub: { fontSize: 15, color: C.textSecondary, textAlign: 'center', lineHeight: 22 },

  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderColor: C.border },
  modalCancel: { fontSize: 16, color: C.textSecondary },
  modalTitle: { fontSize: 16, fontWeight: '700', color: C.textPrimary },
  stepHint: { fontSize: 13, color: C.textMuted, marginBottom: 16, lineHeight: 18 },
  typeSelector: { flexDirection: 'row', gap: 12, marginBottom: 22 },
  typeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderRadius: 16, backgroundColor: C.surfaceHigh, borderWidth: 1.5, borderColor: C.border },
  typeBtnActive: { borderColor: C.accent, backgroundColor: C.accentSoft },
  typeBtnLabel: { fontSize: 14, fontWeight: '600', color: C.textSecondary },
  thumbActionBtn: { paddingHorizontal: 14, paddingVertical: 13, borderRadius: 12, backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  thumbActionBtnText: { fontSize: 14, color: C.textSecondary, fontWeight: '600' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border },
  itemRowSelected: { borderColor: C.accent, backgroundColor: C.accentSoft },
  itemThumb: { width: 52, height: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: C.border },
  itemName: { flex: 1, fontSize: 14, fontWeight: '600', color: C.textPrimary },
  captionInput: { backgroundColor: C.surfaceHigh, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, color: C.textPrimary, fontSize: 14, textAlignVertical: 'top' },
  charCount: { textAlign: 'right', fontSize: 11, color: C.textMuted, marginTop: 4 },
  emptyShare: { padding: 24, alignItems: 'center' },
  emptyShareText: { color: C.textMuted, fontSize: 14 },
  setupTitle: { fontSize: 30, fontWeight: '800', color: C.textPrimary, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', marginBottom: 8 },
  setupSubtitle: { fontSize: 15, color: C.textSecondary, lineHeight: 22, marginBottom: 32 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: C.textSecondary, marginBottom: 8, letterSpacing: 0.3 },
  input: { backgroundColor: C.surfaceHigh, borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 13, color: C.textPrimary, fontSize: 15 },
  primaryBtn: { backgroundColor: C.accent, borderRadius: 16, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
  primaryBtnText: { color: C.bg, fontWeight: '800', fontSize: 15 },
  menuSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.surfaceHigh, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 34, paddingTop: 8, borderTopWidth: 1, borderColor: C.border },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 24, paddingVertical: 16, borderTopWidth: 1, borderColor: C.border },
  menuItemText: { fontSize: 16, fontWeight: '600', color: C.textPrimary },
});