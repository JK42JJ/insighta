-- ============================================================================
-- CP488 — Search Quality Overhaul / D8 backlog model + D5 user_curated source
-- Migration 003 — recommendation_cache.surfaced_at + video_pool source extension
-- ============================================================================
-- Purpose:
--   D8 — split "BE-recommended" vs "FE-surfaced": surfaced_at IS NULL = BE
--        추천했으나 사용자 화면에 아직 안 노출. 매 search call 은 unsurfaced
--        backlog 우선 소비 + 부족분만 fresh fetch → N차 일관 50-70 노출.
--   D5 — 사용자 like → video_pool 유입을 위한 'user_curated' source. video_pool
--        already uses a free-form VARCHAR(20); no CHECK constraint to relax.
--        This migration is a no-op for video_pool itself but documents the
--        new source value as a comment.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
-- ============================================================================

ALTER TABLE public.recommendation_cache
  ADD COLUMN IF NOT EXISTS surfaced_at TIMESTAMPTZ;

-- Partial index for "fast pickup of unsurfaced, not-yet-expired rows" — the
-- hot query is `SELECT … WHERE user_id, mandala_id, surfaced_at IS NULL,
-- expires_at > NOW() ORDER BY rec_score DESC LIMIT 60`.
CREATE INDEX IF NOT EXISTS idx_rec_cache_unsurfaced_score
  ON public.recommendation_cache (user_id, mandala_id, rec_score DESC)
  WHERE surfaced_at IS NULL;

COMMENT ON COLUMN public.recommendation_cache.surfaced_at IS
  'CP488: NULL = BE recommended but not yet shown to user. timestamptz = first surfaced moment. Updated on response build, never resurfaced (next call picks from remaining NULL rows or fresh fetch).';

-- D5 documentation only — video_pool.source is VARCHAR(20) without CHECK,
-- so 'user_curated' rows can be inserted by cards.ts /like handler directly
-- without any schema relaxation.
COMMENT ON COLUMN public.video_pool.source IS
  'Provenance tag. CP488 known values: batch_trend (Mac Mini cron), v2_promoted (rich-summary-v2 graduate), user_playlist (OAuth sync), user_curated (CP488: user like → fire-and-forget UPSERT).';
