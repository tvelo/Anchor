// ─── Shared types — single source of truth for the whole app ─────────────────

// Canvas / Spaces
export type PatternKey = 'none' | 'dots' | 'grid' | 'diagonal' | 'hearts' | 'stars' | 'waves'
export type WidgetType = 'photo' | 'note' | 'song' | 'countdown' | 'mood' | 'capsule' | 'weather' | 'homewidget' | 'sticker' | 'link'
export type ActiveModal = null | 'note' | 'song' | 'countdown' | 'weather' | 'capsule' | 'bgmusic' | 'background' | 'homewidget' | 'sticker' | 'link'

export type Widget = {
  id: string
  canvas_id: string
  type: WidgetType
  x: number
  y: number
  width: number
  height: number
  z_index: number
  content: any
  style: any
  created_by?: string
}

export type Space = {
  id: string
  name: string
  owner_id: string
  background_value: string | null
  cover_url?: string | null
  member_count: number
  last_activity: string | null
}

export type SpaceMember = {
  user_id: string
  role: string
  display_name: string
}

// Scrapbook
export type BorderPreset = 'none' | 'floral' | 'hearts' | 'stars' | 'vintage' | 'minimal'

export type Scrapbook = {
  id: string
  name: string
  cover_url: string | null
  canvas_id: string
  created_by: string
  created_at: string
  theme_color: string | null
  entryCount?: number
  bg_music_url?: string | null
  bg_music_name?: string | null
  bg_music_volume?: number
  front_cover?: any
  back_cover?: any
}

export type PageElement = {
  id: string
  type: 'photo' | 'text' | 'sticker'
  x: number
  y: number
  w: number
  h: number
  rotation: number
  zIndex: number
  url?: string
  filter?: string
  text?: string
  fontSize?: number
  fontFamily?: string
  color?: string
  bold?: boolean
  italic?: boolean
  emoji?: string
}

export type Page = {
  id: string
  scrapbook_id: string
  bg_color: string
  bg_photo_url: string | null
  bg_blur: number
  bg_dim: number
  page_size: string
  border_preset?: BorderPreset
  elements: PageElement[]
  added_by: string
  created_at: string
}

export type ScrapbookMember = {
  user_id: string
  can_edit: boolean
  display_name: string
}

// Travel Capsules
export interface TravelCapsule {
  id: string
  name: string
  destination: string
  description: string
  visibility: 'locked' | 'public'
  unlock_date: string | null
  is_unlocked: boolean
  cover_url: string | null
  created_by: string
  canvas_id: string
  media_count: number
  member_count: number
  created_at: string
}

export interface CapsuleMedia {
  id: string
  capsule_id: string
  url: string
  type: 'photo' | 'video'
  uploaded_by: string
  uploader_name: string
  created_at: string
}

export interface CapsuleMember {
  id: string
  capsule_id: string
  user_id: string
  display_name: string
  is_paid: boolean
  joined_at: string
}

// Social
export interface SocialProfile {
  id: string
  username: string
  display_name: string
  bio: string | null
  avatar_url: string | null
  privacy?: 'public' | 'followers' | 'friends'
}

export interface SocialPost {
  id: string
  user_id: string
  type: 'scrapbook' | 'capsule'
  reference_id: string
  caption: string | null
  thumbnail_url: string | null
  title: string | null
  created_at: string
  music_url?: string | null
  music_name?: string | null
  profile?: SocialProfile
  like_count?: number
  liked_by_me?: boolean
  comment_count?: number
  favourited_by_me?: boolean
}

export interface SocialComment {
  id: string
  post_id: string
  user_id: string
  content: string
  created_at: string
  profile?: SocialProfile
}

export interface SavedSong {
  id: string
  post_id: string
  music_url: string
  music_name: string
  created_at: string
}

export interface SlideItem {
  id: string
  type: 'photo' | 'video' | 'page'
  url?: string
  bgColor?: string
  bgPhotoUrl?: string
  bgDim?: number
  elements?: any[]
}

// Home screen
export type RecentActivity = {
  id: string
  type: 'memory' | 'scrapbook' | 'trip'
  title: string
  subtitle: string
  spaceId: string
  spaceName: string
  createdAt: string
  emoji: string
}

export type Friend = {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  is_following_back: boolean
}

export type SearchResult = {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  bio: string | null
}
