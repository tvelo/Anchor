import React, { useEffect, useState } from 'react'
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native'

interface Props {
  visible: boolean
  title: string
  message?: string
  placeholder?: string
  initialValue?: string
  submitLabel?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

export function PromptModal({
  visible, title, message, placeholder, initialValue = '',
  submitLabel = 'Create', onSubmit, onCancel,
}: Props) {
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (visible) setValue(initialValue)
  }, [visible, initialValue])

  const handleSubmit = () => {
    if (!value.trim()) return
    onSubmit(value.trim())
    setValue('')
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={s.card}>
          <Text style={s.title}>{title}</Text>
          {message ? <Text style={s.message}>{message}</Text> : null}
          <TextInput
            style={s.input}
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor="#9B8FAD"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
            accessibilityLabel={placeholder ?? title}
          />
          <View style={s.row}>
            <TouchableOpacity
              style={s.btnSec}
              onPress={() => { setValue(''); onCancel() }}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={s.btnSecText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.btnPri, !value.trim() && { opacity: 0.4 }]}
              onPress={handleSubmit}
              disabled={!value.trim()}
              accessibilityRole="button"
              accessibilityLabel={submitLabel}
              accessibilityState={{ disabled: !value.trim() }}
            >
              <Text style={s.btnPriText}>{submitLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const s = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center',
  },
  card: {
    backgroundColor: '#2A2035', borderRadius: 16, padding: 24,
    width: '85%', gap: 16, borderWidth: 1, borderColor: '#3D2E52',
  },
  title: { fontSize: 17, fontWeight: '700', color: '#F5EEF8' },
  message: { fontSize: 14, color: '#9B8FAD', marginTop: -8 },
  input: {
    borderWidth: 1, borderColor: '#3D2E52', borderRadius: 10,
    padding: 12, fontSize: 15, color: '#F5EEF8', backgroundColor: '#1A1118',
  },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  btnPri: {
    backgroundColor: '#C9956C', borderRadius: 10,
    paddingHorizontal: 18, paddingVertical: 11,
  },
  btnPriText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnSec: {
    backgroundColor: '#3D2E52', borderRadius: 10,
    paddingHorizontal: 18, paddingVertical: 11,
  },
  btnSecText: { color: '#F5EEF8', fontSize: 14 },
})
