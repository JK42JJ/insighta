# Idempotent relevance — single SSOT calculator (CP499 design)

> Status: DESIGN (approved decisions, pre-implementation). Read-only diagnosis
> behind it: see the CP499 session trace. No code changed by this doc.
> **No DB migration** (decision 1 keeps the `(user, video)` key; `relevance_pct`
> /`relevance_at` columns already exist on `user_video_states` + `user_local_cards`
> from PR3a/b).

## Problem this closes
Two different "관련도" numbers coexisted, from two columns with different
semantics, computed by two engines:

| | column | key | engine | input | leak |
|---|---|---|---|---|---|
| BADGE (removed #870) | `video_rich_summaries.mandala_relevance_pct` | **video_id** (PK) | v2 quick/full generator (Heart) | transcript vs centerGoal | **yes** (no user filter) |
| SORT (`관련도순`) | `user_video_states / user_local_cards.relevance_pct` | **(user, video)/(user, url)** | `computeCardRelevance` (backfill) | title(+desc) vs centerGoal | no |

Symptoms: a video reused across users showed another user's score (leak);
bookmark "created a %" and reshuffled (the video-keyed badge); the displayed
number ≠ the sorted-by number (dual-number confusion).

## The 4 decisions (approved)

### 1. Key — keep `(user, video)`, no change. `relevance_pct` (uvs/ulc) is the SSOT store.
- Drop `mandala_relevance_pct` (video-keyed) as a **relevance source**. The
  user-scoped `relevance_pct` on `uvs`/`ulc` is the single relevance store.
- Because `uvs` is unique `(user_id, videoId)` and `ulc` unique `(user_id, url)`,
  a video lives in **one mandala per user** today → `(user, video)` already *is*
  `(user, video, its-one-mandala)`. No `mandala_id` needed in the key now.
- **Multi-mandala (same video in N mandalas) = separate roadmap.** When taken
  on, add a **dedicated relevance table** keyed `(user_id, video_id, mandala_id)`
  — decoupled from placement so batch/dedup logic is untouched. NOT now.
- **No migration**: columns exist, no key change, no new column.

### 2. SSOT calculator = `computeCardRelevance` + a new `cellGoal` param.
- `compute-card-relevance.ts` signature gains `cellGoal?: string`. The prompt
  scores `title(+desc)` against `centerGoal` **+ cellGoal** (cell context) when
  provided; centerGoal-only when not (back-compat / non-cell entrances).
- **All three entrances route through this one function** (Q4-confirmed it's the
  right shape): wizard, manual, backfill. No other code computes relevance.
- **`mandala_relevance_pct` is removed as a relevance source:**
  - Stop *sourcing relevance* from it. The v2 summary may keep computing it as
    an internal artifact, but nothing reads it as "relevance". Prefer removing
    the write (`v2-quick-generator.ts:187/199`, `v2-generator.ts:292/310`) once
    the dot signal is repointed; until then, leave the column unused.
  - **Repoint the "v2 done?" dot signal**: `InsightCardItemV2.tsx:364`
    `v2EnrichmentPending = liked && mandalaRelevancePct == null` → use a
    summary-presence signal instead (e.g. `card.v2OneLiner == null`), so the dot
    no longer depends on `mandalaRelevancePct`.
  - **Clean up the leaky fetch**: `/cards/v2-summaries` (`cards.ts:1027`, no user
    filter) + `useV2Summaries` + `CardList.tsx:447-450` prop threading — once the
    dot is repointed and the badge is user-scoped, stop fetching
    `mandalaRelevancePct`. (This also closes the separate "/v2-summaries leak"
    backlog item.)

### 3. Manual add = batched prompt on panel close.
- Today: each pick → immediate `POST /cards/:videoId/like` (single), which
  triggers the *v2* engine (wrong source). Change to:
  - Accumulate picks (already in `add-cards-panel` localStorage/rounds).
  - **On panel close → batch commit.** Score the batch with **one prompt over N
    titles, each title scored INDEPENDENTLY** (no cross-influence from
    neighboring videos in the batch — the prompt must isolate per-title).
  - **Partial-failure isolation**: persist the successes, retry only the failed
    subset. A bad row never blocks the batch.
- Impacted: `add-cards-panel/` (AddCardsPanel, persistence.ts) + `cards.ts`
  like route OR a new batch endpoint (decide at impl: a `POST /mandalas/:id/
  relevance-batch` taking `[{rowId, title}]` is cleaner than overloading like).

### 4. Compute location per entrance (all via the one SSOT).
| entrance | when | context available | call site |
|---|---|---|---|
| **Wizard** | **async**, on creation (fire-and-forget) | cellGoal from the already-fetched mandala `levels[0].subjects[cell_index]` (0 extra query) | `pipeline-runner.ts` fires the relevance trigger after auto-add (next to rich-summary). ⚠️ NOT sync-inline at `executor.ts:295` — that only assembles in-memory; the DB write is `auto-add-recommendations.ts:305`, and ~64 sync Haiku calls would blow the wizard latency cap. The worker scores off the hot path; the badge appears once `relevance_pct` lands. NOT flag-gated. |
| **Manual** | on panel **close** (batch) | centerGoal + the cell each pick targets | batch commit (decision 3) |
| **Backfill** | existing worker | centerGoal (+ cellGoal from row's cell) | `enrich-relevance-quick.ts` (already routes to `computeCardRelevance`) |

## Idempotency rules (normative — implement exactly)
1. **Skip-if-exists guard**: an entrance computes relevance for a row **only if
   `relevance_pct IS NULL`** (not yet scored). Re-entry / re-trigger is a no-op
   for already-scored rows.
2. **Relevance ≠ behavior**: relevance is computed at *card entry* (content
   signal), never by a *behavior* action (bookmark/Heart/like). Bookmark may
   still trigger the **summary** (one_liner/segments) but produces **no
   relevance number**. (This is the bookmark-pollution fix.)
3. **Display = stored value**: the UI reads `relevance_pct` and shows it verbatim
   (no recompute on render, no second number).
4. **Upsert**: writes are upserts on the existing key; concurrent entrances
   converge (skip-guard + upsert = safe under races / double-trigger).
5. **Forced recompute only on input change**: the *single* legitimate reason to
   overwrite a non-null `relevance_pct` is when the **input changed** — i.e. the
   user **edits the mandala center goal** (or a cell goal). That edit path
   explicitly nulls the affected rows' `relevance_pct` → entrances/​backfill
   re-score them. No other path overwrites.

## Display — how title relevance re-appears on cards (decision-required detail)
#870 removed the video-keyed badge. The SSOT enables a **new user-scoped badge**
that reads `relevance_pct` (NOT the old `mandala_relevance_pct`):

- **Mechanism**: show the badge **iff `relevance_pct != null`** (display = stored
  value). No separate "revival flag" — presence drives visibility. This makes
  **badge value == sort value** (both `relevance_pct`) → the dual-number
  confusion cannot recur. This is the (i) "unify to user-scoped" end-state,
  now reachable because the SSOT computes `relevance_pct` at every entrance.
- **Coverage / timing (the phased revival — specify in impl)**:
  - **New cards** (wizard placement / manual commit, after this ships) → scored
    at entry → badge shows **immediately**.
  - **Existing cards** → `relevance_pct` is null until **fleet backfill**
    (`BACKFILL_RELEVANCE_ENABLED` on + auto-hooks/admin, ~$30/6k). Until then
    they show **no badge** (null) — not wrong, just absent.
  - **Recommendation**: re-introduce the badge reading `relevance_pct`, shown
    when non-null. Accept partial coverage (new = immediate, old = after
    backfill). The fleet backfill is the rollout step that completes coverage.
    Do **not** gate display on a flag; "shown when present" handles both phases.
- **Label**: plain relevance (color-tiered text, as the old badge rendered) — no
  "maturity" (confirmed: maturity does not exist). One number, one meaning.

## Out of scope (roadmap / separate tracks)
- Multi-mandala relevance table `(user, video, mandala)` — when multi-mandala
  ships.
- **B-stage behavior metering** (playtime/completion/replay) + complex sort
  (content relevance × behavior) — needs a new store; `card_interactions` is
  binary. Built on the resume-fix save hook (separate (A) track).
- Resume/watch-position fix (A) — separate, queued.

## Impacted files (no migration)
- `compute-card-relevance.ts` — `+cellGoal` param + prompt.
- `pipeline-runner.ts` — fire the relevance trigger (async, fire-and-forget) on wizard creation, next to the rich-summary trigger. (`executor.ts` only assembles; no DB write there.)
- `relevance-backfill-trigger.ts` — resolve `cellGoal` per row from the fetched mandala's `subjects[cell_index]` + pass to the worker; `RelevanceQuickPayload` + worker forward `cellGoal`.
- `add-cards-panel/*` + `cards.ts` (or new batch endpoint) — manual batch-on-close.
- `enrich-relevance-quick.ts` / trigger — pass cellGoal (backfill).
- `rich-summary-v2-*generator.ts` — stop sourcing relevance from `mandala_relevance_pct`.
- `InsightCardItemV2.tsx` — dot signal repoint + (re-add) user-scoped badge reading `relevance_pct`.
- `cards.ts:1027` `/v2-summaries` + `useV2Summaries` + `CardList.tsx` — drop `mandalaRelevancePct` fetch/threading.
- Mandala-goal-edit path — null affected `relevance_pct` (forced recompute trigger).
- `prisma/schema.prisma` — **no change** (columns exist, key unchanged).
