-- ============================================================================
-- CP422 Lever A++ — Drop trg_structural_edges_level (wizard tx latency cut)
-- ============================================================================
-- Target: `trg_structural_edges_level` + `ontology.create_structural_edges_for_level`
-- Defined in: prisma/migrations/ontology/005_structural_edges.sql (lines 11-50)
--
-- Why drop:
--   - /mandala-perf γ timings n=3 (CP422 2026-04-23): tx_levels_createMany mean
--     3895ms (range 3234-5027), ~47% of tx_total (mean 8285ms). Wizard-create
--     dominant bottleneck.
--   - Trigger fires AFTER INSERT ON public.user_mandala_levels; wizard creates
--     ~9 levels per mandala => 9× per-create.
--   - Each fire does 2× `ontology.nodes` table lookups (mandala + sector shadow)
--     then conditional INSERT with `ON CONFLICT DO NOTHING`.
--   - CP421 prod probe observed: 0 `mandala→sector CONTAINS` edges exist in
--     prod (103,048 edges total are all `sector→topic`). => shadow node lookup
--     returns NULL for at least one side, INSERT path is skipped. The trigger
--     is paying ~430ms per fire for zero effective output.
--
-- Risk: LOW
--   - Current effective output = 0 edges. DROP removes only overhead.
--   - Graph-RAG Phase 2/3 that needs mandala→sector CONTAINS can add a
--     backfill job outside the wizard-create tx critical path, or fix the
--     shadow-node sync precondition as a separate concern.
--
-- Expected savings (post-drop, to be verified by /mandala-perf n≥1):
--   - tx_levels_createMany: 3895ms mean => target ~0ms
--   - tx_total: 8285ms mean => target ~4390ms (-47%)
--   - end-to-end total: 8318ms mean => target ~4420ms
--
-- Rollback (if Graph-RAG depends on live trigger and backfill unacceptable):
--   Re-apply the original CREATE statements from
--   prisma/migrations/ontology/005_structural_edges.sql §
--   "mandala_level INSERT → CONTAINS edge" (lines 11-50). Verbatim:
--
--     CREATE OR REPLACE FUNCTION ontology.create_structural_edges_for_level()
--     RETURNS TRIGGER AS $$
--     DECLARE
--       v_mandala_node_id UUID;
--       v_sector_node_id  UUID;
--       v_user_id         UUID;
--     BEGIN
--       IF TG_OP != 'INSERT' THEN RETURN NEW; END IF;
--       SELECT user_id INTO v_user_id FROM public.user_mandalas WHERE id = NEW.mandala_id;
--       IF v_user_id IS NULL THEN RETURN NEW; END IF;
--       SELECT id INTO v_mandala_node_id FROM ontology.nodes
--         WHERE source_ref = jsonb_build_object('table', 'user_mandalas', 'id', NEW.mandala_id::text);
--       SELECT id INTO v_sector_node_id FROM ontology.nodes
--         WHERE source_ref = jsonb_build_object('table', 'user_mandala_levels', 'id', NEW.id::text);
--       IF v_mandala_node_id IS NOT NULL AND v_sector_node_id IS NOT NULL THEN
--         INSERT INTO ontology.edges (user_id, source_id, target_id, relation)
--         VALUES (v_user_id, v_mandala_node_id, v_sector_node_id, 'CONTAINS')
--         ON CONFLICT (source_id, target_id, relation) DO NOTHING;
--       END IF;
--       RETURN NEW;
--     END;
--     $$ LANGUAGE plpgsql SECURITY DEFINER;
--
--     CREATE TRIGGER trg_structural_edges_level
--       AFTER INSERT ON public.user_mandala_levels
--       FOR EACH ROW EXECUTE FUNCTION ontology.create_structural_edges_for_level();
--
-- Not touched:
--   - `trg_placed_in_edge` (005 lines 52-106) — card → sector PLACED_IN edge.
--     Different semantics (CONTAINS vs PLACED_IN), not on wizard-create path,
--     stays intact.
--
-- Idempotency: IF EXISTS on both DROPs — safe to re-apply by deploy pipeline.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_structural_edges_level ON public.user_mandala_levels;

DROP FUNCTION IF EXISTS ontology.create_structural_edges_for_level();

-- Verification (deploy-time sanity check)
DO $$
DECLARE
  trg_count INT;
  fn_count  INT;
BEGIN
  SELECT COUNT(*) INTO trg_count
  FROM pg_trigger
  WHERE tgname = 'trg_structural_edges_level' AND NOT tgisinternal;

  SELECT COUNT(*) INTO fn_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'ontology' AND p.proname = 'create_structural_edges_for_level';

  IF trg_count != 0 THEN
    RAISE EXCEPTION 'trg_structural_edges_level still exists (count=%)', trg_count;
  END IF;
  IF fn_count != 0 THEN
    RAISE EXCEPTION 'ontology.create_structural_edges_for_level still exists (count=%)', fn_count;
  END IF;
END $$;
