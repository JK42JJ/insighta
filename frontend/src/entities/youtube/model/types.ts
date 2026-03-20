// YouTube Sync Types
// Generated from Supabase migration: 20251220000001_youtube_sync_tables.sql

export type SyncInterval = '1h' | '6h' | '12h' | '24h' | 'manual';
export type SyncStatus = 'pending' | 'syncing' | 'completed' | 'failed';
export type SyncHistoryStatus = 'started' | 'completed' | 'failed';

// Database table types (snake_case for DB compatibility)
export interface YouTubeSyncSettings {
  id: string;
  user_id: string;
  sync_interval: SyncInterval;
  auto_sync_enabled: boolean;
  youtube_access_token: string | null;
  youtube_refresh_token: string | null;
  youtube_token_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface YouTubePlaylist {
  id: string;
  user_id: string;
  youtube_playlist_id: string;
  youtube_playlist_url: string;
  title: string | null;
  description: string | null;
  thumbnail_url: string | null;
  channel_title: string | null;
  item_count: number;
  last_synced_at: string | null;
  sync_status: SyncStatus;
  sync_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface YouTubeVideo {
  id: string;
  youtube_video_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  channel_title: string | null;
  duration_seconds: number | null;
  published_at: string | null;
  view_count: number | null;
  like_count: number | null;
  created_at: string;
  updated_at: string;
}

export interface YouTubePlaylistItem {
  id: string;
  playlist_id: string;
  video_id: string;
  position: number;
  added_at: string;
  removed_at: string | null;
}

export interface UserVideoState {
  id: string;
  user_id: string;
  video_id: string;
  is_in_ideation: boolean;
  user_note: string | null;
  watch_position_seconds: number;
  is_watched: boolean;
  cell_index: number;
  level_id: string;
  mandala_id: string | null;
  sort_order: number | null;
  added_to_ideation_at: string;
  created_at: string;
  updated_at: string;
}

export interface YouTubeSyncHistory {
  id: string;
  playlist_id: string;
  status: SyncHistoryStatus;
  started_at: string;
  completed_at: string | null;
  items_added: number;
  items_removed: number;
  error_message: string | null;
  quota_used: number;
}

// Extended types with relations (for frontend use)
export interface YouTubePlaylistWithItems extends YouTubePlaylist {
  items?: YouTubePlaylistItemWithVideo[];
}

export interface YouTubePlaylistItemWithVideo extends YouTubePlaylistItem {
  video?: YouTubeVideo;
}

export interface UserVideoStateWithVideo extends UserVideoState {
  video?: YouTubeVideo;
  video_summary?: {
    summary_en: string;
    summary_ko: string;
    tags: string[];
    model: string;
  };
}

// Input types for mutations
export interface AddPlaylistInput {
  youtube_playlist_url: string;
}

export interface UpdateSyncSettingsInput {
  sync_interval?: SyncInterval;
  auto_sync_enabled?: boolean;
}

export interface UpdateVideoStateInput {
  is_in_ideation?: boolean;
  user_note?: string;
  watch_position_seconds?: number;
  is_watched?: boolean;
  cell_index?: number;
  level_id?: string;
  mandala_id?: string | null;
  sort_order?: number;
}

// API Response types
export interface YouTubeAuthUrlResponse {
  authUrl: string;
}

export interface YouTubeAuthCallbackResponse {
  success: boolean;
  user_id: string;
}

export interface YouTubeSyncResponse {
  success: boolean;
  playlist_id: string;
  items_added: number;
  items_removed: number;
  quota_used: number;
}

// OAuth state
export interface YouTubeAuthState {
  isConnected: boolean;
  isLoading: boolean;
  expiresAt: Date | null;
}
