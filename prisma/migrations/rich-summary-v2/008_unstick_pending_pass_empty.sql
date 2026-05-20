-- =========================================================================
-- CP475+ (2026-05-20) — un-stick v2 rows where quick path stamped 'pass'
-- but full path never landed
-- =========================================================================
--
-- Why: pre-CP475+ the quick generator (`rich-summary-v2-quick-generator.ts`)
-- created new rows with `quality_flag='pass'` on the assumption that the
-- full generator would always finish moments later and overwrite to the
-- real verdict ('pass' / 'low'). With `RICH_SUMMARY_RETRY_OPTIONS.expireInMinutes=5`
-- (CP462) about 15% of full-path jobs expired before finishing — leaving
-- the row in a permanent `pass + sections=[] + atoms=[]` state that the
-- cron Track A2 retry (`quality_flag='low'`) could never reach.
--
-- CP475+ fix:
--   1. quick path now writes `quality_flag='pending'` (only full path stamps 'pass')
--   2. `RICH_SUMMARY_RETRY_OPTIONS.expireInMinutes: 5 → 10`
--   3. cron Track A2 also matches `pending + empty atoms`
--
-- This migration cleans up the historical inventory so the cron Track A2
-- and the FE "still being generated" path can re-pick them.
--
-- Affected rows: template_version='v2' AND quality_flag='pass' AND
-- (atoms is empty/missing) — these are quick-only rows.
--
-- Apply (local):
--   docker exec -e PGPASSWORD=... supabase-db-dev psql -U supabase_admin \
--     -d postgres -f /docker-entrypoint-initdb.d/008_unstick_pending_pass_empty.sql
--   OR
--   docker exec supabase-db-dev bash -c 'PGPASSWORD=$POSTGRES_PASSWORD psql -U supabase_admin -d postgres' < 008_unstick_pending_pass_empty.sql
--
-- Apply (prod):
--   psql "$DIRECT_URL" -f 008_unstick_pending_pass_empty.sql
--
-- Verify:
--   SELECT count(*) FILTER (WHERE quality_flag='pending') AS unstucked,
--          count(*) FILTER (WHERE quality_flag='pass'
--                            AND COALESCE(jsonb_array_length(NULLIF(segments->'atoms','null'::jsonb)),0)=0
--                            AND template_version='v2') AS still_stuck
--   FROM video_rich_summaries;
--   -- expect still_stuck = 0
--
-- Rollback: one-way. Re-running won't change pending rows back to pass.

UPDATE video_rich_summaries
SET quality_flag = 'pending',
    updated_at   = now() - interval '13 hours'   -- backdate so cron Track A2 picks them up on the next tick
WHERE template_version = 'v2'
  AND quality_flag = 'pass'
  AND COALESCE(jsonb_array_length(NULLIF(segments->'atoms', 'null'::jsonb)), 0) = 0;
