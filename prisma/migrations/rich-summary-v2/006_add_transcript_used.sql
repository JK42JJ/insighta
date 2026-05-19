-- ============================================================================
-- CP474 — Add `transcript_used` flag to video_rich_summaries (v2 regen gate)
-- ============================================================================
-- Context:
--   generateRichSummaryV2 used to skip when `template_version='v2' AND
--   mandala_relevance_pct IS NOT NULL`, treating the existence of a v2 row
--   as proof of an accurate v2. But that gate ignored the actual quality
--   determinant — whether the LLM saw the transcript. A first Heart click
--   whose captioner failed produces a description-only v2 row that still
--   has both flags set, and every subsequent Heart click (including ones
--   whose captioner succeeds) hit the skip branch and never refreshed the
--   row.
--
-- Fix:
--   Make the gate test for "transcript-grounded v2", not just "v2 exists".
--   Add a boolean column the generator stamps on every successful update.
--   Backfill conservatively: rows with non-null segments must have come
--   from a transcript path (segments require real timestamps; the LLM is
--   instructed not to fabricate them when the transcript is empty).
--
-- IMPORTANT (CLAUDE.md "prisma db push silent fail" Hard Rule):
--   Apply via psql (or apply-custom-sql.sh), NOT via `prisma db push`.
--   After apply, verify the column lands on prod:
--     psql "$DIRECT_URL" -c "\d video_rich_summaries" | grep transcript_used
--   Then NOTIFY pgrst, 'reload schema'.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS + UPDATE WHERE transcript_used IS
-- DISTINCT FROM ... — re-running after the first apply is a no-op.
-- ============================================================================

BEGIN;

ALTER TABLE public.video_rich_summaries
  ADD COLUMN IF NOT EXISTS transcript_used boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.video_rich_summaries.transcript_used IS
  'CP474 — true when the v2 row was generated with a transcript. Used by generateRichSummaryV2 to decide whether to skip or regenerate on a Heart-triggered re-enrich.';

-- Conservative backfill: only flip to true when segments[] is populated.
-- description-only generations produce a single catch-all segment with
-- from_sec=to_sec=0, which leaves segments JSON non-null but obviously
-- non-transcript-derived. Detect that shape and keep transcript_used=false.
UPDATE public.video_rich_summaries
   SET transcript_used = true
 WHERE template_version = 'v2'
   AND segments IS NOT NULL
   AND jsonb_typeof(segments->'sections') = 'array'
   AND (
     SELECT bool_or(
       COALESCE((s->>'to_sec')::int, 0) > 0
     )
     FROM jsonb_array_elements(segments->'sections') s
   )
   AND transcript_used = false;

COMMIT;

-- Validation:
--   SELECT COUNT(*) FILTER (WHERE transcript_used) AS transcript_grounded,
--          COUNT(*) FILTER (WHERE NOT transcript_used) AS desc_only_or_legacy,
--          COUNT(*) AS total
--     FROM public.video_rich_summaries
--    WHERE template_version = 'v2';
--
-- Rollback (dev only):
--   ALTER TABLE public.video_rich_summaries
--     DROP COLUMN IF EXISTS transcript_used;
