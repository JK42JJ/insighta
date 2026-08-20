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

-- `DROP TRIGGER IF EXISTS` still takes ACCESS EXCLUSIVE on the table even when
-- there is no trigger to drop, and this file re-runs on every deploy long after
-- the drop happened. On 2026-08-20 that no-op waited three minutes on
-- user_mandala_levels and failed the deploy; on the deploys where it succeeded
-- it was holding new readers behind it for however long it waited.
--
-- Asking pg_trigger first costs one catalog read and takes no lock at all, so
-- the steady state -- both triggers already gone, which is every run since
-- CP416 -- stops touching the table.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_goal_edge' AND NOT tgisinternal
  ) THEN
    EXECUTE 'DROP TRIGGER trg_goal_edge ON public.user_mandala_levels';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_topic_edges' AND NOT tgisinternal
  ) THEN
    EXECUTE 'DROP TRIGGER trg_topic_edges ON public.user_mandala_levels';
  END IF;
END $$;

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
