// Predefined widget layout templates that users can apply to quickly populate a space.
// Each template defines a set of widget positions, types, and default content.

const CANVAS_CENTER = 2000

export interface TemplateWidget {
  type: 'photo' | 'note' | 'song' | 'countdown' | 'mood' | 'sticker'
  x: number
  y: number
  width: number
  height: number
  content: Record<string, any>
  style?: Record<string, any>
}

export interface WidgetTemplate {
  id: string
  name: string
  emoji: string
  description: string
  widgets: TemplateWidget[]
}

export const WIDGET_TEMPLATES: WidgetTemplate[] = [
  {
    id: 'memories',
    name: 'Memory Board',
    emoji: '📸',
    description: 'A photo grid with notes — perfect for shared memories',
    widgets: [
      { type: 'note', x: CANVAS_CENTER - 280, y: CANVAS_CENTER - 200, width: 240, height: 120, content: { text: 'Our favourite memories ✨' }, style: { backgroundColor: '#2D2040', textColor: '#C9956C', fontSize: 16 } },
      { type: 'photo', x: CANVAS_CENTER - 280, y: CANVAS_CENTER - 60, width: 240, height: 240, content: {} },
      { type: 'photo', x: CANVAS_CENTER + 10, y: CANVAS_CENTER - 200, width: 260, height: 180, content: {} },
      { type: 'photo', x: CANVAS_CENTER + 10, y: CANVAS_CENTER + 10, width: 260, height: 200, content: {} },
      { type: 'mood', x: CANVAS_CENTER - 280, y: CANVAS_CENTER + 210, width: 220, height: 140, content: { moods: {} } },
    ],
  },
  {
    id: 'countdown',
    name: 'Event Countdown',
    emoji: '⏳',
    description: 'Count down to your special event with mood & notes',
    widgets: [
      { type: 'countdown', x: CANVAS_CENTER - 160, y: CANVAS_CENTER - 180, width: 320, height: 160, content: { targetDate: '', label: 'The big day!' }, style: { backgroundColor: '#1A2F1E', textColor: '#22C55E' } },
      { type: 'note', x: CANVAS_CENTER - 160, y: CANVAS_CENTER + 10, width: 320, height: 100, content: { text: 'Things to prepare...' }, style: { backgroundColor: '#2D2040' } },
      { type: 'mood', x: CANVAS_CENTER - 160, y: CANVAS_CENTER + 140, width: 220, height: 140, content: { moods: {} } },
      { type: 'sticker', x: CANVAS_CENTER + 100, y: CANVAS_CENTER + 140, width: 100, height: 100, content: { emoji: '🎉' } },
    ],
  },
  {
    id: 'music',
    name: 'Music Wall',
    emoji: '🎵',
    description: 'Share your favourite songs and vibes',
    widgets: [
      { type: 'note', x: CANVAS_CENTER - 300, y: CANVAS_CENTER - 160, width: 200, height: 80, content: { text: 'Our soundtrack 🎶' }, style: { backgroundColor: '#2D2040', textColor: '#B8A9D9' } },
      { type: 'song', x: CANVAS_CENTER - 300, y: CANVAS_CENTER - 60, width: 280, height: 130, content: { songName: '', artist: '' } },
      { type: 'song', x: CANVAS_CENTER + 20, y: CANVAS_CENTER - 160, width: 280, height: 130, content: { songName: '', artist: '' } },
      { type: 'song', x: CANVAS_CENTER + 20, y: CANVAS_CENTER + 0, width: 280, height: 130, content: { songName: '', artist: '' } },
      { type: 'song', x: CANVAS_CENTER - 300, y: CANVAS_CENTER + 100, width: 280, height: 130, content: { songName: '', artist: '' } },
      { type: 'mood', x: CANVAS_CENTER + 20, y: CANVAS_CENTER + 160, width: 220, height: 140, content: { moods: {} } },
    ],
  },
  {
    id: 'minimal',
    name: 'Minimal',
    emoji: '◼',
    description: 'A clean, simple layout with just the essentials',
    widgets: [
      { type: 'note', x: CANVAS_CENTER - 150, y: CANVAS_CENTER - 120, width: 300, height: 100, content: { text: '' }, style: { backgroundColor: '#1A1118', textColor: '#F5EEF8' } },
      { type: 'photo', x: CANVAS_CENTER - 150, y: CANVAS_CENTER + 10, width: 300, height: 250, content: {} },
    ],
  },
]
