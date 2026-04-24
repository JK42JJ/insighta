-- ============================================================================
-- video_rich_summaries: add user_id for per-user quota tracking (CP423)
-- ============================================================================
-- Adds nullable user_id column + composite index for monthly count queries.
-- Existing rows (CP416 legacy, currently 70 in prod) stay NULL and are not
-- counted toward any user's monthly quota — acceptable given small volume.
--
-- Idempotent: IF NOT EXISTS on column + index.
-- ============================================================================

ALTER TABLE public.video_rich_summaries
  ADD COLUMN IF NOT EXISTS user_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_vrs_user_updated_at
  ON public.video_rich_summaries (user_id, updated_at DESC);

-- Sanity check
DO $$
DECLARE
  col_exists BOOLEAN;
  idx_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'video_rich_summaries'
      AND column_name = 'user_id'
  ) INTO col_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_vrs_user_updated_at'
  ) INTO idx_exists;

  IF NOT col_exists THEN
    RAISE EXCEPTION 'video_rich_summaries.user_id column missing after migration';
  END IF;
  IF NOT idx_exists THEN
    RAISE EXCEPTION 'idx_vrs_user_updated_at index missing after migration';
  END IF;
END $$;

-- PostgREST schema reload (ALTER TABLE → Supabase client silent-drop防止)
NOTIFY pgrst, 'reload schema';
