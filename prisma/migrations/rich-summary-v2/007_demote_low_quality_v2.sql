-- =========================================================================
-- CP475 (2026-05-19) — demote pre-CP475 low-quality v2 rows
-- =========================================================================
--
-- Why: prompt rule (rich-summary-v2-prompt.ts §field rules) requires
--   - segments.sections: 3-8 entries with real timestamps
--   - segments.atoms:    5-15 entries
-- pre-CP475 scoreCompleteness() ignored segments, so quality_flag='pass'
-- was stamped on rows that violated those minimums whenever transcript
-- was missing (sections=1 catch-all with to_sec=0, atoms<5).
--
-- After CP475 the handler throws NO_TRANSCRIPT instead of generating
-- description-only rows. This migration cleans up the historical inventory
-- so the UI fallback path can render video_summaries.summary_ko instead.
--
-- Affected dimensions (any one match → demote):
--   1. transcript_used = false                                   (CP474 column)
--   2. jsonb_array_length(segments->'sections') < 3
--   3. jsonb_array_length(segments->'atoms')    < 5
--   4. every sections[].to_sec == 0  (description-only catch-all)
--
-- Apply (local):
--   docker exec supabase-db-dev -e PGPASSWORD=... psql -U supabase_admin \
--     -d postgres -f /path/to/007_demote_low_quality_v2.sql
--
-- Apply (prod): run via CI/CD deploy pipeline OR
--   psql "$DIRECT_URL" -f 007_demote_low_quality_v2.sql
--
-- Verify:
--   SELECT count(*) FILTER (WHERE quality_flag = 'low')  AS demoted,
--          count(*) FILTER (WHERE quality_flag = 'pass') AS still_pass
--     FROM public.video_rich_summaries
--    WHERE template_version = 'v2';
--
-- Rollback (only if needed — replace TIMESTAMP with this migration's run):
--   UPDATE public.video_rich_summaries
--      SET quality_flag = 'pass'
--    WHERE quality_flag = 'low'
--      AND updated_at  = '<MIGRATION_TIMESTAMP>';
-- =========================================================================

BEGIN;

UPDATE public.video_rich_summaries
   SET quality_flag = 'low',
       updated_at   = now()
 WHERE template_version = 'v2'
   AND quality_flag    = 'pass'
   AND (
        transcript_used = false
        OR jsonb_array_length(COALESCE(segments->'sections', '[]'::jsonb)) < 3
        OR jsonb_array_length(COALESCE(segments->'atoms',    '[]'::jsonb)) < 5
        OR NOT EXISTS (
             SELECT 1
               FROM jsonb_array_elements(COALESCE(segments->'sections', '[]'::jsonb)) AS sec
              WHERE (sec->>'to_sec')::int > 0
        )
   );

COMMIT;
