# Wizard Skeleton + Background Fill — Design Doc

> **Status.** DRAFT / Living Document. Reviewed against Issue #413.
>
> **Purpose.** Reduce wizard → dashboard perceived latency from ~15s
> (Issue #413, measured on prod 2026-04-17) to < 3s, while retaining
> the quota / duplicate-title / error-reporting guarantees of the
> current `POST /api/v1/mandalas/create-with-data` endpoint.
>
> **Scope.** Backend endpoint split + client orchestration. **Not** a
> rewrite of the 9-axis filter or the Tier 2 pipeline — those are
> `triggerMandalaPostCreationAsync` side work and already asynchronous.
>
> **Non-goals.** Changing transaction boundaries for existing mandala
> writes in a way that breaks atomicity. Moving the DB region.
> Changing Prisma or pgbouncer configuration beyond what CP385 PR #402
> already did.

---

## 1. Problem statement

### 1.1 Observed latency (CP386.5 TC, 2026-04-17, prod)

| Stage | Prod avg | Dev avg | Ratio |
|-------|----------|---------|-------|
| `createMandalaMs` | **15,254 ms** | 291 ms | 52× |
| `createMandalaMs` min | 7,027 ms | 166 ms | 42× |
| `createMandalaMs` max | 24,998 ms | 336 ms | 74× |

Source: `reports/video-discover-tc/2026-04-17T14-02-18-prod.json`
vs `reports/video-discover-tc/2026-04-17T13-37-06-459Z-dev.json`.

### 1.2 What `createMandala` actually does (`src/modules/mandala/manager.ts:330`)

1. **Duplicate title check** (1 read)
2. **Parallel quota reads** (4 queries, single RTT wall time):
   `user_subscriptions.findUnique`, `auth.users.is_super_admin`,
   `user_mandalas.count`, `user_mandalas.aggregate({_max: position})`.
3. **Interactive transaction** (`maxWait: 5s, timeout: 30s`):
   - `user_mandalas.create` (1 row)
   - `user_mandala_levels.createMany` (9 rows, **1 RTT** — CP358 refactor)
   - `user_mandalas.findUnique` with nested `levels` include
4. **Outside transaction, still in the handler**:
   - `user_mandalas.update` with `focus_tags`/`target_level` (conditional, 0–1 RTT)
   - `user_skill_config.createMany` (1 RTT)
   - `setImmediate` label-generation fire-and-forget (not in hot path)
   - `triggerMandalaPostCreationAsync` fire-and-forget (not in hot path)

**Approximate hot-path RTTs: ~5** (dup-check + 1 parallel batch + 3 txn + 1 skill-config).
At Supabase us-west-2 RTT of ~80ms from an in-region host, that should
total ~400ms — **not 15 seconds**.

### 1.3 Latency-breakdown gap

The endpoint already emits `Server-Timing` per stage (mandalas.ts:880,
observability landed in PR #410). Prod logs will have per-stage ms:

```
validation;dur=<n>, quota_check;dur=<n>, create_mandala;dur=<n>,
focus_update;dur=<n>, skill_config;dur=<n>, trigger_pipeline;dur=<n>
```

**Until we have the prod per-stage breakdown, the root cause for the
52× slowdown is unconfirmed.** Candidate hypotheses:

| # | Hypothesis | Disproof signal | Mitigation |
|---|-----------|----------------|------------|
| H1 | `connection_limit` override (PR #402) not applied in prod | Prisma debug log shows `connection_limit=1` in URL | Verify env, restart container |
| H2 | pgbouncer transaction-mode connection acquisition stalling | `create_mandala` stage dominates (>10s) | Widen pool further or move to session mode for this endpoint |
| H3 | Serverless cold-start on API host | First request of the day slow, subsequent fast | Pre-warm on deploy |
| H4 | Region mismatch (app ≠ DB) inflating every RTT | RTT > 200ms per hop | Regional move (see §5) |
| H5 | Prisma prepared-statement collision under `pgbouncer=true` | Query plan cache thrash in logs | Confirm URL has `pgbouncer=true` + `connection_limit>1`; upgrade Prisma |

The next session should **run `/tc-tune --env prod` after the app
container has captured `Server-Timing` logs** and publish the
per-stage table before any code fix.

### 1.4 Why this matters for UX (not just metrics)

- User clicks "Go" at end of wizard → sees a static "creating..." spinner
  for 15–25s → perceives the app as broken.
- On manual test 0417010 the user reported "30+ seconds" which is
  consistent with the 25s worst case plus `aiGenerate` (~15s avg on prod)
  running **before** this call in the wizard flow.
- Even if we fully diagnose H1–H5 and recover dev-parity latency, the
  hot-path still has to serialize ~5 RTTs behind a user-blocking UI.

---

## 2. Proposal

### 2.1 Split the endpoint

**Phase 1 — Skeleton (user-blocking, target < 500ms):**

```
POST /api/v1/mandalas/create-skeleton
  Body: { title, centerGoal, language?, focusTags?, targetLevel? }
  Response: { mandalaId, status: 'skeleton' }
```

Writes minimally: one `user_mandalas` row + one `user_mandala_levels`
depth=0 row with placeholder `subjects` (8 empty strings or
`'…'` sentinels). Quota + duplicate-title checks stay here.

**Phase 2 — Fill (fire-and-forget or polled, target < 10s end-to-end):**

```
POST /api/v1/mandalas/:id/fill
  Body: { subjects, subDetails, subLabels, centerLabel, skills }
  Response: { status: 'filled' }
```

Writes the depth=0 `subjects` + depth=1 rows + `user_skill_config`.
Client fires this immediately after the skeleton response returns,
and navigates to the dashboard **without awaiting** the fill.

**Phase 3 — Client polling / subscription:**

Dashboard renders skeleton cells with a shimmer while polling
`GET /api/v1/mandalas/:id` every 500ms (bounded 30s), or subscribes
to a Supabase Realtime channel on `user_mandala_levels`.

### 2.2 Alternatives considered

| Alt | Verdict | Reason |
|-----|---------|--------|
| **A. Diagnose-then-fix without split** | Worth trying first | If H1 (env-flag gap) is the cause, a deploy re-check may restore dev-parity latency with 0 code. Do not split until H1–H3 are ruled out. |
| **B. Raw SQL multi-row `INSERT ... VALUES` for levels** | No benefit | `createMany` already batches into one statement (CP358). Not the bottleneck. |
| **C. Regional move (app → us-west-2)** | Out of scope here | Large infra change; belongs in a separate Issue. Would mitigate H4 but not H1–H3. |
| **D. Drop the transaction, accept partial writes on failure** | Rejected | Loses atomicity of the quota check + mandala insert pair, recreates the pre-CP362 "orphan-mandala-row" class. |
| **E. Server-Sent Events streaming the fill** | Possible Phase 3 variant | Simpler than Realtime subscription, avoids long-poll overhead. Revisit after basic polling ships. |
| **F. `setImmediate` the heavy writes from inside the single endpoint** | Close to §2.1 but worse | Leaves a single endpoint with hidden async behaviour. Harder to observe, retry, and roll back than two explicit endpoints. |

### 2.3 Transaction boundary

Skeleton endpoint retains the parallel quota reads + a **compact
transaction** (1 mandala row + 1 placeholder level row). Fill endpoint
uses the existing `updateMandalaLevels` path (already CP358-hardened).

**Idempotency:** skeleton insert is NOT idempotent by default (each
request creates a new mandala). Client must not retry the skeleton
call without explicit user intent. Fill endpoint is idempotent by
`mandala_id` — it fully replaces the level rows for the given id.

**Failure modes:**

| Failure | Recovery |
|---------|----------|
| Skeleton succeeds, fill fails | Dashboard renders empty mandala + a "Retry fill" button calling the same fill endpoint |
| Skeleton succeeds, user closes tab before fill | Empty mandala persists; user sees it on next login, can fill manually from the UI |
| Skeleton fails | No mandala created; current error handling (429 quota, 409 duplicate, 500 create) applies |

---

## 3. Data-model impact

No schema changes. The existing `user_mandalas.is_default` and
`user_mandala_levels.subjects` columns accept empty / placeholder
strings today. Status is implicit: an "empty" mandala is one whose
depth=0 level has all-empty subjects; we already treat this
gracefully in the sidebar + dashboard renderers (per `ux-issues.md`
notes about "niche cell 0 honest empty").

---

## 4. API contract changes

### 4.1 New endpoints

Both under `src/api/routes/mandalas.ts`. Auth + rate limit identical
to current `/create-with-data`.

```
POST /api/v1/mandalas/create-skeleton
  200 → { status: 200, data: { mandalaId: string, status: 'skeleton' } }
  400 → { status: 400, code: 'INVALID_INPUT', message: ... }
  409 → { status: 409, code: 'DUPLICATE_TITLE', ... }
  429 → { status: 429, code: 'DAILY_LIMIT_REACHED' | 'QUOTA_EXCEEDED', ... }
  500 → { status: 500, code: 'CREATE_FAILED', ... }

POST /api/v1/mandalas/:mandalaId/fill
  200 → { status: 200, data: { status: 'filled' } }
  400 → { status: 400, code: 'INVALID_INPUT', message: ... }
  403 → { status: 403, code: 'NOT_OWNER', ... }
  404 → { status: 404, code: 'NOT_FOUND', ... }
  500 → { status: 500, code: 'FILL_FAILED', ... }
```

### 4.2 Keep `/create-with-data` as a compatibility shim?

**Recommendation: yes, for one release.** Internally re-implement as
`skeleton → fill` sequential. Deprecate after the frontend is fully
migrated. This respects CLAUDE.md's "BE route → FE api-client method →
URL contract test" rule (tests in `tests/unit/api-url-contract.test.ts`).

### 4.3 Per-stage `Server-Timing` on both endpoints

Keep the pattern from PR #410 so the regression-diagnosis loop stays
tight.

---

## 5. Frontend change surface

- `frontend/src/features/mandala-wizard/**` — split the final submit
  call into two network calls; navigate after the skeleton returns.
- `frontend/src/features/mandala-list/**` — handle the "skeleton"
  state so the sidebar doesn't show a broken entry during the fill
  window.
- `frontend/src/widgets/mandala-grid/**` (exact path TBD during
  implementation) — shimmer/placeholder for empty cells.
- `frontend/src/shared/api/mandalas.ts` — add two client methods,
  retire the single `createWithData` after deprecation window.

**URL contract tests (mandatory):** new endpoints MUST be added to
`tests/unit/api-url-contract.test.ts` before merging — per CLAUDE.md
"BE route added → FE api-client method → URL contract 테스트 필수".

**D&D check:** the mandala-grid surface is inside `AppShell`, so the
`DndContext` invariant is not at risk. No changes to `shellStore`,
`dndHandlersRef`, or `AppShell.tsx`. Pre-flight checklist item noted.

---

## 6. Observability

1. Each new endpoint emits `Server-Timing` identical in shape to
   PR #410.
2. Structured log on skeleton success includes `mandalaId`, `userId`,
   `stage_ms_breakdown`, `total_ms`.
3. Structured log on fill success adds `level_count`,
   `total_subjects`, `total_actions`.
4. A new TC round (`/tc-tune --env prod`) after Phase 1 lands MUST
   show `createSkeletonMs` avg < 500ms before Phase 2 is started.

---

## 7. Risks + mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Empty mandala visible in sidebar confuses user | Medium | Shimmer placeholder + "Filling..." label during Phase 2; migration to "filled" without a flash |
| Fill fails silently, user never notices | Medium | Client retries once, then shows an in-dashboard banner with a manual retry button |
| Race: user deletes mandala mid-fill | Low | Fill endpoint uses `where: { id, user_id }` upsert pattern — row-level ownership guard already present |
| Compatibility shim `/create-with-data` drifts from new endpoints | Low | URL contract tests + deprecation timeline committed in-PR |
| Split endpoint doubles request count and hits rate limit | Low | Fill endpoint gets the same throttle bucket as skeleton (`3/10s per user`); combined request cost ≤ existing bucket |
| Issue #414 relevance regression interacts with the fill pipeline | Unknown | `triggerMandalaPostCreationAsync` runs **after** fill (unchanged); any relevance signal will surface identically in both the old and new flows |

---

## 8. Rollout

1. **Diagnose first** — capture prod `Server-Timing` per stage via
   existing PR #410 instrumentation. If H1 (env-flag) is confirmed,
   fix env + re-measure before committing to the split.
2. **If split is still needed** (post-diagnosis):
   - Phase 1 PR: add `create-skeleton` endpoint, keep
     `/create-with-data` unchanged, add tests.
   - Phase 2 PR: add `:id/fill` endpoint + FE wiring behind a feature
     flag (`WIZARD_SPLIT_ENABLED=true`).
   - Phase 3 PR: flip the flag on, keep `/create-with-data` as shim
     for 1 week, then remove.
3. **Validation gates per phase:**
   - `/verify` PASS, `npx tsc --noEmit`, `vitest`, `jest`
   - `/tc-tune --env dev` → perceived navigate < 3s
   - `/tc-tune --env prod` → same, using baseline JSON diff
   - Manual test: `tests/manual/mandala-relevance-test.md` LEVEL-0 + §9
     (when added)

---

## 9. Open questions

- Should the skeleton endpoint accept `subjects` eagerly (so the dashboard
  has labels to render) while deferring only `subDetails` / skill rows?
  Trade-off: one fewer placeholder state vs one more write in the hot path.
- Is a Supabase Realtime subscription cheaper than 500ms polling at our
  concurrency levels? Depends on Realtime seat pricing (out-of-scope for
  this doc; flag to ops).
- Should `triggerMandalaPostCreationAsync` move to the fill endpoint so
  recommendations only start after levels are populated? Currently it
  fires from `/create-with-data`; the new flow has no natural single
  call site. Likely: fire it from the fill endpoint success path.

---

## 10. References

- Issue #413 — Wizard → Dashboard 30s+ latency
- Issue #414 — Mandala card relevance regression
- CP385 PR #402 — Prisma `connection_limit` runtime URL override
- CP385 PR #410 — Per-stage `Server-Timing` observability
- CP385 PR #411 — YouTube API key rotation
- `src/api/routes/mandalas.ts:690` — current `/create-with-data` handler
- `src/modules/mandala/manager.ts:330` — `createMandala`
- `src/modules/mandala/manager.ts:155` — `createLevels` (CP358 refactor)
- `src/modules/database/connection-url.ts` — `buildConnectionUrl`
- `tests/manual/mandala-relevance-test.md` — regression sampling procedure
- CLAUDE.md — "BE route 추가 → FE api-client → URL contract" rule
- CLAUDE.md — "Cross-Layer Propagation" L0 → L6 modification order

---

**Last updated:** 2026-04-18
