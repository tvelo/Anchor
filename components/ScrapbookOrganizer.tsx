import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Image, ActivityIndicator, LayoutAnimation, Platform, UIManager } from 'react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '../lib/supabase';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Page = any;

type ScrapbookOrganizerProps = {
  visible: boolean;
  onClose: () => void;
  pages: Page[];
  onUpdate: (updatedPages: Page[]) => void;
  onJumpToPage: (index: number) => void;
}

export default function ScrapbookOrganizer({ visible, onClose, pages, onUpdate, onJumpToPage }: ScrapbookOrganizerProps) {
  const [localPages, setLocalPages] = useState<Page[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setLocalPages([...pages].sort((a,b) => a.sequence_index - b.sequence_index));
    }
  }, [visible, pages]);

  const movePage = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= localPages.length) return;

    // Haptic feedback for tactile feel
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Animate the row swap
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

    const newPages = [...localPages];
    [newPages[index], newPages[target]] = [newPages[target], newPages[index]];
    
    // update indexes
    const final = newPages.map((p, i) => ({ ...p, sequence_index: i }));
    setLocalPages(final);
    
    // Save to DB immediately or on close? Immediate is safer for data integrity
    setSaving(true);
    try {
      await Promise.all(final.map(p => 
        supabase.from('scrapbook_entries').update({ sequence_index: p.sequence_index }).eq('id', p.id)
      ));
      onUpdate(final);
    } catch (e) {
      console.error('Failed to save order', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.overlay}>
        <View style={st.sheet}>
          <View style={st.header}>
            <Text style={st.title}>Organize Pages</Text>
            {saving && <ActivityIndicator size="small" color="#C9956C" style={{ marginLeft: 8 }} />}
            <TouchableOpacity onPress={onClose} style={st.doneBtn}>
              <Text style={st.doneText}>Done</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={st.list}>
            {localPages.map((page, index) => (
              <View key={page.id} style={st.row}>
                <TouchableOpacity 
                   style={st.thumbnailWrap} 
                   onPress={() => { onJumpToPage(index); onClose(); }}
                >
                  {page.bg_photo_url ? (
                    <Image source={{ uri: page.bg_photo_url }} style={st.thumbnail} />
                  ) : (
                    <View style={[st.thumbnail, { backgroundColor: page.bg_color || '#fff' }]} />
                  )}
                  <View style={st.indexBadge}><Text style={st.indexText}>{index + 1}</Text></View>
                </TouchableOpacity>

                <View style={st.info}>
                  <Text style={st.pageName}>Page {index + 1}</Text>
                  <Text style={st.pageId}>ID: {page.id.slice(0, 8)}</Text>
                </View>

                <View style={st.controls}>
                  <TouchableOpacity 
                    style={[st.arrowBtn, index === 0 && { opacity: 0.3 }]} 
                    disabled={index === 0 || saving}
                    onPress={() => movePage(index, -1)}
                  >
                    <Text style={st.arrow}>↑</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[st.arrowBtn, index === localPages.length - 1 && { opacity: 0.3 }]} 
                    disabled={index === localPages.length - 1 || saving}
                    onPress={() => movePage(index, 1)}
                  >
                    <Text style={st.arrow}>↓</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { 
    backgroundColor: '#1A1118', 
    height: '80%', 
    borderTopLeftRadius: 32, 
    borderTopRightRadius: 32,
    borderWidth: 1,
    borderColor: '#3D2E52'
  },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    padding: 24,
    borderBottomWidth: 1,
    borderColor: '#3D2E52'
  },
  title: { color: '#F5EEF8', fontSize: 18, fontWeight: '800' },
  doneBtn: { backgroundColor: '#C9956C', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  doneText: { color: '#1A1118', fontWeight: '700', fontSize: 14 },
  
  list: { padding: 16 },
  row: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#2D2040', 
    borderRadius: 20, 
    padding: 12, 
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#3D2E52'
  },
  thumbnailWrap: { width: 60, height: 80, borderRadius: 12, overflow: 'hidden', backgroundColor: '#3D2E52' },
  thumbnail: { width: '100%', height: '100%' },
  indexBadge: { 
    position: 'absolute', 
    top: 4, 
    left: 4, 
    backgroundColor: 'rgba(0,0,0,0.6)', 
    width: 18, 
    height: 18, 
    borderRadius: 9, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  indexText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  
  info: { flex: 1, marginLeft: 16 },
  pageName: { color: '#F5EEF8', fontSize: 16, fontWeight: '700' },
  pageId: { color: '#9B8FAD', fontSize: 11, marginTop: 2 },
  
  controls: { flexDirection: 'row', gap: 8 },
  arrowBtn: { 
    width: 40, 
    height: 40, 
    borderRadius: 20, 
    backgroundColor: '#3D2E52', 
    alignItems: 'center', 
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#C9956C40'
  },
  arrow: { color: '#C9956C', fontSize: 20, fontWeight: '800' }
});
