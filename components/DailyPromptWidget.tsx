import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';

export type DailyPromptData = {
  id: string;
  question: string;
  category: string;
};

type Props = {
  spaceId: string;
  userId: string;
  onPress: () => void;
  textColor?: string;
  backgroundColor?: string;
};

export default function DailyPromptWidget({ spaceId, userId, onPress, textColor = '#F5EEF8', backgroundColor = '#2D2040' }: Props) {
  const [prompt, setPrompt] = useState<DailyPromptData | null>(null);
  const [myResponse, setMyResponse] = useState<string | null>(null);
  const [partnerResponse, setPartnerResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [inputText, setInputText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      // Pick question based on day of year
      const now = new Date();
      const start = new Date(now.getFullYear(), 0, 0);
      const diff = now.getTime() - start.getTime();
      const oneDay = 1000 * 60 * 60 * 24;
      const dayOfYear = Math.floor(diff / oneDay);

      // Get prompts
      const { data: prompts } = await supabase.from('daily_prompts').select('*').order('sort_order', { ascending: true });
      if (!prompts || prompts.length === 0) {
        setLoading(false);
        return;
      }

      const todayPrompt = prompts[dayOfYear % prompts.length] as DailyPromptData;
      setPrompt(todayPrompt);

      // Fetch responses for today
      const { data: responses } = await supabase
        .from('prompt_responses')
        .select('*')
        .eq('space_id', spaceId)
        .eq('prompt_id', todayPrompt.id);

      if (responses) {
        const mine = responses.find(r => r.user_id === userId);
        const other = responses.find(r => r.user_id !== userId);
        if (mine) setMyResponse(mine.response);
        if (other) setPartnerResponse(other.response);
      }
      setLoading(false);
    }
    load();
  }, [spaceId, userId]);

  const handleSubmit = async () => {
    if (!prompt || !inputText.trim()) return;
    setSubmitting(true);
    
    const { error } = await supabase.from('prompt_responses').insert({
      space_id: spaceId,
      prompt_id: prompt.id,
      user_id: userId,
      response: inputText.trim(),
    });

    if (error) {
      Alert.alert('Error', 'Could not save your response');
    } else {
      setMyResponse(inputText.trim());
    }
    setSubmitting(false);
  };

  const handlePress = () => {
    // We override SpaceCanvas's onMoodTap essentially by opening our own modal
    setModalVisible(true);
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor }]}>
        <Text style={[styles.loadingText, { color: textColor, opacity: 0.5 }]}>Loading prompt...</Text>
      </View>
    );
  }

  if (!prompt) {
    return (
      <View style={[styles.container, { backgroundColor }]}>
        <Text style={[styles.loadingText, { color: textColor }]}>No prompts available</Text>
      </View>
    );
  }

  const bothAnswered = !!myResponse && !!partnerResponse;

  return (
    <>
      <TouchableOpacity activeOpacity={0.8} onPress={handlePress} style={[styles.container, { backgroundColor }]}>
        <View style={styles.header}>
          <Text style={styles.headerLabel}>📝 Daily Prompt</Text>
          <Text style={styles.headerCategory}>{prompt.category.toUpperCase()}</Text>
        </View>
        <Text style={[styles.question, { color: textColor }]} numberOfLines={3}>{prompt.question}</Text>
        
        <View style={styles.statusRow}>
          <View style={styles.statusPill}>
            <Text style={styles.statusText}>You: {myResponse ? '✅' : '⏳'}</Text>
          </View>
          <View style={styles.statusPill}>
            <Text style={styles.statusText}>Partner: {partnerResponse ? '✅' : '⏳'}</Text>
          </View>
        </View>
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            
            <View style={styles.modalHeader}>
              <Text style={styles.modalCategory}>{prompt.category.toUpperCase()}</Text>
              <Text style={styles.modalQuestion}>{prompt.question}</Text>
            </View>

            <View style={styles.responsesContainer}>
              {/* My Response */}
              <View style={styles.responseBox}>
                <Text style={styles.responseLabel}>You</Text>
                {myResponse ? (
                  <Text style={styles.responseText}>{myResponse}</Text>
                ) : (
                  <View>
                    <TextInput
                      style={styles.input}
                      placeholder="Type your answer..."
                      placeholderTextColor="#9B8FAD"
                      value={inputText}
                      onChangeText={setInputText}
                      multiline
                    />
                    <TouchableOpacity style={styles.btnPri} onPress={handleSubmit} disabled={submitting || !inputText.trim()}>
                      {submitting ? <ActivityIndicator size="small" color="#1A1118" /> : <Text style={styles.btnPriText}>Submit</Text>}
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Partner Response */}
              <View style={[styles.responseBox, { marginTop: 12 }]}>
                <Text style={styles.responseLabel}>Partner</Text>
                {partnerResponse ? (
                  myResponse ? (
                    <Text style={styles.responseText}>{partnerResponse}</Text>
                  ) : (
                    <View style={styles.blurBox}>
                      <Text style={styles.blurText}>Answer to reveal their response 🔒</Text>
                    </View>
                  )
                ) : (
                  <Text style={styles.waitingText}>Waiting for them to answer...</Text>
                )}
              </View>
            </View>

            <TouchableOpacity style={styles.btnSec} onPress={() => setModalVisible(false)}>
              <Text style={styles.btnSecText}>Close</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
    padding: 14,
    justifyContent: 'space-between',
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#C9956C',
    textTransform: 'uppercase',
  },
  headerCategory: {
    fontSize: 9,
    fontWeight: '700',
    color: '#9B8FAD',
  },
  question: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    flex: 1,
  },
  statusRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  statusPill: {
    backgroundColor: '#3D2E5280',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 10,
    color: '#F5EEF8',
    fontWeight: '600',
  },
  
  // Modal Styles
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#221A2C',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '90%',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#3D2E52',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  modalHeader: {
    marginBottom: 24,
  },
  modalCategory: {
    fontSize: 11,
    color: '#C9956C',
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  modalQuestion: {
    fontSize: 22,
    color: '#F5EEF8',
    fontWeight: '800',
    lineHeight: 28,
  },
  responsesContainer: {
    marginBottom: 24,
  },
  responseBox: {
    backgroundColor: '#1A1118',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#3D2E52',
  },
  responseLabel: {
    fontSize: 12,
    color: '#9B8FAD',
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  responseText: {
    fontSize: 16,
    color: '#F5EEF8',
    lineHeight: 24,
  },
  input: {
    backgroundColor: '#2D2040',
    color: '#F5EEF8',
    fontSize: 16,
    borderRadius: 12,
    padding: 16,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  blurBox: {
    height: 80,
    backgroundColor: '#2D204060',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blurText: {
    color: '#9B8FAD',
    fontSize: 12,
    fontWeight: '600',
  },
  waitingText: {
    color: '#9B8FAD',
    fontSize: 14,
    fontStyle: 'italic',
  },
  btnPri: {
    backgroundColor: '#C9956C',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnPriText: {
    color: '#1A1118',
    fontSize: 16,
    fontWeight: '700',
  },
  btnSec: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  btnSecText: {
    color: '#9B8FAD',
    fontSize: 16,
    fontWeight: '700',
  },
});
