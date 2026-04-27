-- Backfill: convert structured='{}' to NULL for low-quality rows.
--
-- Root cause: the original upsert path for quality_flag='low' stored `{}`
-- instead of NULL when structured generation failed. The production code path
-- now correctly writes Prisma.JsonNull, but historical rows remain as `{}`.
--
-- Impact: ~103 rows (as of 2026-04-27). Affects only quality_flag='low' rows.
-- No pass rows are affected (pass rows always have a non-empty structured object).
--
-- Run: psql "$DIRECT_URL" -f prisma/migrations/video_rich_summaries/003_backfill_null_structured.sql

UPDATE video_rich_summaries
SET structured = NULL
WHERE quality_flag = 'low'
  AND structured = '{}'::jsonb;
