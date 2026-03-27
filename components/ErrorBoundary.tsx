import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'

interface State { hasError: boolean; error?: Error }

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode; onReset?: () => void },
  State
> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
  }

  reset = () => {
    this.setState({ hasError: false, error: undefined })
    this.props.onReset?.()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <View style={s.container}>
          <Text style={s.icon}>⚠️</Text>
          <Text style={s.text}>This item failed to load</Text>
          <TouchableOpacity
            style={s.btn}
            onPress={this.reset}
            accessibilityRole="button"
            accessibilityLabel="Retry loading"
          >
            <Text style={s.btnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )
    }
    return this.props.children
  }
}

const s = StyleSheet.create({
  container: {
    padding: 12, borderRadius: 10, backgroundColor: '#2A1525',
    borderWidth: 1, borderColor: '#5C2A2A', alignItems: 'center', gap: 6,
  },
  icon: { fontSize: 20 },
  text: { fontSize: 12, color: '#E07070' },
  btn: {
    backgroundColor: '#EF4444', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  btnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
})
