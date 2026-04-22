-- ============================================================================
-- Ontology 011: Drop per-row edge triggers (Lever A, CP416)
-- ============================================================================
-- 010 installed `trg_goal_edge` + `trg_topic_edges` on `user_mandala_levels`
-- as AFTER INSERT/UPDATE per-row triggers. Each fired run-around inside
-- the outer `$transaction` of `/create-with-data`:
--
--   9 levels × 4 queries (goal)   = 36
--   9 levels × ~19 queries (topic) = ~171
--   -------------------------------------
--   ≈ 210 queries inside the txn, observed as ~7000ms on prod.
--
-- Edges are derived structural data (sector CONTAINS goal / sector
-- CONTAINS topic) read only by Graph-RAG-style offline features. No
-- wizard/dashboard/card path consumes them synchronously. Move edge
-- creation out of the critical-path transaction to TypeScript
-- fire-and-forget (`src/modules/ontology/sync-edges.ts`, invoked from
-- `mandala-post-creation.ts`) and drop the triggers.
--
-- The corresponding trigger FUNCTIONs are KEPT in place so reactivation
-- is a single `CREATE TRIGGER` away. They have zero side effects while
-- detached from any table. See `docs/design/ontology-trigger-defer.md`
-- §4.1 for the full rationale and rollback plan.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_goal_edge ON public.user_mandala_levels;
DROP TRIGGER IF EXISTS trg_topic_edges ON public.user_mandala_levels;

-- Sanity: confirm drop
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname IN ('trg_goal_edge', 'trg_topic_edges')
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Migration 011 expected both triggers dropped, but at least one is still present';
  END IF;
END $$;
