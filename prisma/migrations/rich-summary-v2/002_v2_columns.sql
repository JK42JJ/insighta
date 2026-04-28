-- CP437 (2026-04-29) — video_rich_summaries v2 schema migration
--
-- Per docs/design/rich-summary-v2-validation-filter.md §4. Adds the v2
-- column set so subsequent generators can populate `core` / `analysis` /
-- `segments` / `translations` / `lora` instead of the v1 single
-- `structured` jsonb. Existing 1,470 pass rows + 103 null rows are marked
-- `template_version='v1'` so the reader fallback (rich-summary-reader.ts,
-- separate PR) can serve v1 content until they are regenerated to v2.
--
-- Default `template_version='v1'` is intentional: any row created BEFORE
-- the v2 generator ships should be treated as legacy. New v2 rows must
-- explicitly set `template_version='v2'` (no DDL default for v2).
--
-- IMPORTANT (CLAUDE.md "prisma db push silent fail" Hard Rule):
--   This file is the source of truth. Apply via psql, NOT via `prisma db
--   push`. After apply, verify the columns appear in:
--     - local DB: docker exec supabase-db-dev psql ... -c "\d video_rich_summaries"
--     - prod DB: psql "$DIRECT_URL" -c "\d video_rich_summaries"

BEGIN;

ALTER TABLE video_rich_summaries
  ADD COLUMN IF NOT EXISTS template_version VARCHAR(10) NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS source_language  VARCHAR(5),
  ADD COLUMN IF NOT EXISTS core             JSONB,
  ADD COLUMN IF NOT EXISTS analysis         JSONB,
  ADD COLUMN IF NOT EXISTS segments         JSONB,
  ADD COLUMN IF NOT EXISTS translations     JSONB,
  ADD COLUMN IF NOT EXISTS lora             JSONB,
  ADD COLUMN IF NOT EXISTS completeness     DOUBLE PRECISION;

-- Existing rows: explicitly mark v1 (the default already covers this, but
-- we keep this UPDATE in case a future migration changes the default).
UPDATE video_rich_summaries
SET template_version = 'v1'
WHERE template_version IS NULL OR template_version = '';

-- Index for upcoming reader/writer queries that filter by template_version.
CREATE INDEX IF NOT EXISTS idx_video_rich_summaries_template_version
  ON video_rich_summaries (template_version);

COMMIT;

-- Validation:
-- SELECT
--   COUNT(*) FILTER (WHERE template_version = 'v1') AS v1,
--   COUNT(*) FILTER (WHERE template_version = 'v2') AS v2,
--   COUNT(*) AS total
-- FROM video_rich_summaries;
