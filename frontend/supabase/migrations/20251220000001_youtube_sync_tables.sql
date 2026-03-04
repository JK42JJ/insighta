-- YouTube Playlist Sync Tables Migration
-- Created: 2024-12-20

-- 1. 사용자 동기화 설정
CREATE TABLE IF NOT EXISTS youtube_sync_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sync_interval TEXT NOT NULL DEFAULT 'manual' CHECK (sync_interval IN ('1h', '6h', '12h', '24h', 'manual')),
  auto_sync_enabled BOOLEAN NOT NULL DEFAULT false,
  youtube_access_token TEXT,
  youtube_refresh_token TEXT,
  youtube_token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- 2. YouTube 플레이리스트
CREATE TABLE IF NOT EXISTS youtube_playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  youtube_playlist_id TEXT NOT NULL,
  youtube_playlist_url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  thumbnail_url TEXT,
  channel_title TEXT,
  item_count INTEGER DEFAULT 0,
  last_synced_at TIMESTAMPTZ,
  sync_status TEXT DEFAULT 'pending' CHECK (sync_status IN ('pending', 'syncing', 'completed', 'failed')),
  sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, youtube_playlist_id)
);

-- 3. 동영상 메타데이터 (공유 리소스)
CREATE TABLE IF NOT EXISTS youtube_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_video_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  channel_title TEXT,
  duration_seconds INTEGER,
  published_at TIMESTAMPTZ,
  view_count BIGINT,
  like_count BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. 플레이리스트-동영상 연결 (Junction table)
CREATE TABLE IF NOT EXISTS youtube_playlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES youtube_playlists(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES youtube_videos(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  UNIQUE(playlist_id, video_id)
);

-- 5. 사용자별 동영상 상태 (아이디에이션 팔레트용)
CREATE TABLE IF NOT EXISTS user_video_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES youtube_videos(id) ON DELETE CASCADE,
  is_in_ideation BOOLEAN NOT NULL DEFAULT true,
  user_note TEXT,
  watch_position_seconds INTEGER DEFAULT 0,
  is_watched BOOLEAN DEFAULT false,
  cell_index INTEGER DEFAULT -1,
  level_id TEXT DEFAULT 'scratchpad',
  sort_order INTEGER,
  added_to_ideation_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, video_id)
);

-- 6. 동기화 히스토리 (디버깅용)
CREATE TABLE IF NOT EXISTS youtube_sync_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES youtube_playlists(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  items_added INTEGER DEFAULT 0,
  items_removed INTEGER DEFAULT 0,
  error_message TEXT,
  quota_used INTEGER DEFAULT 0
);

-- Enable Row Level Security
ALTER TABLE youtube_sync_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE youtube_playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE youtube_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE youtube_playlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_video_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE youtube_sync_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for youtube_sync_settings
CREATE POLICY "Users can view own sync settings"
  ON youtube_sync_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sync settings"
  ON youtube_sync_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sync settings"
  ON youtube_sync_settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own sync settings"
  ON youtube_sync_settings FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for youtube_playlists
CREATE POLICY "Users can view own playlists"
  ON youtube_playlists FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own playlists"
  ON youtube_playlists FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own playlists"
  ON youtube_playlists FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own playlists"
  ON youtube_playlists FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for youtube_videos (shared resource - read only for users)
CREATE POLICY "Authenticated users can read videos"
  ON youtube_videos FOR SELECT
  USING (auth.role() = 'authenticated');

-- Allow service role to insert/update videos (Edge Functions)
CREATE POLICY "Service role can manage videos"
  ON youtube_videos FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- RLS Policies for youtube_playlist_items
CREATE POLICY "Users can view own playlist items"
  ON youtube_playlist_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM youtube_playlists
      WHERE youtube_playlists.id = youtube_playlist_items.playlist_id
      AND youtube_playlists.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage playlist items"
  ON youtube_playlist_items FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- RLS Policies for user_video_states
CREATE POLICY "Users can view own video states"
  ON user_video_states FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own video states"
  ON user_video_states FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own video states"
  ON user_video_states FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own video states"
  ON user_video_states FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for youtube_sync_history
CREATE POLICY "Users can view own sync history"
  ON youtube_sync_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM youtube_playlists
      WHERE youtube_playlists.id = youtube_sync_history.playlist_id
      AND youtube_playlists.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage sync history"
  ON youtube_sync_history FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_youtube_playlists_user_id ON youtube_playlists(user_id);
CREATE INDEX IF NOT EXISTS idx_youtube_playlist_items_playlist_id ON youtube_playlist_items(playlist_id);
CREATE INDEX IF NOT EXISTS idx_youtube_playlist_items_video_id ON youtube_playlist_items(video_id);
CREATE INDEX IF NOT EXISTS idx_user_video_states_user_id ON user_video_states(user_id);
CREATE INDEX IF NOT EXISTS idx_user_video_states_video_id ON user_video_states(video_id);
CREATE INDEX IF NOT EXISTS idx_user_video_states_ideation ON user_video_states(user_id, is_in_ideation) WHERE is_in_ideation = true;
CREATE INDEX IF NOT EXISTS idx_youtube_sync_history_playlist_id ON youtube_sync_history(playlist_id);

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for auto-updating updated_at
CREATE TRIGGER update_youtube_sync_settings_updated_at
  BEFORE UPDATE ON youtube_sync_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_youtube_playlists_updated_at
  BEFORE UPDATE ON youtube_playlists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_youtube_videos_updated_at
  BEFORE UPDATE ON youtube_videos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_video_states_updated_at
  BEFORE UPDATE ON user_video_states
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
