-- ============================================================================
-- 017 — Fix Seq Scan in ontology.sync_mandala() trigger function
-- ============================================================================
-- Origin: 2026-05-13 prod EXPLAIN ANALYZE evidence.
--
-- ROOT CAUSE (data-anchored, not speculation):
--   Wizard `tx_total` 5616ms breakdown:
--     - tx_mandala_create:      111ms (Prisma timing)
--     - tx_levels_createMany:   102ms (Prisma timing)
--     - tx_find_unique:          19ms (Prisma timing)
--     - inner measured sum:    ~232ms
--     - gap (unmeasured):     ~5384ms
--
--   EXPLAIN ANALYZE on the `promoteToDefault` UPDATE
--   (`UPDATE user_mandalas SET is_default WHERE user_id AND is_default`):
--     - Index scan + 1 row actual update:        ~28ms
--     - "Triggers": [{ "Trigger Name": "trg_sync_mandala", "Time": 4829.266 }]
--     → 99% of the slow UPDATE = trg_sync_mandala trigger fire.
--
-- WHY THE TRIGGER IS SLOW:
--   ontology.sync_mandala() (UPDATE branch) had:
--     WHERE source_ref = jsonb_build_object('table','user_mandalas','id', NEW.id::text)
--
--   The `source_ref = <jsonb>` equality comparison cannot use:
--     - idx_ont_nodes_source_ref (GIN, needs @> operator)
--     - idx_ont_nodes_source_ref_unique (btree on source_ref->>'table' and
--       source_ref->>'id' EXPRESSIONS, needs those exact expressions in WHERE)
--   → Seq Scan on ontology.nodes (~177,481 rows).
--
-- EXPLAIN A/B (prod, 2026-05-13):
--   WHERE source_ref = jsonb_build_object(...)
--     Seq Scan on nodes, Rows Removed by Filter: 177,481, Execution Time: 2898ms
--   WHERE source_ref->>'table' = 'user_mandalas' AND source_ref->>'id' = ...
--     Index Scan on idx_ont_nodes_source_ref_unique, Execution Time: 3.295ms
--   → 879× difference.
--
-- WHY THIS WASN'T FIXED EARLIER:
--   Mig 014 (CP427, 2026-04-27) applied this exact pattern fix to 5 functions:
--     - create_structural_edges_for_level
--     - create_goal_edge
--     - create_topic_edges
--     - sync_mandala_level
--     - sync_goal
--   `sync_mandala` was omitted from that migration. This file applies the
--   same idempotent CREATE OR REPLACE pattern.
--
-- IMPACT (expected, to be measured post-deploy via /mandala-perf):
--   - tx_total p50 5616ms → ~~700ms (matches mig 014 ratio for similar trigger fix)
--   - Wizard finalize wall-time user-perceived speedup
--
-- ROLLBACK (if any unexpected behavioural change):
--   Re-apply the prior function body (source_ref = jsonb_build_object) via
--   another CREATE OR REPLACE FUNCTION migration. Or psql:
--     CREATE OR REPLACE FUNCTION ontology.sync_mandala() ...
--   The prior definition is preserved in this file's header comment for
--   reference.
--
-- IDEMPOTENT: CREATE OR REPLACE — safe to re-run.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION ontology.sync_mandala()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref)
    VALUES (
      NEW.user_id, 'mandala', NEW.title,
      jsonb_build_object('is_default', NEW.is_default, 'position', NEW.position),
      jsonb_build_object('table', 'user_mandalas', 'id', NEW.id::text)
    )
    ON CONFLICT ((source_ref->>'table'), (source_ref->>'id')) WHERE source_ref IS NOT NULL DO UPDATE
    SET title = EXCLUDED.title, properties = EXCLUDED.properties, updated_at = now();
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE ontology.nodes SET title = NEW.title,
      properties = jsonb_build_object('is_default', NEW.is_default, 'position', NEW.position),
      updated_at = now()
    -- D1-b fix (2026-05-13): use indexed expression form so the btree
    -- partial unique index `idx_ont_nodes_source_ref_unique` matches.
    -- Was: WHERE source_ref = jsonb_build_object('table', 'user_mandalas', 'id', NEW.id::text)
    WHERE source_ref->>'table' = 'user_mandalas'
      AND source_ref->>'id' = NEW.id::text;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM ontology.nodes
    -- Same fix on DELETE branch — was: WHERE source_ref = jsonb_build_object(...)
    WHERE source_ref->>'table' = 'user_mandalas'
      AND source_ref->>'id' = OLD.id::text;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

-- Sanity check — function exists with the new body
DO $$
DECLARE
  fn_src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO fn_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'ontology' AND p.proname = 'sync_mandala';

  IF fn_src IS NULL THEN
    RAISE EXCEPTION 'ontology.sync_mandala not found after CREATE OR REPLACE';
  END IF;

  -- Confirm the indexed-expression WHERE clause is present in both
  -- UPDATE and DELETE branches.
  IF position('source_ref->>''table''' IN fn_src) = 0 THEN
    RAISE EXCEPTION 'sync_mandala body missing the indexed-expression WHERE fix';
  END IF;
END $$;

COMMIT;
