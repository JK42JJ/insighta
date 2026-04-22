-- ============================================================================
-- Ontology 012: Drop goal + topic node triggers (Lever A+, CP416)
-- ============================================================================
-- 011 dropped the edge triggers (trg_goal_edge, trg_topic_edges); this
-- migration extends Lever A to the **node** creation triggers installed
-- by 008 for the same table (`user_mandala_levels`).
--
-- Trigger cost per createMany (9 levels, ~8 subjects each):
--   trg_sync_goal       — 1 lookup + 1 INSERT per row = 2 × 9 = 18
--   trg_sync_topics     — 1 lookup + up to 8 INSERTs per row = 9 × 9 = 81
--   ────────────────────────────────────────────────────────────────
--   Total deferred: ~99 queries inside the wizard $transaction.
--
-- After 011 dropped the edge triggers, ~117 queries remained inside the
-- $transaction (18 sector + 18 goal + 81 topic + 3 wizard writes). Prod
-- log `[mandala-create-timing]` recorded tx_levels_createMany ≈ 5.1s.
-- Dropping the goal + topic node triggers brings the tx down to ~18
-- queries (sector + wizard writes) and the expected wall clock under
-- 1s.
--
-- Kept on purpose:
--   trg_sync_mandala_level (004) — creates `mandala_sector` nodes which
--   are the foundational row. They are cheap (~18 queries total) and
--   downstream features (syncOntologyEdges lookups, etc.) depend on
--   their existence the moment the row commits. Removing them would
--   complicate the application-layer sync ordering for negligible
--   further latency win.
--
--   trg_sync_video_note (008) — unrelated to mandala create; operates
--   on public.video_notes. Keep in place.
--
-- The ontology.sync_goal + ontology.sync_topics FUNCTIONs stay defined
-- so reactivation is a one-line CREATE TRIGGER. They have zero side
-- effects while detached.
--
-- Application layer fills in:
--   `src/modules/ontology/sync-edges.ts::syncOntologyEdges` is extended
--   in the same PR to create the missing `goal` + `topic` nodes from
--   multi-row INSERT ... ON CONFLICT DO NOTHING statements before
--   building the edges (which already depend on node presence — the
--   lookup guards that were already in the edges code now see the
--   freshly-inserted rows in the same sync call).
-- ============================================================================

DROP TRIGGER IF EXISTS trg_sync_goal ON public.user_mandala_levels;
DROP TRIGGER IF EXISTS trg_sync_topics ON public.user_mandala_levels;

-- Sanity assertion
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname IN ('trg_sync_goal', 'trg_sync_topics')
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Migration 012 expected both triggers dropped, but at least one is still present';
  END IF;
END $$;
