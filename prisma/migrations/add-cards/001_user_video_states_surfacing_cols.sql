-- CP466 (2026-05-18) — Add Cards Phase 1 (surfacing)
--
-- Adds one column + one partial index to user_video_states to power the
-- "Add Cards" slide-in panel (docs/design/add-cards-2026-05-18.md §
-- Schema). Decision C1=d (CP466): drop the planned `refresh_round`
-- counter — `surfaced_at` alone is sufficient for Layer 1 Coverage
-- dedup (panel selector prefers rows with NULL surfaced_at, then
-- older `surfaced_at` over newer). A round counter adds storage cost
-- without a code consumer.
--
--   surfaced_at   TIMESTAMPTZ NULL — moment this row was last surfaced
--                                   as a recommendation candidate in an
--                                   Add Cards panel session. NULL =
--                                   never surfaced. Layer 1 Coverage
--                                   prefers un-surfaced rows for
--                                   diversity (도배 회피).
--
-- New partial index:
--   idx_user_video_states_surfaced
--     ON (user_id, mandala_id, surfaced_at DESC) WHERE surfaced_at IS NOT NULL
--   — Hot path: "rows previously surfaced for this mandala-user,
--   ordered by recency". The Add Cards selector reads this to dedup
--   recently-surfaced rows.
--
-- IMPORTANT (CLAUDE.md "prisma db push silent fail" LEVEL-3 Hard Rule):
--   This file is the source of truth. Apply via psql, NOT via
--   `prisma db push`. After apply, verify columns:
--     - local DB: docker exec supabase-db-dev psql ... -c "\d user_video_states"
--     - prod DB: psql "$DIRECT_URL" -c "\d user_video_states"
--   And NOTIFY pgrst, 'reload schema' + restart supabase-rest so
--   PostgREST sees the new columns.
--
-- Idempotency: IF NOT EXISTS on every DDL. Safe to re-apply.

BEGIN;

ALTER TABLE public.user_video_states
  ADD COLUMN IF NOT EXISTS surfaced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_user_video_states_surfaced
  ON public.user_video_states (user_id, mandala_id, surfaced_at DESC)
  WHERE surfaced_at IS NOT NULL;

COMMIT;

-- Validation queries:
--   \d public.user_video_states
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='user_video_states'
--      AND column_name = 'surfaced_at';
--
-- Rollback (dev only):
--   BEGIN;
--   DROP INDEX IF EXISTS public.idx_user_video_states_surfaced;
--   ALTER TABLE public.user_video_states DROP COLUMN IF EXISTS surfaced_at;
--   COMMIT;
