-- =============================================================================
-- RLS Policies for Insighta (public schema)
-- =============================================================================
-- 목적: Supabase Dashboard/Client SDK 직접 접근 시 방어선 역할
-- 전제: Prisma는 postgres 슈퍼유저(또는 BYPASSRLS 권한 보유) 로 연결하므로
--       FORCE ROW LEVEL SECURITY 없이는 RLS bypass됨 → API 레벨은 영향 없음
-- auth.uid() = Supabase Auth JWT의 sub claim (UUID)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. youtube_playlists
--    user_id 직접 보유. 완전한 per-user 격리.
-- -----------------------------------------------------------------------------
ALTER TABLE public.youtube_playlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can select own playlists"  ON public.youtube_playlists;
DROP POLICY IF EXISTS "users can insert own playlists"  ON public.youtube_playlists;
DROP POLICY IF EXISTS "users can update own playlists"  ON public.youtube_playlists;
DROP POLICY IF EXISTS "users can delete own playlists"  ON public.youtube_playlists;

CREATE POLICY "users can select own playlists"
  ON public.youtube_playlists
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users can insert own playlists"
  ON public.youtube_playlists
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users can update own playlists"
  ON public.youtube_playlists
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users can delete own playlists"
  ON public.youtube_playlists
  FOR DELETE
  USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 2. youtube_playlist_items
--    직접 user_id 없음. playlist_id → youtube_playlists.user_id 경유.
-- -----------------------------------------------------------------------------
ALTER TABLE public.youtube_playlist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can select own playlist items"  ON public.youtube_playlist_items;
DROP POLICY IF EXISTS "users can insert own playlist items"  ON public.youtube_playlist_items;
DROP POLICY IF EXISTS "users can update own playlist items"  ON public.youtube_playlist_items;
DROP POLICY IF EXISTS "users can delete own playlist items"  ON public.youtube_playlist_items;

CREATE POLICY "users can select own playlist items"
  ON public.youtube_playlist_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.youtube_playlists p
      WHERE p.id = playlist_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "users can insert own playlist items"
  ON public.youtube_playlist_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.youtube_playlists p
      WHERE p.id = playlist_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "users can update own playlist items"
  ON public.youtube_playlist_items
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.youtube_playlists p
      WHERE p.id = playlist_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "users can delete own playlist items"
  ON public.youtube_playlist_items
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.youtube_playlists p
      WHERE p.id = playlist_id
        AND p.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- 3. youtube_videos
--    user_id 없는 공유 비디오 메타데이터.
--    인증된 사용자 READ 허용, 직접 INSERT/UPDATE/DELETE는 금지
--    (앱 서버(postgres)만 write 가능).
-- -----------------------------------------------------------------------------
ALTER TABLE public.youtube_videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated users can read videos"  ON public.youtube_videos;
DROP POLICY IF EXISTS "no direct insert on videos"           ON public.youtube_videos;
DROP POLICY IF EXISTS "no direct update on videos"           ON public.youtube_videos;
DROP POLICY IF EXISTS "no direct delete on videos"           ON public.youtube_videos;

CREATE POLICY "authenticated users can read videos"
  ON public.youtube_videos
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- INSERT/UPDATE/DELETE 정책 미생성 → 인증 사용자도 직접 write 불가
-- (postgres 롤은 RLS bypass이므로 API 서버는 정상 동작)

-- -----------------------------------------------------------------------------
-- 4. youtube_sync_settings
--    user_id 직접 보유. 1:1 관계.
-- -----------------------------------------------------------------------------
ALTER TABLE public.youtube_sync_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can select own sync settings"  ON public.youtube_sync_settings;
DROP POLICY IF EXISTS "users can insert own sync settings"  ON public.youtube_sync_settings;
DROP POLICY IF EXISTS "users can update own sync settings"  ON public.youtube_sync_settings;
DROP POLICY IF EXISTS "users can delete own sync settings"  ON public.youtube_sync_settings;

CREATE POLICY "users can select own sync settings"
  ON public.youtube_sync_settings
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users can insert own sync settings"
  ON public.youtube_sync_settings
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users can update own sync settings"
  ON public.youtube_sync_settings
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users can delete own sync settings"
  ON public.youtube_sync_settings
  FOR DELETE
  USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 5. youtube_sync_history
--    직접 user_id 없음. playlist_id → youtube_playlists.user_id 경유.
--    이력 데이터이므로 INSERT/UPDATE/DELETE는 앱 서버만 수행.
-- -----------------------------------------------------------------------------
ALTER TABLE public.youtube_sync_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can select own sync history"  ON public.youtube_sync_history;

CREATE POLICY "users can select own sync history"
  ON public.youtube_sync_history
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.youtube_playlists p
      WHERE p.id = playlist_id
        AND p.user_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE: 앱 서버(postgres)만 가능, 직접 접근 금지

-- -----------------------------------------------------------------------------
-- 6. user_video_states
--    user_id 직접 보유.
-- -----------------------------------------------------------------------------
ALTER TABLE public.user_video_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can select own video states"  ON public.user_video_states;
DROP POLICY IF EXISTS "users can insert own video states"  ON public.user_video_states;
DROP POLICY IF EXISTS "users can update own video states"  ON public.user_video_states;
DROP POLICY IF EXISTS "users can delete own video states"  ON public.user_video_states;

CREATE POLICY "users can select own video states"
  ON public.user_video_states
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users can insert own video states"
  ON public.user_video_states
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users can update own video states"
  ON public.user_video_states
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users can delete own video states"
  ON public.user_video_states
  FOR DELETE
  USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 7. user_local_cards
--    user_id 직접 보유.
-- -----------------------------------------------------------------------------
ALTER TABLE public.user_local_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can select own local cards"  ON public.user_local_cards;
DROP POLICY IF EXISTS "users can insert own local cards"  ON public.user_local_cards;
DROP POLICY IF EXISTS "users can update own local cards"  ON public.user_local_cards;
DROP POLICY IF EXISTS "users can delete own local cards"  ON public.user_local_cards;

CREATE POLICY "users can select own local cards"
  ON public.user_local_cards
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users can insert own local cards"
  ON public.user_local_cards
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users can update own local cards"
  ON public.user_local_cards
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users can delete own local cards"
  ON public.user_local_cards
  FOR DELETE
  USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 8. user_ui_preferences
--    user_id 직접 보유. 1:1 관계.
-- -----------------------------------------------------------------------------
ALTER TABLE public.user_ui_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can select own ui preferences"  ON public.user_ui_preferences;
DROP POLICY IF EXISTS "users can insert own ui preferences"  ON public.user_ui_preferences;
DROP POLICY IF EXISTS "users can update own ui preferences"  ON public.user_ui_preferences;
DROP POLICY IF EXISTS "users can delete own ui preferences"  ON public.user_ui_preferences;

CREATE POLICY "users can select own ui preferences"
  ON public.user_ui_preferences
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users can insert own ui preferences"
  ON public.user_ui_preferences
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users can update own ui preferences"
  ON public.user_ui_preferences
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users can delete own ui preferences"
  ON public.user_ui_preferences
  FOR DELETE
  USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 9. user_subscriptions
--    user_id 직접 보유. 1:1 관계.
--    구독 정보는 READ 전용 (등록/변경은 앱 서버 또는 관리자만).
-- -----------------------------------------------------------------------------
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can select own subscription"  ON public.user_subscriptions;
DROP POLICY IF EXISTS "users can insert own subscription"  ON public.user_subscriptions;

CREATE POLICY "users can select own subscription"
  ON public.user_subscriptions
  FOR SELECT
  USING (user_id = auth.uid());

-- INSERT: 앱 서버(postgres)가 계정 생성 시 처리
-- UPDATE/DELETE: 관리자 또는 앱 서버만 수행 → 정책 미생성

-- -----------------------------------------------------------------------------
-- 10. video_notes
--     직접 user_id 없음. video_id → youtube_videos (공유 테이블).
--     user_video_states 경유로 소유자 확인이 가능하나 복잡도가 높음.
--     현재 스키마에서 video_notes는 video_id만 있고 user 연결 없음.
--     → 앱 레벨에서 user_id 컬럼 추가 전까지는 인증 사용자 READ 허용,
--       write는 앱 서버만 가능하도록 설정.
--     주의: video_notes에 user_id 컬럼이 추가되면 정책 업데이트 필요.
-- -----------------------------------------------------------------------------
ALTER TABLE public.video_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated users can read video notes"  ON public.video_notes;

CREATE POLICY "authenticated users can read video notes"
  ON public.video_notes
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- INSERT/UPDATE/DELETE: 앱 서버(postgres)만 가능

-- -----------------------------------------------------------------------------
-- 11. watch_sessions
--     직접 user_id 없음. video_id → youtube_videos (공유 테이블).
--     video_notes와 동일한 이유로 인증 사용자 READ 허용.
--     주의: watch_sessions에 user_id 컬럼이 추가되면 정책 업데이트 필요.
-- -----------------------------------------------------------------------------
ALTER TABLE public.watch_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated users can read watch sessions"  ON public.watch_sessions;

CREATE POLICY "authenticated users can read watch sessions"
  ON public.watch_sessions
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- INSERT/UPDATE/DELETE: 앱 서버(postgres)만 가능

-- -----------------------------------------------------------------------------
-- 12. video_captions
--     직접 user_id 없음. video_id → youtube_videos (공유 메타데이터).
--     캡션은 공개 정보이므로 인증 사용자 전체 READ 허용.
--     write는 앱 서버만.
-- -----------------------------------------------------------------------------
ALTER TABLE public.video_captions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated users can read video captions"  ON public.video_captions;

CREATE POLICY "authenticated users can read video captions"
  ON public.video_captions
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- INSERT/UPDATE/DELETE: 앱 서버(postgres)만 가능

-- -----------------------------------------------------------------------------
-- 13. credentials
--     user_id 컬럼이 TEXT 타입이고 default 'default'를 사용 (UUID 아님).
--     auth.uid()는 UUID 타입이므로 직접 비교 불가.
--     → 이 테이블은 앱 서버 전용으로 완전 잠금 (Dashboard/client 직접 접근 금지).
--     보안 민감 정보(토큰 등) 포함.
-- -----------------------------------------------------------------------------
ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "no direct access to credentials"  ON public.credentials;

-- 정책 없음 = 모든 직접 접근 거부 (postgres 롤은 bypass)
-- 앱 서버(postgres 연결)만 접근 가능

-- -----------------------------------------------------------------------------
-- 14. sync_schedules
--     직접 user_id 없음. playlist_id → youtube_playlists.user_id 경유.
--     스케줄 정보 READ 허용, write는 앱 서버만.
-- -----------------------------------------------------------------------------
ALTER TABLE public.sync_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can select own sync schedules"  ON public.sync_schedules;
DROP POLICY IF EXISTS "users can insert own sync schedules"  ON public.sync_schedules;
DROP POLICY IF EXISTS "users can update own sync schedules"  ON public.sync_schedules;
DROP POLICY IF EXISTS "users can delete own sync schedules"  ON public.sync_schedules;

CREATE POLICY "users can select own sync schedules"
  ON public.sync_schedules
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.youtube_playlists p
      WHERE p.id = playlist_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "users can insert own sync schedules"
  ON public.sync_schedules
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.youtube_playlists p
      WHERE p.id = playlist_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "users can update own sync schedules"
  ON public.sync_schedules
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.youtube_playlists p
      WHERE p.id = playlist_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "users can delete own sync schedules"
  ON public.sync_schedules
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.youtube_playlists p
      WHERE p.id = playlist_id
        AND p.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- 15. quota_usage
--     user_id 없음. 시스템 전역 YouTube API 할당량 추적 테이블.
--     외부에서 직접 접근 금지. 앱 서버만 접근.
-- -----------------------------------------------------------------------------
ALTER TABLE public.quota_usage ENABLE ROW LEVEL SECURITY;

-- 정책 없음 = 모든 직접 접근 거부 (postgres 롤은 bypass)

-- -----------------------------------------------------------------------------
-- 16. quota_operations
--     user_id 없음. quota_usage_id → quota_usage (시스템 테이블).
--     외부에서 직접 접근 금지. 앱 서버만 접근.
-- -----------------------------------------------------------------------------
ALTER TABLE public.quota_operations ENABLE ROW LEVEL SECURITY;

-- 정책 없음 = 모든 직접 접근 거부 (postgres 롤은 bypass)

-- =============================================================================
-- 검증 쿼리 (적용 후 확인용, 실행 시 주석 해제)
-- =============================================================================
-- SELECT schemaname, tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;
--
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
