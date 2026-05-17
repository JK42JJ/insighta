-- CP462 (2026-05-17) — Issue #649: mandala_relevance_pct
--
-- Per docs/runbook/card-preference-signal-handoff-2026-05-15.md.
-- Adds a single 0-100 integer score that captures how well a video fits
-- the user's mandala center_goal. Distinct from the existing
-- `segments[].relevance_pct` which scores each chapter WITHIN a video
-- against the video's own core argument (intra-video metric).
--
-- Populated by the v2 prompt generator (a new top-level JSON field
-- requested in src/modules/skills/rich-summary-v2-prompt.ts). NULL on
-- legacy rows (pre-#649); backfilled lazily — when a user heart-clicks
-- a card whose v2 row has NULL here, the BullMQ enrich worker
-- regenerates the v2 summary and stores the new score (Heart trigger
-- path).
--
-- Surfaced in the UI as the top-left quality badge on Heart'd cards
-- (replacing the previous rec_score-based generic quality badge — only
-- Heart'd cards show the precise mandala-fit score).
--
-- IMPORTANT (CLAUDE.md "prisma db push silent fail" Hard Rule):
--   Apply via psql, NOT via `prisma db push`. After apply, verify:
--     - local DB: docker exec supabase-db-dev psql ... -c "\d video_rich_summaries"
--     - prod DB: psql "$DIRECT_URL" -c "\d video_rich_summaries"
--   Then NOTIFY pgrst, 'reload schema' + restart supabase-rest.

BEGIN;

ALTER TABLE public.video_rich_summaries
  ADD COLUMN IF NOT EXISTS mandala_relevance_pct INTEGER;

-- 0-100 range check. NULL is allowed (legacy rows, not yet computed).
DO $$ BEGIN
  ALTER TABLE public.video_rich_summaries
    ADD CONSTRAINT video_rich_summaries_mandala_relevance_pct_range
    CHECK (mandala_relevance_pct IS NULL
           OR (mandala_relevance_pct >= 0 AND mandala_relevance_pct <= 100));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.video_rich_summaries.mandala_relevance_pct IS
  'CP462+ Issue #649: 0-100 single fit score vs triggering user mandala center_goal. NULL for pre-#649 rows (lazy-regenerate on Heart click). Distinct from segments[].relevance_pct which is intra-video chapter metric.';

COMMIT;

-- Validation:
--   \d public.video_rich_summaries
--   SELECT COUNT(*) FILTER (WHERE mandala_relevance_pct IS NOT NULL) AS scored,
--          COUNT(*) FILTER (WHERE mandala_relevance_pct IS NULL)     AS unscored,
--          COUNT(*) AS total
--   FROM public.video_rich_summaries;
--
-- Rollback (in dev only):
--   ALTER TABLE public.video_rich_summaries
--     DROP CONSTRAINT IF EXISTS video_rich_summaries_mandala_relevance_pct_range;
--   ALTER TABLE public.video_rich_summaries
--     DROP COLUMN IF EXISTS mandala_relevance_pct;
