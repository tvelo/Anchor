import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, Dimensions, Linking, Modal, Platform,
  ScrollView, Share, StyleSheet, Switch, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, type Theme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';

const { width: SW } = Dimensions.get('window');

const PRIVACY_OPTIONS: { key: 'public' | 'followers' | 'friends'; label: string; desc: string; emoji: string }[] = [
  { key: 'public',    label: 'Public',   desc: 'Anyone can see your social posts',       emoji: '🌍' },
  { key: 'followers', label: 'Followers', desc: 'Only your followers can see your posts', emoji: '👥' },
  { key: 'friends',   label: 'Friends',   desc: 'Only mutual follows see your posts',     emoji: '🔒' },
];

// ─── Password rules (same as signup) ─────────────────────────────────────────
const RULES = [
  { key: 'length', label: 'At least 8 characters',     test: (p: string) => p.length >= 8 },
  { key: 'upper',  label: 'One uppercase letter (A–Z)', test: (p: string) => /[A-Z]/.test(p) },
  { key: 'lower',  label: 'One lowercase letter (a–z)', test: (p: string) => /[a-z]/.test(p) },
  { key: 'digit',  label: 'One number (0–9)',            test: (p: string) => /[0-9]/.test(p) },
];
function pwScore(p: string) { return RULES.filter(r => r.test(p)).length; }

function SettingRow({ label, subtitle, right, onPress, C, danger = false }: {
  label: string; subtitle?: string; right?: React.ReactNode;
  onPress?: () => void; C: ReturnType<typeof useTheme>['colors']; danger?: boolean;
}) {
  const anim = useRef(new Animated.Value(1)).current;
  const press = () => {
    if (!onPress) return;
    Animated.sequence([
      Animated.timing(anim, { toValue: 0.97, duration: 80, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 1,    duration: 80, useNativeDriver: true }),
    ]).start();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };
  return (
    <Animated.View style={{ transform: [{ scale: anim }] }}>
      <TouchableOpacity onPress={press} activeOpacity={onPress ? 0.7 : 1}
        style={[styles.row, { borderBottomColor: C.border }]}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={label}
        accessibilityHint={subtitle}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowLabel, { color: danger ? C.danger : C.textPrimary }]}>{label}</Text>
          {subtitle ? <Text style={[styles.rowSub, { color: C.textMuted }]}>{subtitle}</Text> : null}
        </View>
        {right ?? (onPress ? <Text style={[styles.chevron, { color: C.textMuted }]}>›</Text> : null)}
      </TouchableOpacity>
    </Animated.View>
  );
}

function Section({ title, children, C }: { title: string; children: React.ReactNode; C: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: C.accent }]}>{title.toUpperCase()}</Text>
      <View style={[styles.sectionCard, { backgroundColor: C.surface, borderColor: C.border }]}>
        {children}
      </View>
    </View>
  );
}

// ─── Change Password Modal ────────────────────────────────────────────────────
function ChangePasswordModal({ visible, userEmail, onClose, C }: {
  visible: boolean; userEmail: string; onClose: () => void;
  C: ReturnType<typeof useTheme>['colors'];
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nextFocused, setNextFocused] = useState(false);
  const score = pwScore(next);

  const reset = () => { setCurrent(''); setNext(''); setConfirm(''); };

  const handleSave = async () => {
    if (!current || !next || !confirm) { Alert.alert('Fill in all fields'); return; }
    if (score < 4) {
      Alert.alert('Password too weak', 'Must have 8+ chars, uppercase, lowercase, and a number.');
      return;
    }
    if (next !== confirm) { Alert.alert('Passwords don\'t match'); return; }
    setSaving(true);
    // Re-authenticate first
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: userEmail, password: current });
    if (signInErr) { Alert.alert('Incorrect current password', signInErr.message); setSaving(false); return; }
    // Update
    const { error } = await supabase.auth.updateUser({ password: next });
    setSaving(false);
    if (error) { Alert.alert('Failed to update password', error.message); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Password updated ✓', 'Your password has been changed successfully.', [
      { text: 'OK', onPress: () => { reset(); onClose(); } },
    ]);
  };

  const strengthColors = ['', '#E05C5C', '#E09B5C', '#C9956C', '#5EBA8A'];
  const strengthLabels = ['', 'Weak', 'Fair', 'Good', 'Strong'];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={[styles.modalHeader, { borderBottomColor: C.border }]}>
          <TouchableOpacity onPress={() => { reset(); onClose(); }}>
            <Text style={{ color: C.textSecondary, fontSize: 16 }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.modalTitle, { color: C.textPrimary }]}>Change Password</Text>
          <TouchableOpacity onPress={handleSave} disabled={saving}>
            <Text style={{ color: C.accent, fontSize: 16, fontWeight: '600' }}>{saving ? 'Saving…' : 'Save'}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
          <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>Current password</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
            <TextInput
              style={[styles.input, { flex: 1, backgroundColor: C.surfaceHigh, borderColor: C.border, color: C.textPrimary }]}
              value={current} onChangeText={setCurrent} secureTextEntry={!showCurrent}
              placeholder="Enter current password" placeholderTextColor={C.textMuted} />
            <TouchableOpacity style={[styles.eyeBtn, { backgroundColor: C.surfaceHigh, borderColor: C.border }]} onPress={() => setShowCurrent(v => !v)}>
              <Text style={{ fontSize: 18 }}>{showCurrent ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>New password</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0, backgroundColor: C.surfaceHigh, borderColor: C.border, color: C.textPrimary }]}
              value={next} onChangeText={setNext} secureTextEntry={!showNext}
              placeholder="Enter new password" placeholderTextColor={C.textMuted}
              onFocus={() => setNextFocused(true)} onBlur={() => setNextFocused(false)} />
            <TouchableOpacity style={[styles.eyeBtn, { backgroundColor: C.surfaceHigh, borderColor: C.border }]} onPress={() => setShowNext(v => !v)}>
              <Text style={{ fontSize: 18 }}>{showNext ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>
          {next.length > 0 && (
            <View style={{ marginTop: 8, marginBottom: 4 }}>
              <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
                {[1,2,3,4].map(i => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= score ? strengthColors[score] : C.border }} />)}
              </View>
              <Text style={{ fontSize: 11, color: strengthColors[score], fontWeight: '600' }}>{strengthLabels[score]}</Text>
            </View>
          )}
          {(nextFocused || (next.length > 0 && score < 4)) && (
            <View style={{ backgroundColor: C.surfaceHigh, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.border, marginBottom: 12 }}>
              {RULES.map(r => {
                const ok = r.test(next);
                return (
                  <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Text style={{ fontSize: 12, color: ok ? '#5EBA8A' : C.textMuted }}>{ok ? '✓' : '○'}</Text>
                    <Text style={{ fontSize: 12, color: ok ? '#5EBA8A' : C.textMuted }}>{r.label}</Text>
                  </View>
                );
              })}
            </View>
          )}

          <Text style={[styles.fieldLabel, { color: C.textSecondary, marginTop: 8 }]}>Confirm new password</Text>
          <TextInput
            style={[styles.input, { backgroundColor: C.surfaceHigh, borderColor: confirm && confirm !== next ? '#E05C5C' : C.border, color: C.textPrimary }]}
            value={confirm} onChangeText={setConfirm} secureTextEntry
            placeholder="Repeat new password" placeholderTextColor={C.textMuted} />
          {confirm.length > 0 && confirm !== next && (
            <Text style={{ color: '#E05C5C', fontSize: 12, marginTop: -8, marginBottom: 8 }}>Passwords don't match</Text>
          )}

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: C.accent, opacity: score < 4 || next !== confirm ? 0.5 : 1 }]}
            onPress={handleSave} disabled={saving || score < 4 || next !== confirm}>
            <Text style={styles.primaryBtnText}>{saving ? 'Updating…' : 'Update password'}</Text>
          </TouchableOpacity>

          {/* Forgot password alternative */}
          <TouchableOpacity style={{ alignItems: 'center', marginTop: 16 }} onPress={async () => {
            const { error } = await supabase.auth.resetPasswordForEmail(userEmail);
            if (error) Alert.alert('Error', error.message);
            else Alert.alert('Reset link sent ✉️', `Check ${userEmail} for a reset link instead.`);
          }}>
            <Text style={{ color: C.textMuted, fontSize: 13 }}>Forgot current password? Send reset link instead</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const { theme, colors: C, setTheme } = useTheme();

  const [user, setUser] = useState<{ email: string; id: string } | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [editNameModal, setEditNameModal] = useState(false);
  const [changePasswordModal, setChangePasswordModal] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [isPlusMember, setIsPlusMember] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [privacy, setPrivacy] = useState<'public' | 'followers' | 'friends'>('public');
  const [privacySaving, setPrivacySaving] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);

  const [notifNewMemory,      setNotifNewMemory]      = useState(true);
  const [notifCapsuleUnlocked, setNotifCapsuleUnlocked] = useState(true);
  const [notifNewMember,      setNotifNewMember]      = useState(true);
  const [notifReminders,      setNotifReminders]      = useState(false);
  const [locationTags,        setLocationTagsState]   = useState(false);

  const headerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadUser();
    Animated.timing(headerAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  const loadUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUser({ email: user.email ?? '', id: user.id });

    const { data } = await supabase.from('users')
      .select('display_name, theme, location_tags_enabled')
      .eq('id', user.id).maybeSingle();

    if (data?.display_name) setDisplayName(data.display_name);
    else setDisplayName(user.email?.split('@')[0] ?? 'User');
    if (data?.location_tags_enabled) setLocationTagsState(data.location_tags_enabled);

    if (data?.theme === 'light' || data?.theme === 'dark' || data?.theme === 'system') {
      setTheme(data.theme as Theme);
    }

    const { data: profile } = await supabase.from('social_profiles').select('privacy').eq('id', user.id).maybeSingle();
    if (profile) { setHasProfile(true); setPrivacy((profile.privacy as any) || 'public'); }

    const { data: plus } = await supabase.from('anchor_plus').select('id').eq('user_id', user.id).maybeSingle();
    setIsPlusMember(!!plus);
  };

  const handleSetTheme = async (t: Theme) => {
    setTheme(t);
    if (user) { try { await supabase.from('users').update({ theme: t }).eq('id', user.id); } catch {} }
  };

  const handleSaveName = async () => {
    if (!nameInput.trim() || !user) return;
    setSaving(true);
    await supabase.from('users').upsert({ id: user.id, display_name: nameInput.trim() });
    setDisplayName(nameInput.trim());
    setSaving(false);
    setEditNameModal(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handlePrivacyChange = async (val: 'public' | 'followers' | 'friends') => {
    if (!user || val === privacy) return;
    setPrivacy(val);
    setPrivacySaving(true);
    try {
      const { error } = await supabase.from('social_profiles').update({ privacy: val }).eq('id', user.id);
      if (error) {
        Alert.alert('Error saving privacy', error.message);
        const { data } = await supabase.from('social_profiles').select('privacy').eq('id', user.id).maybeSingle();
        if (data) setPrivacy((data.privacy as any) || 'public');
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e: any) { Alert.alert('Error', e.message); }
    setPrivacySaving(false);
  };

  // ── Location tags — persists to DB ─────────────────────────────────────────
  const handleLocationTagsToggle = async (val: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLocationTagsState(val);
    if (user) {
      await supabase.from('users').update({ location_tags_enabled: val }).eq('id', user.id);
    }
  };

  // ── Export data ────────────────────────────────────────────────────────────
  const handleExportData = async () => {
    if (!user) return;
    setExporting(true);
    Alert.alert('Exporting your data…', 'Gathering everything, this may take a moment.');
    try {
      const [
        { data: userData },
        { data: canvases },
        { data: scrapbooks },
        { data: capsules },
        { data: socialProfile },
        { data: socialPosts },
        { data: likes },
        { data: comments },
        { data: follows },
        { data: followers },
      ] = await Promise.all([
        supabase.from('users').select('*').eq('id', user.id).maybeSingle(),
        supabase.from('canvases').select('id, name, created_at').or(`owner_id.eq.${user.id},partner_id.eq.${user.id}`),
        supabase.from('scrapbooks').select('id, name, created_at').eq('created_by', user.id),
        supabase.from('travel_capsules').select('id, name, destination, created_at').eq('created_by', user.id),
        supabase.from('social_profiles').select('*').eq('id', user.id).maybeSingle(),
        supabase.from('social_posts').select('id, type, title, caption, created_at').eq('user_id', user.id),
        supabase.from('social_likes').select('post_id, created_at').eq('user_id', user.id),
        supabase.from('social_comments').select('content, created_at').eq('user_id', user.id),
        supabase.from('social_follows').select('following_id').eq('follower_id', user.id),
        supabase.from('social_follows').select('follower_id').eq('following_id', user.id),
      ]);

      const exportData = {
        exported_at: new Date().toISOString(),
        account: {
          id: user.id,
          email: user.email,
          display_name: userData?.display_name,
        },
        social_profile: socialProfile,
        spaces: canvases ?? [],
        scrapbooks: scrapbooks ?? [],
        travel_capsules: capsules ?? [],
        social: {
          posts: socialPosts ?? [],
          likes_given: likes ?? [],
          comments: comments ?? [],
          following_count: follows?.length ?? 0,
          follower_count: followers?.length ?? 0,
        },
      };

      const json = JSON.stringify(exportData, null, 2);
      const path = FileSystem.cacheDirectory + `anchor-export-${Date.now()}.json`;
      await FileSystem.writeAsStringAsync(path, json, { encoding: FileSystem.EncodingType.UTF8 });
      await Share.share({ url: path, title: 'My Anchor Data Export' });
    } catch (e: any) {
      Alert.alert('Export failed', e.message || 'Something went wrong.');
    }
    setExporting(false);
  };

  const handleNotifToggle = async (type: string, value: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (value) {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Notifications blocked', 'Enable in device Settings.', [
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
          { text: 'Cancel', style: 'cancel' },
        ]);
        return;
      }
    }
    switch (type) {
      case 'newMemory': setNotifNewMemory(value); break;
      case 'unlocked':  setNotifCapsuleUnlocked(value); break;
      case 'newMember': setNotifNewMember(value); break;
      case 'reminders': setNotifReminders(value); break;
    }
  };

  const handleSignOut = () => {
    Alert.alert('Sign out?', "You'll need to sign back in.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => {
        await supabase.auth.signOut();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }},
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert('Delete account?', 'This permanently deletes all your data and cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete my account', style: 'destructive', onPress: () => {
        Alert.alert(
          'Are you sure?',
          'Last chance — this cannot be reversed.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Yes, delete everything', style: 'destructive', onPress: () => {
              Alert.alert('Contact support', 'Email anchorsupprtmobile@outlook.com with the subject "Delete my account" and we\'ll action it within 24 hours.');
            }},
          ]
        );
      }},
    ]);
  };

  const avatar = displayName?.[0]?.toUpperCase() ?? '?';

  const toggle = (val: boolean, key: string) => (
    <Switch value={val} onValueChange={v => handleNotifToggle(key, v)}
      trackColor={{ false: C.switchTrack, true: C.accentSoft }}
      thumbColor={val ? C.accent : C.textMuted} ios_backgroundColor={C.switchTrack} />
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: C.bg }]} edges={['top']}>
      <ChangePasswordModal
        visible={changePasswordModal}
        userEmail={user?.email ?? ''}
        onClose={() => setChangePasswordModal(false)}
        C={C}
      />

      <Animated.View style={[styles.header, {
        opacity: headerAnim,
        transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }],
      }]}>
        <Text style={[styles.headerTitle, { color: C.textPrimary }]}>Settings</Text>
      </Animated.View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>

        {/* Profile card */}
        <TouchableOpacity onPress={() => { setNameInput(displayName); setEditNameModal(true); }}
          style={[styles.profileCard, { backgroundColor: C.surface, borderColor: C.border }]} activeOpacity={0.85}>
          <View style={[styles.avatar, { backgroundColor: C.accentSoft, borderColor: C.accent + '60' }]}>
            <Text style={[styles.avatarText, { color: C.accent }]}>{avatar}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.profileName, { color: C.textPrimary }]}>{displayName}</Text>
            <Text style={[styles.profileEmail, { color: C.textMuted }]}>{user?.email ?? ''}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {isPlusMember && (
              <View style={{ backgroundColor: C.accentSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: C.accent + '60' }}>
                <Text style={{ color: C.accent, fontSize: 11, fontWeight: '800' }}>✦ PLUS</Text>
              </View>
            )}
            <View style={[styles.editBadge, { backgroundColor: C.accentSoft, borderColor: C.accent + '40' }]}>
              <Text style={[styles.editBadgeText, { color: C.accent }]}>Edit</Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Anchor Plus */}
        <TouchableOpacity
          onPress={() => router.push('/plus' as any)}
          style={[styles.plusCard, { backgroundColor: isPlusMember ? C.accentSoft : '#2D2040', borderColor: isPlusMember ? C.accent + '60' : '#3D2E52' }]}
          activeOpacity={0.85}>
          <Text style={{ fontSize: 28 }}>✦</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: isPlusMember ? C.accent : C.textPrimary, fontWeight: '800', fontSize: 15 }}>
              {isPlusMember ? 'Anchor Plus — Active' : 'Upgrade to Anchor Plus'}
            </Text>
            <Text style={{ color: C.textMuted, fontSize: 12, marginTop: 2 }}>
              {isPlusMember ? 'All features unlocked' : 'Unlimited everything · £5.99 one-time'}
            </Text>
          </View>
          <Text style={{ color: isPlusMember ? C.accent : C.textMuted, fontSize: 22 }}>›</Text>
        </TouchableOpacity>

        {/* Appearance */}
        <Section title="Appearance" C={C}>
          <View style={[styles.row, { borderBottomColor: C.border, flexDirection: 'column', alignItems: 'flex-start', gap: 10 }]}>
            <Text style={[styles.rowLabel, { color: C.textPrimary }]}>Theme</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['dark', 'light', 'system'] as Theme[]).map(t => (
                <TouchableOpacity key={t} onPress={() => { Haptics.selectionAsync(); handleSetTheme(t); }}
                  style={[styles.themePill, {
                    borderColor: theme === t ? C.accent : C.border,
                    backgroundColor: theme === t ? C.accentSoft : C.surfaceHigh,
                  }]}>
                  <Text style={{ fontSize: 16 }}>{t === 'dark' ? '🌙' : t === 'light' ? '☀️' : '⚙️'}</Text>
                  <Text style={[styles.themePillLabel, { color: theme === t ? C.accent : C.textSecondary }]}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </Section>

        {/* Social Privacy */}
        {hasProfile && (
          <Section title="Social Privacy" C={C}>
            <View style={[styles.row, { borderBottomColor: C.border, flexDirection: 'column', alignItems: 'flex-start', gap: 10 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <Text style={[styles.rowLabel, { color: C.textPrimary }]}>Who can see your posts</Text>
                {privacySaving && <Text style={{ color: C.textMuted, fontSize: 12 }}>Saving…</Text>}
              </View>
              <View style={{ flexDirection: 'row', gap: 8, width: '100%' }}>
                {PRIVACY_OPTIONS.map(o => (
                  <TouchableOpacity key={o.key}
                    style={[styles.privacyPill, {
                      borderColor: privacy === o.key ? C.accent : C.border,
                      backgroundColor: privacy === o.key ? C.accentSoft : C.surfaceHigh,
                    }]}
                    onPress={() => { Haptics.selectionAsync(); handlePrivacyChange(o.key); }}>
                    <Text style={{ fontSize: 16 }}>{o.emoji}</Text>
                    <Text style={[styles.privacyPillLabel, { color: privacy === o.key ? C.accent : C.textSecondary }]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.rowSub, { color: C.textMuted }]}>
                {PRIVACY_OPTIONS.find(o => o.key === privacy)?.desc}
              </Text>
            </View>
          </Section>
        )}

        {/* Notifications */}
        <Section title="Notifications" C={C}>
          <SettingRow label="New memory added"    subtitle="When someone uploads to a shared capsule" right={toggle(notifNewMemory, 'newMemory')} C={C} />
          <SettingRow label="Capsule unlocked"    subtitle="When a time-locked capsule opens"         right={toggle(notifCapsuleUnlocked, 'unlocked')} C={C} />
          <SettingRow label="New traveller joined" subtitle="When someone joins your capsule"          right={toggle(notifNewMember, 'newMember')} C={C} />
          <SettingRow label="Upload reminders"    subtitle="Gentle nudges before unlock"              right={toggle(notifReminders, 'reminders')} C={C} />
        </Section>

        {/* Privacy */}
        <Section title="Privacy" C={C}>
          <SettingRow
            label="Location tags"
            subtitle={locationTags ? 'Location attached to memories · tap to disable' : 'Tap to attach location to uploaded memories'}
            right={
              <Switch
                value={locationTags}
                onValueChange={handleLocationTagsToggle}
                trackColor={{ false: C.switchTrack, true: C.accentSoft }}
                thumbColor={locationTags ? C.accent : C.textMuted}
                ios_backgroundColor={C.switchTrack}
              />
            }
            C={C}
          />
          <SettingRow label="Privacy Policy"    onPress={() => Linking.openURL('https://anchor.app/privacy')} C={C} />
          <SettingRow label="Terms of Service"  onPress={() => Linking.openURL('https://anchor.app/terms')} C={C} />
        </Section>

        {/* Account */}
        <Section title="Account" C={C}>
          <SettingRow
            label="Change password"
            subtitle="Update your password securely"
            onPress={() => setChangePasswordModal(true)}
            C={C}
          />
          <SettingRow
            label="Export my data"
            subtitle={exporting ? 'Exporting…' : 'Download a copy of all your data'}
            onPress={exporting ? undefined : handleExportData}
            C={C}
          />
        </Section>

        {/* Support */}
        <Section title="Support" C={C}>
          <SettingRow label="Send feedback"    onPress={() => Linking.openURL('mailto:anchorsupprtmobile@outlook.com?subject=Feedback')} C={C} />
          <SettingRow label="Rate Anchor"      onPress={() => Linking.openURL('https://apps.apple.com')} C={C} />
          <SettingRow label="Share with friends" onPress={() => Share.share({ message: 'Check out Anchor — shared travel memory capsules! https://anchor.app' })} C={C} />
        </Section>

        {/* Danger */}
        <Section title="Danger Zone" C={C}>
          <SettingRow label="Sign out"        onPress={handleSignOut}      danger C={C} />
          <SettingRow label="Delete account"  subtitle="Permanently removes all your data" onPress={handleDeleteAccount} danger C={C} />
        </Section>

        <Text style={[styles.version, { color: C.textMuted }]}>Anchor v1.0.0 · Made with ❤️</Text>
      </ScrollView>

      {/* Edit name modal */}
      <Modal visible={editNameModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setEditNameModal(false)}>
        <View style={[styles.modalContainer, { backgroundColor: C.bg }]}>
          <View style={[styles.modalHeader, { borderBottomColor: C.border }]}>
            <TouchableOpacity onPress={() => setEditNameModal(false)}>
              <Text style={[styles.modalCancel, { color: C.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: C.textPrimary }]}>Edit Profile</Text>
            <TouchableOpacity onPress={handleSaveName} disabled={saving}>
              <Text style={[styles.modalCancel, { color: C.accent }]}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
          <View style={{ padding: 24 }}>
            <View style={[styles.avatarLarge, { backgroundColor: C.accentSoft, borderColor: C.accent + '60', alignSelf: 'center', marginBottom: 28 }]}>
              <Text style={[styles.avatarTextLarge, { color: C.accent }]}>{(nameInput || displayName)?.[0]?.toUpperCase() ?? '?'}</Text>
            </View>
            <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>Display name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: C.surfaceHigh, borderColor: C.border, color: C.textPrimary }]}
              value={nameInput} onChangeText={setNameInput} placeholder="Your name"
              placeholderTextColor={C.textMuted} autoFocus returnKeyType="done" onSubmitEditing={handleSaveName} />
            <Text style={[styles.fieldLabel, { color: C.textSecondary, marginTop: 20 }]}>Email</Text>
            <View style={[styles.inputReadonly, { backgroundColor: C.surfaceHigh, borderColor: C.border }]}>
              <Text style={[styles.inputReadonlyText, { color: C.textMuted }]}>{user?.email ?? ''}</Text>
            </View>
            <Text style={[styles.fieldHint, { color: C.textMuted }]}>Email cannot be changed here.</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  headerTitle: { fontSize: 34, fontWeight: '800', fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', letterSpacing: -0.5 },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, borderWidth: 1, marginBottom: 10, marginTop: 4 },
  avatar: { width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 20, fontWeight: '800' },
  avatarLarge: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatarTextLarge: { fontSize: 32, fontWeight: '800' },
  profileName: { fontSize: 17, fontWeight: '700', marginBottom: 2 },
  profileEmail: { fontSize: 13 },
  editBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1 },
  editBadgeText: { fontSize: 12, fontWeight: '600' },
  plusCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, borderWidth: 1.5, marginBottom: 8 },
  section: { marginTop: 24 },
  sectionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8, marginLeft: 4 },
  sectionCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  rowSub: { fontSize: 12, marginTop: 2 },
  chevron: { fontSize: 20, fontWeight: '300' },
  themePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5 },
  themePillLabel: { fontSize: 13, fontWeight: '600' },
  privacyPill: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 12, borderWidth: 1.5, gap: 3 },
  privacyPillLabel: { fontSize: 10, fontWeight: '700' },
  version: { textAlign: 'center', fontSize: 12, marginTop: 32, marginBottom: 8 },
  modalContainer: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1 },
  modalCancel: { fontSize: 16 },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, marginBottom: 12 },
  eyeBtn: { padding: 14, borderRadius: 12, borderWidth: 1 },
  inputReadonly: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13 },
  inputReadonlyText: { fontSize: 15 },
  fieldHint: { fontSize: 12, marginTop: 6 },
  primaryBtn: { borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});