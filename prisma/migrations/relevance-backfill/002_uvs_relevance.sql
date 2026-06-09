-- CP498 PR3b — A-stage relevance on user_video_states (the dominant placed-card
-- store: 6034 placed vs 77 in user_local_cards). Same pattern as PR3a's
-- 001_add_relevance.sql (user_local_cards): idempotent, nullable, user-scoped.
--
-- user_video_states is keyed unique (user_id, video_id) → the score is
-- user-scoped, so it never leaks across users (unlike the video-keyed
-- video_rich_summaries.mandala_relevance_pct).
--
-- Apply to local + prod, verify `\d user_video_states` on BOTH (Supabase
-- prisma db push silent-fail path, CLAUDE.md). NULL = not yet backfilled.

ALTER TABLE public.user_video_states
  ADD COLUMN IF NOT EXISTS relevance_pct INTEGER;

ALTER TABLE public.user_video_states
  ADD COLUMN IF NOT EXISTS relevance_at TIMESTAMPTZ;
