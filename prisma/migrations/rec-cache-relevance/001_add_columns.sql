-- P3 Stage 2 (CP513, James finalize) — display-only relevance_pct on
-- recommendation_cache for the "관련도순" grid sort.
--
-- Additive nullable Int (0-100 A-stage relevance), computed by the pgvector
-- backfill using the mandala-filter formula (0.5·centerCos + 0.5·bestCellCos
-- → cosineToRelevance). NEVER summed into rec_score — serving ranking / gates
-- are untouched; this is a display/sort field only.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Must be in apply-custom-sql.sh allowlist
-- so the deploy applies it BEFORE the new Prisma client (which selects the
-- column on every recommendation_cache findMany) goes live — CP499+ LEVEL-3.
ALTER TABLE public.recommendation_cache
  ADD COLUMN IF NOT EXISTS relevance_pct integer;
