-- CP498 PR3a — A-stage relevance, user-scoped on user_local_cards.
-- Idempotent (ADD COLUMN IF NOT EXISTS) to survive the Supabase `prisma db push`
-- silent-fail path (CLAUDE.md rule): apply this raw DDL to local + prod, then
-- verify with `\d user_local_cards` on both before relying on the columns.
--
-- relevance_pct: Haiku score 0-100 of the card vs its mandala centerGoal.
--   USER-SCOPED (the row is keyed by user_id+mandala_id+video_id+cell), so a
--   score never leaks across users — unlike the video-keyed
--   video_rich_summaries.mandala_relevance_pct.
-- NULL = not yet backfilled (existing rows start NULL; the relevance-backfill
--   queue in PR3b fills them).

ALTER TABLE public.user_local_cards
  ADD COLUMN IF NOT EXISTS relevance_pct INTEGER;

ALTER TABLE public.user_local_cards
  ADD COLUMN IF NOT EXISTS relevance_at TIMESTAMPTZ;
