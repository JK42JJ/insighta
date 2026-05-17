# Handoff — Card Interactions (Issue #649) Phase 2 step 2 → step 3-9 carryover

**Date**: 2026-05-17 (CP462)
**Branch**: `feat/card-interactions-issue-649` (off `origin/main`)
**Phase 1 commit**: `1dd1dbf0` (DDL + Prisma)
**Phase 2 step 2 commit**: see most recent commit on the branch
**Status**: Phase 1 + Phase 2 step 2 (queue handler) shipped. Steps 3–9 deferred to the next session.

---

## What is done

### Phase 1 (commit `1dd1dbf0`, 5 files +209)

- `prisma/migrations/card-interactions/001_create_table.sql` — `card_interactions` table + `card_signal` enum (`like`/`archive`/`delete`/`watch_complete`/`skip`) + 3 indexes + 3 RLS policies
- `prisma/migrations/rich-summary-v2/005_mandala_relevance_pct.sql` — `video_rich_summaries.mandala_relevance_pct INTEGER` + range CHECK (0–100 or NULL)
- `prisma/schema.prisma` — model + enum + column + users / user_mandalas inverse relations
- `scripts/apply-custom-sql.sh` — APPLY_FILES allowlist += 2 (CI/CD prod apply)
- `.gitignore` — negate patterns for new migration directories
- Local DB apply ✔ / `\d` verified ✔ / NOTIFY pgrst ✔

### Phase 2 step 2 (current commit)

- `src/modules/queue/types.ts` — `JOB_NAMES.ENRICH_RICH_SUMMARY` + `EnrichRichSummaryPayload` + `RICH_SUMMARY_RETRY_OPTIONS` (no retry, 5-min expiry — user is actively waiting) + `QUEUE_CONFIG.RICH_SUMMARY_CONCURRENCY = 5`
- `src/modules/queue/handlers/enrich-rich-summary.ts` (NEW) — worker that ensures v1 row + then upgrades to v2 (corrected in step 3 — original draft called only the v1 path; see step 3 below)
- `src/modules/queue/index.ts` — registers worker on `initJobQueue()`, exports `enqueueEnrichRichSummary`
- tsc PASS ✔

### Phase 2 step 3 (current commit — v2 prompt + path correction)

- `src/modules/skills/rich-summary-v2-prompt.ts` (5 edits)
  - `MandalaFit` interface gains required `mandala_relevance_pct: number`
  - `PromptInput` gains optional `mandalaCenterGoal?: string`
  - prompt template adds `{mandala_center_goal}` line + `mandala_relevance_pct` field in JSON + field rules
  - `buildV2Prompt` substitutes the new placeholder (capped at `MANDALA_CENTER_GOAL_MAX_CHARS=200`)
  - `validateV2Layered` enforces integer 0–100; `scoreCompleteness` includes the field in the `mandala_fit` weight
- `src/modules/skills/rich-summary-v2-generator.ts` (3 edits)
  - `V2GenerationInput` gains optional `mandalaCenterGoal?: string`
  - `buildV2Prompt` call passes it through
  - skip condition tightened: `template_version === 'v2' && mandala_relevance_pct != null` — legacy v2 rows with NULL score are regenerated on the next Heart click (Lazy backfill, decision #11)
  - UPDATE writes the new column
- `src/modules/skills/rich-summary-reader.ts` (1 edit) — v1 row reader defaults `mandala_relevance_pct=0` so the FE quality badge stays hidden for non-Heart'd cards (correct visual fallback)
- `src/modules/queue/handlers/enrich-rich-summary.ts` (path correction) — now runs the 2-step flow:
  1. `enrichRichSummary` (v1) — bootstraps the row when missing (short-circuits on cache hit)
  2. `getMandalaManager().getMandalaById(userId, mandalaId)` → `levels[0].centerGoal`
  3. `generateRichSummaryV2({ videoId, userId, mandalaCenterGoal })` — v2 upgrade + score
- `tests/unit/api/transcript-direct-upsert.test.ts` + `tests/unit/skills/rich-summary-v2.test.ts` — `mandala_relevance_pct: 75` added to valid payloads
- jest 26 + 31 tests PASS ✔, tsc PASS ✔, v1-only tests (rich-summary-prompt, summary-gate) unaffected

### Phase 2 step 4 (current commit — 4 Fastify endpoints)

- `src/api/routes/cards.ts` (+~230 lines) — 4 new endpoints mirroring the
  Pin PATCH pattern (auth + body validation + raw SQL + structured error
  codes):
  - `POST /:videoId/like` body `{mandalaId?, title?, description?}` —
    card_interactions UPSERT signal='like' + pinned_at=now() on every
    matching user_local_cards / user_video_states row (auto-eviction
    guard) + enqueueEnrichRichSummary pg-boss job when mandalaId is
    supplied. Returns 202 with `{signalRecorded, jobId, pinnedRows}`.
  - `POST /:videoId/unlike` — DELETE signal + pinned_at=NULL on both
    source tables. Returns 204.
  - `POST /:videoId/archive` body `{mandalaId}` — UPSERT signal='archive'
    with mandala_id. Mandala-agnostic UNIQUE (user_id+video_id+signal)
    means archiving the same video in a different mandala overwrites the
    mandala_id; per-mandala archive scoping deferred. Returns 204.
  - `POST /:videoId/unarchive` — DELETE signal='archive' regardless of
    which mandala originally archived. Returns 204.
- videoId validated against `/^[A-Za-z0-9_-]{11}$/` (YouTube id pattern).
  card_interactions.video_id is VARCHAR(11) so this is a 1:1 match.
- pinned_at write uses raw SQL for both tables to avoid Prisma
  `@updatedAt` auto-touch (same rationale as Pin PATCH).
- tsc PASS ✔, smoke (POST /like + /archive without auth → 401) ✔.
- URL contract test entries deferred to step 9 (Tests).

### Phase 2 step 5 (current commit — delete signal hook)

- `supabase/functions/local-cards/index.ts` (delete case) — chained
  `.select('video_id')` onto the existing `.delete()` so we receive the
  deleted row's YouTube id, then UPSERT a `card_interactions` row with
  `signal='delete'` and `mandala_id=null` (user-global "do not
  recommend" per decision #7). Signal write is non-fatal — failures log
  a warning but the original delete success stays intact.
- `/Users/jeonhokim/cursor/superbase/volumes/functions/main/index.ts`
  (local-cards delete case) — mirrored the same change per the CLAUDE.md
  "로컬 Supabase Edge Function 이중 구현" Hard Rule. Lives in the
  separate `superbase` repo so it is NOT in this commit.
- Auto-eviction in `auto-add-recommendations.ts` deletes `user_video_states`
  rows directly via Prisma — it bypasses this handler entirely, so cron
  cleanups will never produce stray `signal='delete'` rows.
- `docker restart supabase-functions-dev` ✔, smoke
  (POST /functions/v1/local-cards with auth missing → 401) ✔.
- One caveat: the FE single-card delete uses `getEdgeFunctionUrl(...)`
  with `action: 'delete'`. Multi-select delete in `CardListView` calls
  `onDeleteCards?.(selectedCardIds)` which the host component decomposes
  into per-id calls of the same Edge route, so the same hook covers both
  flows automatically.

### Phase 2 step 6 (current commit — SSE enrich-stream)

- `src/api/routes/cards.ts` (+~120 lines)
  - `GET /:videoId/enrich-stream` — Server-Sent Events stream of the
    Heart-click v2 enrichment progress. Polls `pgboss.job` every 1s for
    the most recent `enrich-rich-summary` job matching (user, video) and
    emits a `phase` event when the pg-boss state transitions:
    - `created` / `retry` → `'fetching'` (수집 중)
    - `active` → `'analyzing'` (분석 중)
    - `completed` → `'scored'` (평가 완료, stream closes)
    - `failed` / `cancelled` / `expired` → `'failed'` (stream closes)
  - SSE headers: `text/event-stream`, `Cache-Control: no-cache`,
    `Connection: keep-alive`, `X-Accel-Buffering: no` (disables Nginx
    buffering in prod).
  - Hard caps: 5-min max duration (matches `RICH_SUMMARY_RETRY_OPTIONS.
    expireInMinutes`); cleanup on `request.raw.on('close', …)`.
  - Initial `fetching` event fired before the first poll so the FE has
    something to render immediately.
- `mapJobStateToPhase()` helper exported as private; centralised so the
  FE vocabulary stays consistent across this endpoint and any future
  polling caller.
- Smoke: GET without auth → 401 ✔ (route registered).

### Phase 2 step 7 (current commit — v2-summaries batch endpoint)

- `src/api/routes/cards.ts` (+~85 lines)
  - `GET /v2-summaries?videoIds=a,b,c` — batch lookup of v2 fields
    (`oneLiner`, `mandalaRelevancePct`, `qualityFlag`, `templateVersion`)
    used by the FE card grid to render the Heart-only quality badge
    (TL) and the footer one-liner.
  - videoIds validated against the YouTube 11-char regex; max 128 ids
    per request (≈ 2× V3_TARGET_TOTAL of 64) to bound response time.
  - Prisma `findMany` with `video_id IN (…)` — single query, no N+1.
- Decision (A) `Edge function + mandalas.ts LEFT JOIN` was rejected:
  too large a change for one PR, would touch the CLAUDE.md "이중 구현"
  Hard Rule pair. Single batch endpoint is the lighter contract that
  the FE can consume from any source — local cards, mandala recs, or
  a future re-search side panel.
- Schema-level caveat documented inline: `video_rich_summaries` is
  keyed by video_id alone, so `mandala_relevance_pct` reflects the
  FIRST user / mandala that triggered v2. Per-user scoring would
  require a `user_video_relevance` table; out of scope for #649 Phase 2.
- Smoke: GET without auth → 401 ✔ (route registered).

### Phase 2 step 8 (current commit — RICH_SUMMARY_ENABLED deploy wiring)

- `.github/workflows/deploy.yml`
  - `env:` block — references `${{ vars.RICH_SUMMARY_ENABLED }}` (a
    GitHub Variable, not Secret, per CP392 — it is a boolean toggle,
    not a credential).
  - `envs:` list — appended `RICH_SUMMARY_ENABLED` so the env reaches
    the SSH deploy step.
  - Deploy script — `if [ -n "${RICH_SUMMARY_ENABLED}" ]` guarded
    `grep / sed / echo` writes the row idempotently. When the Variable
    is unset/empty the branch falls through, so prod stays on the
    `config/rich-summary.ts:39` default `false` (no v2 generation).
- `credentials.md` L6 table — new entry documenting the Variable name,
  consumer, quota math (free 30 / pro 200 / lifetime+admin unlimited),
  and the activation command.

**Manual step required (cannot be automated from this branch)**:

```bash
# 1. Register the GitHub Variable at the repo level
gh variable set RICH_SUMMARY_ENABLED --body true

# 2. Verify it shows up in vars
gh variable list | grep RICH_SUMMARY_ENABLED

# 3. Redeploy to pick up the new value on prod
gh workflow run deploy.yml  # or merge any PR onto main

# 4. Confirm prod EC2 .env has the row
bash scripts/ssh-connect.sh "grep RICH_SUMMARY_ENABLED /opt/tubearchive/.env"
# expected: RICH_SUMMARY_ENABLED=true
```

Quota expectations: free tier = 30 v2 generations / month, pro = 200,
lifetime / admin = unlimited. enrichRichSummary cache-hits (existing
`quality_flag='pass'` row) do NOT consume quota, so the realistic
Heart-click cost is well below cap when cron pre-fills most cards.

### Phase 2 step 9 (current commit — smoke test)

- `tests/smoke/card-interactions.test.ts` (NEW, 7 tests)
  - `POST /:videoId/{like,unlike,archive,unarchive}` → 401 without token
  - `GET /v2-summaries?videoIds=…` → 401 without token
  - `GET /:videoId/enrich-stream` → 401 without token
  - `POST /like` without auth must NOT return 200/202 (no false-pass
    on body validation order)
  - Mirrors `cards-pin-routes.test.ts` pattern (describeIfServer so
    local jest skips when SUPABASE_JWT_SECRET / JWT_SECRET / SUPABASE_URL
    are unset; CI sets them and the 7 tests execute).
- Run locally: skipped (no env). On CI: executes against a freshly
  built Fastify instance.
- FE URL contract test entries (`frontend/src/__tests__/smoke/
  api-url-contract.test.ts`) are deferred to Phase 3 — those checks
  require the new api-client methods (`likeCard`, `archiveCard`, etc.)
  which are introduced when the FE consumes these endpoints.

---

## Decisions captured in CP462 (all binding for steps 3–9)

| # | Decision | Detail |
|---|---|---|
| 1 | Signal table name | `card_interactions` (NOT `card_user_signals`) |
| 2 | Schema option | B — dedicated table, video-id keyed, source-agnostic across `user_local_cards` + `user_video_states` |
| 3 | Pin vs Heart | Pin UI **completely removed**. Heart at BR (썸네일 우하단). Heart click sets `pinned_at=now()` to inherit auto-eviction protection. |
| 4 | Heart UI position | BR (썸네일 우하단) |
| 5 | Archive UI position | BL (썸네일 좌하단) |
| 6 | Archive scope | Mandala-only (mandala_id required). No global reranker effect. Soft hide with 5s undo. |
| 7 | Delete (다시 추천 안 함) | **No new menu/button** — reuse existing header multi-select delete + single-card delete. BE delete handler INSERTS `card_interactions` `signal='delete'` (`mandala_id=NULL`, user-global). Reranker applies hard exclusion (Phase 4). |
| 8 | TL quality badge | Only on Heart'd cards (`mandala_relevance_pct` 0–100). Generic `rec_score` 70+ badge removed. |
| 9 | Footer one_liner | `core.one_liner` italic line-clamp-1, Heart'd cards only |
| 10 | mandala_relevance_pct source | Option B — new top-level column, v2 prompt outputs single 0–100 score |
| 11 | v2 backfill strategy | (a) Lazy regenerate — Heart click triggers v2 re-generation on legacy rows |
| 12 | Worker pool | pg-boss (already installed) — NOT BullMQ. Concurrency `RICH_SUMMARY_CONCURRENCY=5`, no retry |
| 13 | Animation phases (FE) | 수집 중 / 분석 중 / 평가 완료 (Fetching / Analyzing / Scored) |
| 14 | Endpoint architecture | All-Fastify (Pin pattern mirror). NOT Edge Function |
| 15 | RICH_SUMMARY_ENABLED prod | Activate at Phase 2 deploy via GitHub Variable + quota distribution review |

---

## Phase 2 — complete (steps 1-9 shipped)

All BE infrastructure for Issue #649 Phase 2 is in place. The only
remaining manual gate before the FE work can demonstrate the full
Heart-click flow end-to-end is the `gh variable set
RICH_SUMMARY_ENABLED --body true` + redeploy described above.

## Phase 3 — complete (FE card UI shipped)

End-to-end Heart / Archive / v2 progress animation wired up against
the Phase 2 BE.

### File touch summary

- `frontend/src/shared/lib/url-normalize.ts` — exported the existing
  `extractYouTubeVideoId` helper (was private).
- `frontend/src/shared/lib/api-client.ts` (+~75 lines, 5 methods)
  - `likeCard(videoId, {mandalaId?, title?, description?})` → 202 with
    `{signalRecorded, jobId, pinnedRows}`
  - `unlikeCard(videoId)` → 204
  - `archiveCard(videoId, mandalaId)` → 204
  - `unarchiveCard(videoId)` → 204
  - `getV2Summaries(videoIds[])` → `{items[]}` batch lookup
- `frontend/src/features/card-management/model/useLikeCard.ts` (NEW)
  — `like.mutate({videoId, mandalaId, title, description})` /
  `unlike.mutate(videoId)`. Invalidates `localCardsKeys.list()` +
  `['mandala','recommendations',...]` on success (mirrors
  `usePinCard`'s pattern).
- `frontend/src/features/card-management/model/useArchiveCard.ts` (NEW)
  — `archive.mutate({videoId, mandalaId})` /
  `unarchive.mutate(videoId)`. Same invalidation strategy.
- `frontend/src/features/card-management/model/useV2Summaries.ts` (NEW)
  — TanStack `useQuery` keyed by sorted dedup'd videoIds (so two
  callers with the same set share the cache). `staleTime` 60s.
  Returns `summariesByVideoId` Map for O(1) lookup in the grid render.
- `frontend/src/features/card-management/model/useEnrichStream.ts` (NEW)
  — opens an `EventSource` against `/api/v1/cards/:videoId/enrich-stream`
  using the Supabase session token via `?access_token=` query param
  (same pattern as `useVideoStream`). Surfaces a state machine
  `idle → fetching → analyzing → scored | failed | timeout` and
  auto-closes on terminal phases.
- `frontend/src/widgets/card-list/ui/InsightCardItemV2.tsx`
  (rewritten, ~400 lines)
  - Pin button retired; the `pinned_at` column is still set
    server-side by `POST /like` (auto-eviction guard, handoff
    decision #3), but the UI exposes Heart instead.
  - **Top-left**: mandala-relevance badge (≥ 70). Sourced from
    the Heart-only `mandalaRelevancePct` prop; non-Heart'd cards
    get no badge (decision #8).
  - **Top-right**: duration (moved from BR, freed by Pin removal).
  - **Bottom-right**: Heart toggle (hover-only when inactive,
    persistent red fill when liked).
  - **Bottom-left**: Archive toggle (hover-only).
  - **Center-top chip**: 3-phase live animation (`수집 중 / 분석 중 /
    평가 완료`) driven by `useEnrichStream`. Failed state surfaces
    a "다시 시도" button (re-opens the SSE).
  - **Card-wide glow ring**: emerald pulse during `analyzing`,
    emerald flash on `scored`, destructive on `failed`.
  - **Footer**: title + (optional) italic `oneLiner` line-clamp-1
    when v2 has scored the card + date / views row.
- `frontend/src/widgets/card-list/ui/CardList.tsx`
  - Dedup'd `videoIds` from the card list → `useV2Summaries(...)` →
    pass-through `mandalaRelevancePct` + `oneLiner` per card.
  - `handleArchived(videoId)` → `sonner` toast with 5-second undo
    affordance (`useArchiveCard().unarchive`).
- `frontend/src/shared/i18n/locales/{ko,en}.json` — 2 new keys
  (`cards.archive.toastSuccess`, `cards.archive.undoLabel`).
- The 3-phase chip strings (`수집 중 / 분석 중 / 평가 완료`) remain
  hardcoded Korean in the card; a follow-up PR can move them to i18n
  if the UI ships to additional locales.

### Verification

- `tsc --noEmit` (FE) ✔
- `vitest run` → **316/316 tests pass** (0 regressions)
- All existing card flows (drag, Pin via BE endpoint, multi-select,
  delete signal hook) remain unaffected — Heart is additive.

### Phase 3 caveats / known limitations

- `mandalaRelevancePct` reflects the FIRST user / mandala that
  triggered v2 generation; subsequent users heart-clicking the same
  video reuse that score. Per-user scoring needs a
  `user_video_relevance` table (out of scope for #649).
- Archive scope is mandala-agnostic at the DB level
  (`UNIQUE(user_id, video_id, signal)`), so re-archiving the same
  video in a second mandala overwrites the mandala_id. Multi-mandala
  archive scoping requires a partial unique index restricted to
  `signal IN ('like', 'delete')` — also out of scope for #649.
- The chip text remains Korean even when the UI language is `en`.
- Heart UI is fully gated by `RICH_SUMMARY_ENABLED`: when the
  GitHub Variable is unset/empty, `POST /like` still records the
  signal but the pg-boss job's `enrichRichSummary` returns early
  (config default `false`), so the FE will see `fetching →
  scored` very quickly with `mandalaRelevancePct = null` and no
  badge / one_liner appears.

## Remaining for Issue #649

| Phase | Work |
|---|---|
| 3 | FE card UI — Heart BR / Archive BL / Delete via existing header buttons / 3-phase animation via EventSource on /enrich-stream / TL badge from /v2-summaries / footer one_liner. New api-client methods + URL contract test entries. |
| 4 | Reranker integration — `hybrid-rerank.ts` adds `userLikedVideoIds` + `userArchivedVideoIds` + `userDeletedVideoIds` features. Reads from `card_interactions`. Hard exclude on `signal='delete'`. |
| 5 | Re-search side panel (Notion peek pattern) — independent backlog per the original handoff `docs/runbook/card-preference-signal-handoff-2026-05-15.md` §8. |
| 6 | SSE endpoint — `GET /api/v1/cards/:videoId/enrich-stream` (text/event-stream). Subscribe to pg-boss job state transitions via `boss.onComplete`/polling, emit 3 phases (Fetching / Analyzing / Scored). |
| 7 | Card list endpoint — extend to LEFT JOIN `video_rich_summaries` and return `one_liner` + `mandala_relevance_pct` (NULL for non-Heart'd cards). Find list endpoint (`videos.ts`? mandala-scoped list in `mandalas.ts`?). |
| 8 | `RICH_SUMMARY_ENABLED=true` — register as GitHub Variable, add to `deploy.yml`, draft quota distribution review (Free/Pro/Lifetime expected Heart-click frequency vs `assertRichSummaryQuota`). |
| 9 | Tests — `tests/smoke/card-interactions.test.ts` (jest), append URL contract entries to `frontend/src/__tests__/api-url-contract.test.ts`. |

---

## Pre-flight before next session (D2 / 추측 금지)

Read first, then act:

- [ ] `supabase/functions/local-cards/index.ts` — verify delete handler shape (does it accept signal field?) before deciding step 5 placement
- [ ] `src/modules/skills/rich-summary-v2-prompt.ts:120–145` (prompt schema) + `:280–320` (parser) — exact JSON shape changes for step 3
- [ ] `src/modules/skills/rich-summary.ts:216` `upsertRichSummary` — column write path; confirm `mandala_relevance_pct` flows through end-to-end
- [ ] `src/api/routes/cards.ts:64` (Pin endpoint) — pattern mirror for new endpoints
- [ ] `frontend/src/features/card-management/model/useLocalCards.ts:210–226` — `useDeleteLocalCard` URL + return shape
- [ ] Card list endpoint location (`videos.ts` vs `mandalas.ts` vs Edge Function `local-cards/list`)
- [ ] `gh variable list` — confirm RICH_SUMMARY_ENABLED naming convention
- [ ] CLAUDE.md compliance: plan → approve → execute per step (do NOT batch steps 3–9 into one commit)

---

## Carryover risks

- **RICH_SUMMARY_ENABLED flag flip** is the gating decision for step 8. Quota math must be done before activation (handoff §4 noted this). If quota would be exhausted by realistic Heart-click volume, consider per-user rate limit at the like endpoint before enqueueing.
- **mandala_relevance_pct on legacy 798 v2 rows** remains NULL until each user heart-clicks the corresponding video. The FE must tolerate NULL gracefully (badge hidden, not "score: NULL" rendered).
- **pg-boss vs Edge Function**: Edge Function for delete vs Fastify for like/archive could create a path split. Step 5 must choose explicitly with the user.
