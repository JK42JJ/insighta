-- CP357 — add user_video_states.auto_added column for selective replace
--
-- Selective-replace eviction policy (insighta-trend-recommendation-engine.md §14):
--   DELETE candidates only WHERE
--     auto_added = true
--     AND user_note IS NULL
--     AND (is_watched IS NULL OR is_watched = false)
--     AND (watch_position_seconds IS NULL OR watch_position_seconds = 0)
--     AND is_in_ideation = false
--   Any user trace promotes the row to permanent.
--
-- Apply locally via:
--   psql "$DATABASE_URL" -f scripts/migrations/2026-04-08-add-auto-added.sql
--
-- Apply to prod via the same command using the prod DATABASE_URL from credentials.md.
-- Idempotent: IF NOT EXISTS guards both column add + index create.

BEGIN;

ALTER TABLE public.user_video_states
  ADD COLUMN IF NOT EXISTS auto_added BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_user_video_states_auto_add_lookup
  ON public.user_video_states (mandala_id, cell_index, auto_added);

COMMIT;
