-- ============================================================================
-- CP489 — center_goal embedding cache (level=0) partial unique index
-- ============================================================================
-- Purpose: enable race-safe UPSERT (ON CONFLICT) in
-- src/modules/mandala/center-goal-embedding.ts. Without a unique index,
-- two concurrent add-cards calls for the same mandala would each insert
-- a level=0 row → duplicates → next cache lookup ambiguous.
--
-- A partial unique index on (mandala_id) WHERE level=0 leaves the existing
-- level=1 rows (8 per mandala, sub_goal_index 0..7) untouched while
-- enforcing "at most 1 center_goal embedding per mandala".
--
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uniq_mandala_emb_level0
  ON public.mandala_embeddings (mandala_id)
  WHERE level = 0;
