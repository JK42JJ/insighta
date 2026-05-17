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

## Pending — Phase 2 steps 4–9 (next session)

| Step | Work |
|---|---|
| 4 | Fastify endpoints — `POST /api/v1/cards/:videoId/{like,unlike,archive,unarchive}` in `src/api/routes/cards.ts`. like calls `enqueueEnrichRichSummary` + sets `pinned_at=now()`. archive INSERTs signal + soft-hides row. |
| 5 | Hook into existing delete path — find BE handler behind `useDeleteLocalCard` (`getEdgeFunctionUrl('local-cards','delete')` — verify whether to relocate to Fastify or keep on Edge Function + cross-call). INSERT `card_interactions` `signal='delete'` on every successful delete. |
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
