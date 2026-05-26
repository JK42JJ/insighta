-- ============================================================================
-- CP488+ — video_pool.depth_level + companion columns
-- ============================================================================
-- Purpose:
--   Persist the LLM-evaluated depth level (`beginner` | `intermediate` |
--   `advanced` | `mixed`) and content type on `video_pool` so search-time
--   difficulty filtering becomes a single SELECT against an indexed column,
--   instead of a runtime LLM evaluation per search.
--
-- Sync source priority (handled in a separate Step 1 SQL):
--   1. `video_rich_summaries.core->>'depth_level'` (transcript+LLM evaluated,
--      `claude-code-direct` or `anthropic/*` model rows ONLY — excludes the
--      491 `quality_flag='qwen3_low'` rows hidden by PR #752).
--   2. Title regex + duration heuristics for rows without a rich_summary
--      (later step — handled by Mac Mini CC console batch, NOT this DDL).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS. Safe
-- to re-run.
-- ============================================================================

ALTER TABLE public.video_pool
  ADD COLUMN IF NOT EXISTS depth_level             VARCHAR(15),
  ADD COLUMN IF NOT EXISTS depth_level_confidence  REAL,
  ADD COLUMN IF NOT EXISTS depth_level_source      VARCHAR(30),
  ADD COLUMN IF NOT EXISTS depth_level_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS content_type            VARCHAR(20);

-- Indexes for search-time filtering. Partial-index on the filtered values
-- only — keeps the index small (NULL rows are the majority until backfill
-- catches up).
CREATE INDEX IF NOT EXISTS idx_vpool_depth_level
  ON public.video_pool(depth_level)
  WHERE depth_level IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vpool_content_type
  ON public.video_pool(content_type)
  WHERE content_type IS NOT NULL;

-- PostgREST schema reload — without this, the Supabase client silently
-- drops the new columns from query responses (CLAUDE.md LEVEL-2 rule).
NOTIFY pgrst, 'reload schema';
