<!--
GROUND-TRUTH DIAGNOSIS for the wizard / add-cards v5 redesign. [CP491 2026-05-31]
Method: READ-ONLY. Code citations are file:line; metrics are prod measurements
(read-only $queryRaw via scripts/ssh-connect.sh, no writes).
This document is the SINGLE basis for the implementation handoff (2/2).
Do not treat UNCONFIRMED items as facts — they are marked and require the
residual measurements in §6.
-->

# v5 Wizard / Add-Cards Redesign — Diagnosis (Ground Truth) [CP491]

**Date**: 2026-05-31
**Scope**: `/add-cards` synchronous path + wizard precompute path + cell placement + render jank.
**Method**: Read-only. Code = `file:line`. Metrics = prod read-only `$queryRaw` (probes in §7).
**Status of paths**: `WIZARD_PRECOMPUTE_ENABLED=true` in prod; no `V5_*` / `LLM_PICKER_*` env overrides (all code defaults). YouTube search keys = **8** (`YOUTUBE_API_KEY_SEARCH` + `_2`..`_8`).

---

## 0. How to read this doc

Every finding is tagged **CONFIRMED** (code + measurement agree) or **UNCONFIRMED / 불명** (cannot assert without the residual measurement in §6). The implementation handoff must not promote an UNCONFIRMED item to a fact.

---

## 1. CONFIRMED findings

| # | Finding | Evidence |
|---|---------|----------|
| C1 | **70s root cause = `videos.list` no-timeout fetch** | Only unbounded path in the executor. `videosBatchFullMetadata` called with **no `timeoutMs`** (`executor.ts:160`); `videosBatchFullSingle` fetch has **no abort signal** (`youtube-client.ts:482`). Search + LLM are both provably bounded (C2/C3). 16.5s run with picks=25/batches=5 (LLM healthy) ⇒ ~9s unattributed = videos.list. |
| C2 | **Serial-query is NOT the cause** | Fanout is parallel `Promise.allSettled` (`youtube-fanout.ts:92`) with per-call `timeoutMs=2000` (`:99`). Measured `tier2.search.list` avg 525ms, max 1.1s (n=293). |
| C3 | **LLM pick is NOT the cause** | External abort fires at `pickerCfg.timeoutMs=5000` (`executor.ts:110`) and is correctly wired into the OpenRouter fetch (`openrouter.ts:66-74` addEventListener→controller.abort). Provider has its own `REQUEST_TIMEOUT_MS=120_000` (`openrouter.ts:15`) but the 5s external abort pre-empts it. No retry loop in the provider. |
| C4 | **Enrich/summary wait is NOT in the synchronous add-cards path** | Cards return immediately (`add-cards.ts:410`); `recordSurfacedCards` is fire-and-forget `void` (`:399`). No `await` on enrichment. |
| C5 | **Quota is NOT the cause; rotation never fires** | `quota_usage` = 6–24 units/day / 10,000 = **0.1–0.2%**. videos.list rotation triggers only on quota error (`youtube-client.ts:457`); with no exhaustion it never rotates. 8 keys vs 6 keys is irrelevant — rotation is moot. |
| C6 | **Cell placement = intended simplification (inherit, not LLM)** | `keyword-builder.ts:79-85`: cellIndex exists "to tag returned videos with a suggested cell, **avoiding the embedding step in the hot path**." `PickResult` has no cellIndex (`types.ts:26-30`). Cell = the sub_goal index of the query that first surfaced the video (`executor.ts:279`, dedup first-wins `youtube-fanout.ts:119`). PR #804 (`241a52ee`) message mentions only "inherits 12s cap", nothing about placement quality. |
| C7 | **"12s cap" is an unenforced comment** | `config.ts:4` claims a 12s target; there is no wall-clock cap in the executor (`executor.ts:68` t0 + `:187` total only). Measured precompute `discover_ms` = 8.6s–136s (median ~25s); `add_cards.end` = p50 12s / avg 33.5s / max 317s (n=26, 7d). |
| C8 | **Wizard and add-cards share one executor** | `runV5ForWizard` (`wizard-adapter.ts:32`) → `runV5Executor`; `/add-cards` also calls `runV5Executor` (`add-cards.ts:276`). A common "pick + place" module fixes both. |
| C9 | **Render jank ("꿀렁") = re-sort on arrival (D1) + skeleton/card height mismatch (D3)** | D1: `useVideoStream.ts:183` `setCards(insertByScoreDesc(...))` (`:241-261` binary insert+splice) shoves existing cards mid-list. (Wizard `useWizardStream.ts:230` appends — no jank there.) D3: `CardSkeleton.tsx` has no summary placeholder vs real card's late-filling summary blockquote (`InsightCardItemV2.tsx:682`). Keys are stable `key={card.id}` (`CardList.tsx:415`) — D4 not a cause. Reconnect preserves cards; `setCards([])` only on mandalaId change (`useVideoStream.ts:75`) — D2 not a cause. |
| C10 | **Central-cell over-concentration is real** | `recommendation_cache` cell0 share (7d): two mandalas at **32% / 37.5%** vs uniform 1/9≈11% (3× over). Core query → cellIndex null → `?? 0` central dump (`wizard-adapter.ts:55`). `distinct_cells` 5–8 (not always 9): niche cells empty while center overloaded. |
| C11 | **Add-cards scope = whole mandala, not a cell** | `add-cards.ts:247-248` (centerGoal + 8 subGoals); single pick call with `cellTopic=centerGoal` (`executor.ts:118`). |

## 2. UNCONFIRMED / 불명

| # | Item | Why unconfirmed | Resolve via |
|---|------|-----------------|-------------|
| U1 | **Content-level cell misplacement rate** (a cell-N video actually belonging to cell-M) | C10 confirms cell-0 *over-concentration* (structural), but not whether non-center cells hold content-mismatched videos. Needs per-card `rich_summary`/title ↔ sub_goal text comparison on a sample. | §6 residual measurement — run **during** cell-placement implementation, not now. |
| U2 | **Abort-induced empty picks (quality loss)** | Structurally possible: a batch slower than 5s returns `[]` (`executor.ts:131`), and the provider cap is 120s. But in the rows that carry pick diagnostics, batches=5 with picks 25–32 = LLM completed, no abort-zeroing observed. The 0-card rounds were `q_ok=0` (search returned nothing), not abort. | Add executor stage timing + abort-event counter (§3 instrumentation), then observe over time. |
| U3 | **Wizard step-3 template branch behavior** (see §7.1) | Not yet code-verified: whether the template path reuses the step-1/2 candidate pool or re-runs search; how well the step-1/2 pool covers template sectors; whether a "top-up search for under-filled cells" path exists. | Read the template-selection path during F3 implementation. |

---

## 3. Detailed diagnosis A–E

### A. YouTube query context — source quality
**Verdict: queries are centerGoal-anchored, NOT bare labels. "label pollution" hypothesis largely refuted.**

- v5 fanout uses `buildRuleBasedQueriesSync` only — **no LLM query** (`runLLMQueries` is separate, not called by v5: `youtube-fanout.ts:71`). v5 queries are 100% deterministic rule-based.
- Input is sub_goal **text**, not a label: `add-cards.ts:248` `subGoals = root.subjects.slice(0, 8)`.
- Query shapes (`keyword-builder.ts`):
  - core (`:142`): `extractCoreKeyphrase(centerGoal)` — centerGoal alone (only this one is unanchored).
  - focus (`:272`): `${center} ${focusTags}` — anchored.
  - level (`:280`): `${center} ${levelKeyword}` — anchored.
  - subgoal (`:298`): `${center} ${extractCoreKeyword(subGoal)}` — anchored + 2-noun condensed sub_goal.
- `extractCoreKeyword` (`:439-470`): sub_goal sentence → stopword strip → first 2 nouns, 10-char cap. The `:290-295` comment records that Issue #543 already fixed "bare sentence concat → cross-domain noise" by introducing condensation + center anchor.
- **Residual risk** (not root cause): (i) the core query is centerGoal-only, so a generic centerGoal yields one unanchored query; (ii) `extractCoreKeyword`'s 10-char cap can over-condense and lose sub_goal specificity. Obvious "모델 개발 → 패션모델" pollution is prevented by the center anchor.

### B. Latency — measured
- `discover_ms` (v5 executor wall-clock, from precompute, 7d): **8.6s – 136s, median ~25s**.
- `add_cards.end` (synchronous endpoint total, 48h–7d): **p50 12s / avg 33.5s / max 317s** (n=26).
- Bounded sub-steps: `tier2.search.list` 525ms avg (n=293); LLM ≤5s (C3); videos.list traced as `tier2.videos.batch` 547ms in some rows but **the v5 executor's own videos.list call is untraced** (`executor.ts` emits no internal recordTrace).
- **Dominant = videos.list no-timeout (C1).** Serial-query / LLM / enrich / quota all cleared (C2–C5).
- **Separate latency source**: `embed.batch` (n=184/7d, avg 8.2s, max 297s) + `pipeline.execute.start` (n=4) come from the **v3 fallback / IKS embedding** path (`iks-scorer/embedding.ts:167`, `v3/executor.ts:265`), reached via `triggerMandalaPostCreationAsync` when precompute misses. Not the v5 add-cards path.

### C. Cell placement inherit
- Intent = simplification (C6). Mechanism = query-index inheritance; core-query videos dump to cell 0 (C10).
- **Structural support for per-cell already exists**: `PickInput.cellTopic` (`types.ts:16`) + the prompt is written for a **single cell** ("Current cell topic", `openrouter-picker.ts:76,85`). Today it is called once with `cellTopic=centerGoal` (`executor.ts:118`). Per-cell = call with `cellTopic=sub_goal_i` (maxParallel already 5). `PickResult` needs a `cellIndex` field, or per-cell calls make it implicit. Interface comment "LLM-driven cell↔video matching" (`types.ts:4`) is currently unfulfilled.

### D. Render jank ("꿀렁")
See C9. Primary = D1 (`insertByScoreDesc` re-sort on arrival). Secondary = D3 (skeleton vs card height). D2/D4 cleared.

### E. Add-cards scope + reuse
- Scope = whole mandala (C11). Shares executor with wizard (C8) ⇒ a common pick+place module applies to both surfaces.

## 4. Boost findings 1–5 (measured)

1. **videos.list necessity**: fills `contentDetails.duration` + `statistics.viewCount` (+status/topicDetails) absent from search.list (`youtube-client.ts:477`); called **post-pick**, ≤30 ids (`executor.ts:160`); consumed only by request filters `minViewCount`/`durationBucket`/`publishedAfter` (`add-cards.ts:296-310`). **Not** pick/cell input ⇒ removable from hot path.
2. **wizard vs add-cards**: both slow, different mechanisms (see B + §5 table). precompute 7d = 5 consumed / 6 done-not-consumed; v3 fallback fired 4×; embed.batch 184×.
3. **LLM abort quality**: in diagnostic rows batches=5, picks 25–32 (LLM healthy). 0-card rounds = `q_ok=0` (search returned 0), not abort. picks→cards drop (e.g. 25→5) = post-pick request filter. Abort-zeroing = U2 (unconfirmed).
4. **quota / rotation**: C5 — quota 0.2%, rotation never fires, key count irrelevant. **Observability gap discovered**: v5 search.list (~800 units/click × 26 calls ≈ 20.8k) is NOT reflected in `quota_usage` (24/day) ⇒ v5 search quota is untracked.
5. **cell-0 over-concentration**: C10 — measured per-mandala cell0 share:

   | mandala | total | cell0 | cell0_pct | distinct cells |
   |---|---|---|---|---|
   | ed72cb10 | 40 | 15 | **37.5%** | 6 |
   | 85336fdf | 25 | 8 | **32%** | 5 |
   | 7f72e5d8 | 52 | 9 | 17.3% | 7 |
   | 2eb4cb1c | 60 | 6 | 10% | 7 |
   | af20e230 | 51 | 3 | 5.9% | 8 |

## 5. Path comparison (which 70s is which)

| Path | Trigger | Mechanism | Measured |
|------|---------|-----------|----------|
| **add-cards** (synchronous) | "카드 추가" button | `runV5Executor` awaited; videos.list no-timeout hang | `add_cards.end` p50 12s / avg 33.5s / max 317s |
| **wizard** (background) | mandala creation | precompute (v5) runs in background; dashboard fills via SSE over the discover window; consume polls ≤6s | `discover_ms` 8.6–136s; consume hit 5/11 |
| **wizard fallback** | precompute miss | `triggerMandalaPostCreationAsync` → v3 pipeline + `ensureMandalaEmbeddings` | `embed.batch` max 297s; `pipeline.execute` n=4 |

## 6. Residual measurement (deferred — run DURING cell-placement implementation)

- **U1 content misplacement rate**: sample 2–3 mandalas; for each card join `recommendation_cache.cell_index` → `video_rich_summaries`/title and compare against that cell's sub_goal text. Classify obvious mismatches. Separate **center-cell (cell 0) misplacement** from non-center cells (cell-0 includes legitimate-central + core-query dumps; cannot be separated without source tagging). **Do not run standalone now** — run alongside the cell-placement change so before/after is measured on the same harness.
- **U2 abort quality**: add an abort-event counter + per-stage timing (see §7 fix F5) and observe over real traffic.

## 7. Fix directions (for implementation handoff 2/2)

| Area | Direction | Rationale |
|------|-----------|-----------|
| **F1 — latency** | Remove `videos.list` from the hot path: return cards from search.list snippet immediately, enrich duration/viewCount **asynchronously**. As a guard, also pass a `timeoutMs` to `videosBatchFullMetadata`. | C1/C5 — videos.list is post-pick only; not pick/cell input. Timeout alone leaves a slow synchronous step; removal is the real fix. **Do not** touch quota (C5). |
| **F2 — 0-card rounds** | Handle search.list `q_ok` variability (retry/backoff or partial-tolerant candidate floor); do not let all-8-reject produce a 0-card response. | Boost 3 — 0-card rounds are `q_ok=0` (source reliability), not exclude accumulation or abort. |
| **F3 — cell placement** | Fold cell assignment into the LLM pick (per-cell `cellTopic=sub_goal_i`, or add `cellIndex` to `PickResult`). Eliminate core-query → cell-0 dump. | C6/C10 + §3.C — interface already cell-shaped; same call, ~0 extra latency. Sequence **after** F1 (don't add LLM work to the hot path while it is still slow). |
| **F4 — post-pick filter** | Reconsider where `minViewCount`/`durationBucket` filters run (they drop picks 25→5 and depend on videos.list metadata). | Boost 3 — filter is a second card-loss source and couples to F1. |
| **F5 — instrumentation** | Add per-stage timing to `runV5Executor` (search / exclude / LLM / videos.list / assemble) + abort-event counter; record v5 search.list units to `quota_usage`. | C7 + U2 + Boost 4 observability gap — executor is currently a black box and v5 quota is untracked. |

## 7.1 Note — wizard step-3 template branch (deferred to F3; UNCONFIRMED, NOT in step-1)

At wizard step 3 the user may choose either (A) an AI-generated mandala or (B) a **template** (3 center-goal-based similarity recommendations). Design implications for the redesign — to be settled **together with F3**, not in step 1:

- The template is a center-goal-based recommendation, so its sectors overlap the step-1/2 candidate pool. **It is not discarded — the pool is reusable.**
- Therefore the template path = a **variant of F3 (LLM cell placement)**: take the *same* candidate pool and have the LLM **re-place** it into the template's sectors (no re-search ⇒ satisfies the 12s gate). Only top-up search for cells the pool cannot fill.
- **Prerequisite**: F1 must first make candidate-pool acquisition asynchronous; that async pool is the precondition for the template's 12s budget.
- **UNCONFIRMED (verify in F3 — see U3)**: whether the current template path reuses the pool or re-runs search; step-1/2 pool coverage of template sectors; presence of any under-filled-cell top-up logic.

> This note is informational only. Step-1 implementation (F5 + F1) does **not** include it.

## 8. Appendix — key facts

- Config defaults (no prod env override): `V5_MAX_QUERIES=8`, `V5_SEARCH_TIMEOUT_MS=2000`, `V5_SEARCH_MAX_RESULTS=25`, `V5_TARGET_PICKS=30`, `V5_DEDUP_HARDCAP=120` (`config.ts:14-20`); picker `LLM_PICKER_MODEL=anthropic/claude-haiku-4.5`, `BATCH_SIZE=12`, `MAX_PARALLEL=5`, `TIMEOUT_MS=5000` (`llm-picker.ts:10-16`).
- OpenRouter provider `REQUEST_TIMEOUT_MS=120_000` (`openrouter.ts:15`).
- YouTube search keys: 8 (`YOUTUBE_API_KEY_SEARCH` + `_2`..`_8`). videos.list = 1 unit/call; search.list = 100 units/call.
- Probes (read-only, kept in repo): `scripts/probes/wizard-latency-decompose.mjs`, `scripts/probes/v5-gap-diagnosis.mjs`. Run via `cat <probe> | bash scripts/ssh-connect.sh "docker exec -i insighta-api node --input-type=module"`.
- Prod flags: `WIZARD_PRECOMPUTE_ENABLED=true`, `PIPELINE_EVENTS_ROUND=2`, `CHATBOT_PROVIDER=qwen-runpod`.
