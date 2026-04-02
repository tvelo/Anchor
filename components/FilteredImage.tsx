import { Image, type ImageResizeMode, type ImageStyle, StyleSheet, View, type ViewStyle } from 'react-native'
import { getFilter } from '../lib/photoFilters'

interface Props {
  uri: string
  filter?: string
  style: ImageStyle
  containerStyle?: ViewStyle
  resizeMode?: ImageResizeMode
}

export default function FilteredImage({ uri, filter, style, containerStyle, resizeMode = 'cover' }: Props) {
  const f = getFilter(filter ?? 'original')

  return (
    <View style={[{ overflow: 'hidden' }, containerStyle ?? style]}>
      <Image
        source={{ uri }}
        style={[style, f.imageOpacity != null ? { opacity: f.imageOpacity } : undefined]}
        resizeMode={resizeMode}
      />
      {f.overlay && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: f.overlay.color, opacity: f.overlay.opacity }]} />
      )}
    </View>
  )
}
