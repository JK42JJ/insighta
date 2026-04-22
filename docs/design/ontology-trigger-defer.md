# Ontology Edge Trigger — Defer Out of Mandala Create Transaction (Lever A)

> **Status.** iter 1 draft, **pre-implementation**. Captured 2026-04-22
> during CP416 wizard-dashboard performance work.
>
> **Why.** Prod live-measured: 템플릿 mandala save 7s, AI custom 21s,
> dashboard 60s+. User verdict: "서비스 불가". CP416 건 2 조사에서
> `prisma/migrations/ontology/010_goal_topic_edge_triggers.sql` per-row
> trigger cascade 가 `tx_levels_createMany` wall time 의 주범으로 확정.
> Lever A = 이 trigger 를 transaction 밖으로 밀어내 mandala 저장 path
> 를 1초 이하로 복원하는 가장 sure-win 조치.

## 1. Problem — exact shape

`/create-with-data` 의 `$transaction` 내부:

```
BEGIN
  INSERT user_mandalas ...                                    (1 query)
  INSERT user_mandala_levels (9 rows, 1 createMany)           (1 query)
    ↓
    AFTER INSERT trigger fires per row (9 rows):
      trg_goal_edge:                                          (9 × 4 = 36)
        SELECT user_id FROM user_mandalas                       (1)
        SELECT goal_node FROM ontology.nodes                    (1)
        SELECT sector_node FROM ontology.nodes                  (1)
        INSERT ontology.edges                                   (1)
      trg_topic_edges:                                        (9 × 19 = 171)
        SELECT user_id FROM user_mandalas                       (1)
        SELECT sector_node FROM ontology.nodes                  (1)
        FOREACH subject (≤8):                                   (8 × 2 = 16)
          SELECT topic_node FROM ontology.nodes                   (1)
          INSERT ontology.edges                                   (1)
  SELECT user_mandalas WHERE id = ...  (findUnique include)   (1-3)
COMMIT
```

**Total ≈ 210 queries inside the transaction**. Measured as
`tx_levels_createMany: 7000ms+` in `manager.ts:428`.

Edges are **derived data** (sector → goal / sector → topic CONTAINS).
Readers of `ontology.edges` are Graph-RAG related features that run
offline or later in the UX — nobody reads them within the wizard flow.
Therefore moving edge creation out of the critical-path transaction has
**no correctness impact** on the user-facing save.

## 2. Current trigger logic (verbatim behavior this design must preserve)

From `010_goal_topic_edge_triggers.sql`:

- `trg_goal_edge` — AFTER INSERT OR UPDATE OF `center_goal`
  - Skip if `center_goal` empty
  - Look up user_id by mandala_id
  - Look up goal node (created by 008's `trg_sync_goal`)
  - Look up sector node
  - INSERT `(user_id, sector, goal, 'CONTAINS')` with ON CONFLICT DO NOTHING

- `trg_topic_edges` — AFTER INSERT OR UPDATE OF `subjects`
  - Look up user_id
  - Look up sector node
  - For each non-empty subject in `subjects`:
    - Look up topic node (created by 008's `trg_sync_topics`)
    - INSERT `(user_id, sector, topic, 'CONTAINS')` with ON CONFLICT DO NOTHING

Both triggers are idempotent via `ON CONFLICT DO NOTHING` on the edges
unique index `(source_id, target_id, relation)`.

Shadow triggers 008 (`trg_sync_mandala_level` / `trg_sync_goal` /
`trg_sync_topics`) that create the corresponding **nodes** remain
in-transaction — they are much cheaper (nodes are per-row INSERTs
without inner joins). This doc only defers the **edge** triggers 010.

## 3. Options

| Option | Approach | Pros | Cons | Selected |
|--------|----------|------|------|----------|
| **A. Drop triggers, sync from TS post-commit** | `DROP TRIGGER` + call `syncOntologyEdges(mandalaId)` fire-and-forget in `triggerMandalaPostCreationAsync` | Clean separation, can batch edges into multi-row INSERTs, TS path testable, edges derivable from any point via backfill | Edges land ~100-500ms after commit (reader tolerance needed); requires reconciliation job for missing edges on API crash between commit+sync | ✅ **Yes** |
| B. Keep triggers, `ALTER TABLE DISABLE TRIGGER` around createMany | One-line `ALTER` around transaction | No schema change | ALTER TABLE holds `ACCESS EXCLUSIVE` lock → blocks concurrent readers; breaks multi-writer safety; still runs 207 queries, just shifts when | ❌ |
| C. Rewrite triggers as statement-level (FOR EACH STATEMENT) batched | Single trigger fires once per statement, runs set-based INSERT via SELECT from `user_mandala_levels` | Keeps edges in-transaction | Deep plpgsql rewrite; risk of missing UPDATE semantics; does not benefit wizard path if trigger still O(N) within statement | ❌ (more work for less certainty) |
| D. Deferred constraints | `SET CONSTRAINTS ALL DEFERRED` | Postgres-native deferral | Triggers aren't constraints; only FK/CHECK constraints can defer | ❌ (not applicable) |

**Selected: Option A.** Drop triggers, implement `syncOntologyEdges` as
TypeScript module called from the existing fire-and-forget pipeline.
Edges become "eventually consistent" (single-digit-ms lag) with mandala
save, which is acceptable for all current edge readers.

## 4. Design

### 4.1 Database migration

New Prisma migration `prisma/migrations/ontology/011_drop_edge_triggers.sql`:

```sql
-- Drop the two edge-creation triggers introduced in 010. Edge creation
-- is moved to the application layer to keep the mandala create/update
-- transaction under 1s. Idempotent ON CONFLICT semantics are preserved
-- by the new TS sync path (same unique index, same ON CONFLICT clause).
--
-- Revert: run 010_goal_topic_edge_triggers.sql again.
DROP TRIGGER IF EXISTS trg_goal_edge ON public.user_mandala_levels;
DROP TRIGGER IF EXISTS trg_topic_edges ON public.user_mandala_levels;

-- Keep the ontology.create_goal_edge / create_topic_edges FUNCTIONs in
-- place so re-enabling the trigger is a one-line ALTER, no re-create.
-- Functions have no side effects when not attached.
```

### 4.2 TypeScript sync module

New file `src/modules/ontology/sync-edges.ts`:

```ts
export async function syncOntologyEdges(mandalaId: string): Promise<{
  ok: boolean;
  goalEdgesCreated: number;
  topicEdgesCreated: number;
  durationMs: number;
  error?: string;
}>
```

Implementation contract:

- Read all depth-1 levels (with center_goal + subjects) + the mandala's
  user_id in one query
- Look up sector / goal / topic nodes for the 9 rows in one query each
  (three queries total, using `source_ref = ANY(...)` vectorized)
- Build `ontology.edges` insert arrays in JS
- Multi-row INSERT in one statement each (goal-edges then topic-edges)
  with `ON CONFLICT (source_id, target_id, relation) DO NOTHING`
- Never throw — return result object, log on failure

Target wall time: **< 500ms** for a freshly-created mandala (9 levels,
≤ 72 topics).

### 4.3 Invocation point

In `src/modules/mandala/mandala-post-creation.ts`, add a third
fire-and-forget track alongside the existing two:

```ts
(async () => {
  const { syncOntologyEdges } = await import('@/modules/ontology/sync-edges');
  const result = await syncOntologyEdges(mandalaId);
  log.info(
    `ontology-edges sync for mandala=${mandalaId}: ` +
      `goal=${result.goalEdgesCreated} topic=${result.topicEdgesCreated} ` +
      `ms=${result.durationMs} ok=${result.ok}`
  );
})().catch((err) => {
  log.warn(`ontology-edges sync crashed for mandala=${mandalaId}: ${err}`);
});
```

Same pattern as the existing `fillMissingActionsIfNeeded` call: lazy
import, fire-and-forget, error swallowed to log.

### 4.4 Reconciliation / backfill

For robustness against the small window between commit-and-sync:

1. **One-off backfill** on migration deploy: run `009_backfill_edges.sql`
   again (idempotent via ON CONFLICT) to ensure all existing mandalas
   have their edges. Cheap, runs outside user requests.
2. **Periodic reconciliation** (later CP): a cron or admin endpoint that
   finds `user_mandala_levels` rows whose sector node exists but whose
   expected edges are missing, and calls `syncOntologyEdges` on the
   parent mandala. Scope: post-Phase-1 nicety, not blocking this PR.

### 4.5 Updates covered

The triggers also fired on `UPDATE OF center_goal` / `UPDATE OF subjects`.
The TS sync path must cover these too:

- `src/modules/mandala/manager.ts` already has `updateMandalaLevels` +
  `regenerateLevel` + etc. paths. Add `syncOntologyEdges(mandalaId)`
  fire-and-forget at the end of each write path.
- Or: add a `post-write` hook layer in manager.ts that any mutation
  route can opt into via a shared helper. Preferred for DRY.

## 5. Rollback

Two-step (atomic if done together):

1. Revert the code PR (removes `syncOntologyEdges` invocations)
2. Re-apply trigger via `prisma/migrations/ontology/010_*.sql`

Rollback cost: a subsequent mandala save returns to 7s — no data loss
because the two paths converge on the same `ontology.edges` rows with
the same unique constraint.

If only the DB revert is done (triggers re-enabled) without reverting
the code, both paths run → duplicate INSERTs → ON CONFLICT DO NOTHING
handles it. Safe.

## 6. Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| API process crashes between commit and sync → edges missing | Low | Periodic reconciliation (4.4); `syncOntologyEdges` is idempotent so re-run is safe |
| Reader expects edges immediately (within wizard flow) | Very low (audited: no reader in wizard path) | Grep audit before merge; add assertion test |
| Multi-row INSERT hits a constraint not covered by ON CONFLICT | Low | Tests cover duplicate subjects, duplicate mandala saves, same-subject cross-level |
| Concurrent `syncOntologyEdges` on the same mandala | Low | ON CONFLICT DO NOTHING makes this safe; can add advisory lock later if telemetry shows contention |
| `trigger` re-landing by accident (future migration) | Low | 011 migration has a clear DROP comment + git history; CP416 troubleshooting.md entry warns against re-enabling without performance retest |

## 7. Success criteria

Before merging the implementation PR:

1. `tx_levels_createMany` p95 **< 1000ms** (vs ~7000ms baseline) on prod
   after deploy, measured over 20 wizard creations
2. `ontology.edges` row count for any new mandala reaches **36** (9
   sector-goal edges + 27+ sector-topic edges on average) within 2
   seconds of commit
3. Zero edges lost on 50 sequential wizard creates (all 50 mandalas
   have their full edge set after sync)
4. Template save path also measured — expect the same drop (it goes
   through the same `createMandala` path)

## 8. Phased implementation (concrete next steps)

**Phase A — same session (today):**

1. Write migration `011_drop_edge_triggers.sql`
2. Write `src/modules/ontology/sync-edges.ts` (+ unit tests with mocked
   Prisma)
3. Hook into `mandala-post-creation.ts` fire-and-forget
4. Add `syncOntologyEdges` call to the 2-3 update paths in manager.ts
5. Run local `prisma migrate dev` + verify triggers dropped
6. `/verify` + PR

**Phase B — post-merge (same day):**

1. Deploy PR via CI/CD
2. Re-run `009_backfill_edges.sql` on prod as one-off (DO NOTHING safe)
3. Measure `tx_levels_createMany` on prod via test mandala creation
4. If success criterion 1 met → close; else revert + investigate

**Phase C — follow-up (next CP):**

1. Admin endpoint for reconciliation
2. Optional: periodic cron for edge drift detection

## 9. Open questions (iter 2 candidates)

1. Should `syncOntologyEdges` be invoked on **update** paths as well, or
   is there a cheaper incremental diff? For iter 1, treat update = full
   resync for simplicity.
2. Do we want to pipe a Prisma middleware to auto-invoke on any write?
   (Less surface, but harder to reason about timing.)
3. Should reconciliation run as part of `/health` or a separate
   `/admin/ontology/reconcile` endpoint? Post-Phase-B decision.
4. When the mandala is deleted, who cleans up the ontology edges?
   Current triggers skip DELETE (return OLD). The TS layer must match —
   there may already be a cleanup path in manager.ts.

## 10. Non-goals

- Semantic correctness changes to ontology model (just moving where
  edges are created)
- Graph-RAG feature expansion
- Trigger 008 (`trg_sync_mandala_level` etc.) deferral — those are cheap
  node-level inserts and stay in-transaction
- Cross-service ontology (Bot, system domain) — out of scope

## 11. Measurement plan (pre- / post- deploy)

```bash
# Before (baseline)
ssh insighta-ec2 "docker exec insighta-api node -e \"
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  const t0 = Date.now();
  p.user_mandalas.create({
    data: {
      user_id: '<test-user>',
      title: 'perf-test-before',
      levels: { createMany: { data: [ ...9 rows... ] } }
    }
  }).then(r => console.log('ms=', Date.now() - t0, 'id=', r.id)).finally(() => p.\$disconnect());
\""

# After — same script. Compare wall time. Expect < 1500ms.
```

Post-deploy prod measurement alongside existing `[mandala-create-timing]`
log line (`manager.ts:456-459`) for continuous monitoring.
