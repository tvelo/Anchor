export type WidgetType = 'photo' | 'note' | 'song' | 'countdown' | 'mood' | 'capsule' | 'weather' | 'homewidget' | 'sticker' | 'link' | 'voice' | 'photostack' | 'map' | 'poll' | 'knock'

export type ActiveModal = null | 'note' | 'song' | 'countdown' | 'weather' | 'capsule' | 'bgmusic' | 'background' | 'homewidget' | 'sticker' | 'link' | 'templates' | 'voice' | 'photostack' | 'map' | 'poll' | 'knock'

export type Widget = {
  id: string; canvas_id: string; type: WidgetType
  x: number; y: number; width: number; height: number
  z_index: number; content: any; style: any
}

export type WidgetItemProps = {
  widget: Widget
  canvasScale: import('react-native-reanimated').SharedValue<number>
  userId: string
  now: Date
  playingSongWidgetId: string | null
  recordingWidgetId: string | null
  allWidgets: Widget[]
  hwCaptureRef: React.RefObject<any>
  onDragEnd: (id: string, x: number, y: number) => void
  onDelete: (id: string) => void
  onStyleOpen: (w: Widget) => void
  onMoodTap: (id: string) => void
  onSongPlay: (id: string, url: string) => void
  onResize: (id: string, w: number, h: number) => void
  onRotate: (id: string, deg: number) => void
  onBringToFront: (id: string) => void
}
