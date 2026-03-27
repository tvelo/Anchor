import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';

export default function JoinTravelCapsule() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'joining' | 'success' | 'already' | 'error'>('loading');
  const [capsuleName, setCapsuleName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => { handleJoin(); }, [id]);

  const handleJoin = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/(auth)/login'); return; }
      setStatus('joining');
      const { data: capsule, error: capsuleError } = await supabase
        .from('travel_capsules').select('id, name').eq('id', id).single();
      if (capsuleError || !capsule) {
        setErrorMsg('This capsule link is invalid or has been deleted.');
        setStatus('error'); return;
      }
      setCapsuleName(capsule.name);
      const { data: existing } = await supabase
        .from('travel_capsule_members').select('id')
        .eq('capsule_id', id).eq('user_id', user.id).single();
      if (existing) { setStatus('already'); return; }
      const { error: joinError } = await supabase
        .from('travel_capsule_members')
        .insert({ capsule_id: id, user_id: user.id, is_paid: false });
      if (joinError) throw joinError;
      setStatus('success');
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Something went wrong.');
      setStatus('error');
    }
  };

  const goToTrips = () => router.replace('/(tabs)/trips');

  return (
    <View style={styles.root}>
      {(status === 'loading' || status === 'joining') && (
        <>
          <ActivityIndicator color="#C8A96E" size="large" />
          <Text style={styles.loadingText}>
            {status === 'loading' ? 'Checking invite...' : 'Joining capsule...'}
          </Text>
        </>
      )}
      {status === 'success' && (
        <>
          <Text style={styles.emoji}>✈️</Text>
          <Text style={styles.title}>{"You're in!"}</Text>
          <Text style={styles.sub}>{"You've joined "}{capsuleName}</Text>
          <TouchableOpacity style={styles.btn} onPress={goToTrips}>
            <Text style={styles.btnText}>Open Capsule</Text>
          </TouchableOpacity>
        </>
      )}
      {status === 'already' && (
        <>
          <Text style={styles.emoji}>👋</Text>
          <Text style={styles.title}>Already joined</Text>
          <Text style={styles.sub}>{"You're already a member of "}{capsuleName}</Text>
          <TouchableOpacity style={styles.btn} onPress={goToTrips}>
            <Text style={styles.btnText}>Go to Trips</Text>
          </TouchableOpacity>
        </>
      )}
      {status === 'error' && (
        <>
          <Text style={styles.emoji}>❌</Text>
          <Text style={styles.title}>{"Couldn't join"}</Text>
          <Text style={styles.sub}>{errorMsg}</Text>
          <TouchableOpacity style={styles.btn} onPress={goToTrips}>
            <Text style={styles.btnText}>Go to Trips</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E0E12', alignItems: 'center', justifyContent: 'center', padding: 40 },
  emoji: { fontSize: 64, marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '800', color: '#F0EDE8', marginBottom: 8, textAlign: 'center' },
  sub: { fontSize: 15, color: '#8A8799', textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  loadingText: { fontSize: 15, color: '#8A8799', marginTop: 16 },
  btn: { backgroundColor: '#C8A96E', borderRadius: 24, paddingHorizontal: 32, paddingVertical: 14 },
  btnText: { color: '#0E0E12', fontWeight: '800', fontSize: 16 },
});
