import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { FILTERS, getFilter } from '../lib/photoFilters'
import { useTheme } from '../lib/ThemeContext'

interface Props {
  imageUri: string
  selected: string
  onSelect: (key: string) => void
}

export default function PhotoFilterPicker({ imageUri, selected, onSelect }: Props) {
  const { colors: C } = useTheme()

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.row}
      style={[s.container, { backgroundColor: C.surface, borderTopColor: C.border }]}
    >
      {FILTERS.map(filter => {
        const isActive = selected === filter.key
        const f = getFilter(filter.key)

        return (
          <TouchableOpacity
            key={filter.key}
            style={[s.item, isActive && { borderColor: C.accent, borderWidth: 2 }]}
            onPress={() => onSelect(filter.key)}
            activeOpacity={0.7}
          >
            <View style={s.thumbWrap}>
              <Image source={{ uri: imageUri }} style={[s.thumb, f.imageOpacity != null ? { opacity: f.imageOpacity } : undefined]} resizeMode="cover" />
              {f.overlay && (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: f.overlay.color, opacity: f.overlay.opacity, borderRadius: 8 }]} />
              )}
            </View>
            <Text style={[s.label, { color: isActive ? C.accent : C.textSecondary }]} numberOfLines={1}>{filter.label}</Text>
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
}

const s = StyleSheet.create({
  container: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  row: { paddingHorizontal: 12, gap: 10 },
  item: { alignItems: 'center', borderRadius: 10, borderWidth: 2, borderColor: 'transparent', padding: 2 },
  thumbWrap: { width: 64, height: 64, borderRadius: 8, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  label: { fontSize: 11, fontWeight: '600', marginTop: 4, textAlign: 'center' },
})
