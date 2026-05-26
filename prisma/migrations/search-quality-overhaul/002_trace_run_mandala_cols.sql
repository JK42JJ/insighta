-- ============================================================================
-- CP488 — Search Quality Overhaul / D11 measurement oracle
-- Migration 002 — algorithm_version + cost_units columns on trace tables
-- ============================================================================
-- Purpose: every per-step trace + pipeline run carries the algorithm_version
-- it executed under + a cost_units jsonb (youtube quota / cohere units /
-- llm tokens / embed chunks). user_mandalas gets an optional override so
-- A/B comparisons can run on the same mandala under different versions.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS everywhere. Safe to re-run.
-- ============================================================================

-- video_discover_traces — per-step request/response capture (PR #624).
-- Adding algorithm_version + cost_units columns; the existing request/response
-- jsonb stays untouched.
ALTER TABLE public.video_discover_traces
  ADD COLUMN IF NOT EXISTS algorithm_version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS cost_units        JSONB;

CREATE INDEX IF NOT EXISTS idx_video_discover_traces_algo
  ON public.video_discover_traces (algorithm_version, created_at DESC)
  WHERE algorithm_version IS NOT NULL;

-- mandala_pipeline_runs — pipeline-level rollup.
ALTER TABLE public.mandala_pipeline_runs
  ADD COLUMN IF NOT EXISTS algorithm_version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS total_cost_units  JSONB;

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_algo
  ON public.mandala_pipeline_runs (algorithm_version, created_at DESC)
  WHERE algorithm_version IS NOT NULL;

-- user_mandalas — per-mandala override. NULL = use global active version.
-- FK kept NULLable so the override is optional; ON DELETE SET NULL avoids
-- breaking a mandala when its algorithm version row is removed.
ALTER TABLE public.user_mandalas
  ADD COLUMN IF NOT EXISTS search_algorithm_version VARCHAR(50);

-- FK only if both target table + column exist (defensive).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'user_mandalas'
      AND constraint_name = 'fk_user_mandalas_search_algorithm_version'
  ) THEN
    ALTER TABLE public.user_mandalas
      ADD CONSTRAINT fk_user_mandalas_search_algorithm_version
      FOREIGN KEY (search_algorithm_version)
      REFERENCES public.search_algorithm_versions(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_user_mandalas_search_algo
  ON public.user_mandalas (search_algorithm_version)
  WHERE search_algorithm_version IS NOT NULL;
