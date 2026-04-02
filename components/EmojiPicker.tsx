import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

type EmojiPickerProps = {
  onSelect: (emoji: string) => void;
  onClose: () => void;
};

export default function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const scaleAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 50,
      friction: 7
    }).start();
  }, []);

  return (
    <View style={st.container}>
      <Animated.View style={[st.picker, { transform: [{ scale: scaleAnim }] }]}>
        {EMOJIS.map((emoji) => (
          <TouchableOpacity 
            key={emoji} 
            onPress={() => {
              onSelect(emoji);
              onClose();
            }}
            style={st.emojiBtn}
          >
            <Text style={st.emojiText}>{emoji}</Text>
          </TouchableOpacity>
        ))}
      </Animated.View>
      <TouchableOpacity style={st.backdrop} onPress={onClose} />
    </View>
  );
}

const st = StyleSheet.create({
  container: {
    position: 'absolute',
    top: -50,
    left: 20,
    zIndex: 1000,
    flexDirection: 'row',
    alignItems: 'center',
  },
  picker: {
    flexDirection: 'row',
    backgroundColor: '#2D2040',
    borderRadius: 30,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#3D2E52',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
    zIndex: 1001,
  },
  emojiBtn: {
    paddingHorizontal: 8,
  },
  emojiText: {
    fontSize: 24,
  },
  backdrop: {
    position: 'fixed',
    top: -1000,
    left: -1000,
    right: 1000,
    bottom: 1000,
    zIndex: 999,
  }
});
