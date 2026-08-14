# R14 — goal-level rescope + WRITE-gate feasibility (2026-07-04)

Branch: `feat/domain-fit-shadow`. Commits this session: `a1e36f16` (R14-1
code), plus this doc (R14-2/3/4, analysis + read-only sim, no code change).
blast-0 held: branch-only, enforce-0, flag-off default, async, unpushed,
local Ollama only, zero external API, zero real data mutation, read-only sim.

## R14-1 — goal-level rescope + scalar capture (code, committed `a1e36f16`)

- `src/modules/domain-fit-shadow/shadow.ts` — classification target changed
  from `input.subGoals[c.cellIndex] ?? input.centerGoal` (R13) to always
  `input.centerGoal` (R14-1). `subGoals` kept on the interface (deprecated,
  unused for classification) so `src/skills/plugins/video-discover/v3/executor.ts:517`
  and `:1300` (the two `scheduleDomainFitShadow(...)` call sites) needed no
  signature change.
- `src/modules/domain-fit-shadow/client.ts` — added `buildT3ScalarPrompt` /
  `parseFitScalar` / `classifyDomainFitScalar`, verbatim frozen "R12
  scalar-capture variant" from `docs/qa/domain-fit-probe-T3.md`. Additive,
  gated by new `DOMAIN_FIT_SHADOW_SCALAR` (default false) — a SEPARATE
  Ollama call per candidate, never substitutes the binary T3 call.
- Real score logging unchanged from R13-1 and still real: `ShadowScoredCandidate.score`
  is the actual `applyMandalaFilterWithStats` (or Tier-1 match) score, never
  a synthetic proxy — R13-2's proxy problem was specific to the OFFLINE SIM
  reading `user_video_states` (only winners persisted, no per-candidate
  score), not a gap in what R13-1's live shadow hook logs.
- `tsc --noEmit`: clean. Jest: 39/39 domain-fit-shadow tests pass (goal-level
  assertions replace the old per-cell assertions; new scalar-capture
  coverage). Broader `src/skills/plugins/video-discover` suite: 314 passed,
  1 pre-existing unrelated failure (`trace-candidates.test.ts`, confirmed via
  `git diff --stat` untouched by this branch).

## R14-3 — v3 shadow re-run at goal-level (副측정) — MIXED result, reported as measured, not spun

Re-scored the SAME 130 real served-card titles from R13-2 (3 real prod
mandalas, read-only, no new query) against each mandala's root `centerGoal`
instead of the per-cell subgoal. Script: `scripts/probes/domain-fit-r14-3-goal-level-sim.mjs`
(gitignored per repo convention, matches R11/12/13 precedent). Raw output:
`scripts/probes/fixtures/r14-3-goal-level-results.json`.

| Mandala | Cell-level (R13, per-cell subgoal) | Goal-level (R14, centerGoal) |
|---|---|---|
| python_normal (fd080ad1…) | 8/31 = 25.8% | **8/31 = 25.8% — unchanged** |
| english_evergreen (7d5d759e…) | 1/45 = 2.2% | **10/45 = 22.2% — WORSE** |
| etf_finance (5d8eefe0…) | 1/54 = 1.9% | 1/54 = 1.9% — unchanged |

**This does not confirm the "goal-level fixes the 25.8%" hypothesis from the
R13-2 write-up on these 2 real mandalas.** Digging into which titles moved:

- python_normal: composition changed but the total stayed 8. 2 titles that
  were false positives at cell-level are now correctly passed at goal-level
  ("커서AI 설치부터…", "머신러닝, 영화 추천 시스템 만들기" — genuinely
  Python/data-adjacent, just not literally about the specific cell's
  narrow topic). But 2 NEW candidates get flagged at goal-level that
  weren't before, one of which looks like a genuine real quality issue
  independent of domain-fit accuracy — a KBS political/real-estate-tax news
  broadcast ("[사사건건] 이 대통령, 보유세 강화 의지…") is present in this
  Python-learning mandala's served set at all, which is arguably a **real
  pool/recommendation bug** the domain-fit shadow correctly surfaces,
  goal-level or not.
- english_evergreen: goal-level got WORSE, not better. Root cause: this
  mandala's cell 6/7 goals ("자신감 있게 말하기 위한 심리 트레이닝", "매일
  꾸준히 실천할 수 있는 루틴 설계") are generic self-help/habit topics that
  are legitimately on-topic for THEIR OWN cell but read as off-domain when
  compared to the narrower root goal "6개월 내 영어 프리토킹 달성" — e.g. a
  general "12개의 데일리 루틴" (habit-building) video or a Yale psychiatry
  professor's anxiety talk are reasonable for a "confidence/routine" cell
  but score 비적합 against "achieve English free-talking in 6 months" read
  literally. Goal-level is STRICTER here specifically because some cells are
  intentionally more general than the root goal.

**Honest conclusion**: cell-level vs goal-level is not a strict
better/worse — it is a **granularity tradeoff**. Cell-level over-flags when
a cell's own narrow theme diverges from the video's actual (still
mandala-legit) sub-topic. Goal-level over-flags when a cell is intentionally
broader/softer than the root goal (self-help/routine/confidence cells
attached to a skill-acquisition root goal). Neither alone clears the <10%
bar on these 2 real mandalas; the R12 gold set's 6.5% is a cleaner number
because that dataset was constructed as single-granularity goal/title pairs,
not an 8-cell decomposed real mandala with intentionally-softer cells.
**This is flagged as an open design question for James, not resolved by
this session's code change** — R14-1 shipped goal-level as instructed, but
this measurement shows it is a genuinely open tradeoff, not a fix.

## R14-2 — WRITE-gate wireability (핵심) + offline sim

### File:line — same signal share point as the serve-side shadow hook

Two **goal-aware** write paths (a specific mandala's `centerGoal` is in
scope at write time — directly wireable to a domain-fit gate, same
fire-and-forget/async shape already used for the serve-side shadow hook):

1. **`src/modules/video-pool/reuse-from-v5.ts`** — `prepareReuseRow` (pure,
   sync, lines 99-148) quality-gates via `classifyQuality` (line 106) before
   building the upsert row; `reusePickedToPool` (lines 154-189) is already
   `async`, loops per-card, and calls `prisma.video_pool.upsert` at line 174.
   Call site: `src/skills/plugins/video-discover/v5/executor.ts:397`
   (`void reusePickedToPool({...}).catch(...)`) — **never awaited**
   (comment at line 394: "NEVER awaited → zero hot-path impact"), and
   `input.centerGoal` is already in the enclosing function's scope (used
   elsewhere at lines 166/265/266) but is **not currently passed into
   `ReuseInput`** — adding it is a 1-field interface change, not a
   restructure. A domain-fit call would slot in per-card inside the existing
   `for (const card of input.cards)` loop (line 160), right after
   `prepareReuseRow` returns a non-null row and before the `upsert` — same
   position as `classifyQuality`, same async/per-card shape already proven
   safe (this loop already awaits `shortGateFields` per card at line 162).

2. **`src/api/routes/cards.ts:508-591`** (`/like` handler's fire-and-forget
   IIFE, `void (async () => {...})()` at line 508) — already gates on
   `titleHitsBlocklist` (line 546) and `isChannelBlocked` (line 553) before
   `prisma.video_pool.upsert` (line 560), source=`'user_curated'`.
   `body.mandalaId` is already available in this handler (used at lines 324,
   330, 340, 351, 356, 487) — a domain-fit gate would need one extra lookup
   (mandala's root `center_goal`, not currently fetched here) then slot in
   right after the existing blocklist checks, same position, same
   async/non-blocking shape (this IIFE is already `void`-dispatched, response
   already sent by the time it runs — see the `return reply.code(202)` at
   line 593, AFTER the IIFE is scheduled but not awaited).

One **goal-agnostic** batch family — **NOT directly wireable to a per-write
domain-fit-vs-goal gate**, because there is no specific mandala/goal at
ingestion time (this is the structural reason R14-4's video-intrinsic
caching idea matters, not just a nice-to-have):

3. `src/modules/video-pool/promote-from-v2.ts` (`promoteV2ToVideoPool`, line
   108; upsert at line 221), `promote-from-playlists.ts` (`promotePlaylistsToVideoPool`,
   line 82; upsert at line 232), `promote-from-youtube-videos.ts`
   (`promoteYoutubeVideosToPool`, line 112; `classifyQuality` at line 166;
   upsert at line 236) — all three are cron/batch collectors that promote
   into the SHARED, mandala-agnostic `video_pool` table with no requesting
   mandala in scope. A fit-vs-one-goal gate cannot run here; only a
   **video-intrinsic domain LABEL** (title/description → topic, no goal
   input) could gate at this stage — confirmed feasible in principle (R14-4),
   not implemented this session (would need a new `video_pool` column, DDL=0
   this session).

### Offline sim — (a) off-domain block rate, (b) normal-domain false-block rate

No code wired this session (read-only sim only, per R14-2 scope: "형태 검증"
+ "오프라인 시뮬", not an implementation).

- **(a) off-domain block rate — two independent measurements, both strong**:
  - R12 gold set (reused from R13-2, not re-scored): 46 genuine cross-domain
    real_prod pairs, **43/46 = 93.5%** correctly blocked (비적합).
  - **New this session** — genuine cross-mandala supplementary check
    (`scripts/probes/domain-fit-r14-2-write-gate-sim.mjs`, 24 fresh calls):
    took real titles from one live mandala's served cards and paired them
    against a DIFFERENT real mandala's actual `centerGoal` (python titles ×
    ETF goal, ETF titles × python goal, English titles × ETF goal) —
    **24/24 = 100% blocked**. Blatant cross-domain mismatches are caught
    every time; the R12 gold set's harder homonym/niche-drift cases bring
    the rate down to 93.5%, still well above any reasonable bar.
- **(b) normal-domain false-block rate — reuses R14-3's numbers directly**
  (identical classification call — a WRITE-gate-vs-goal check is the SAME
  T3 call as the serve-side shadow's goal-level check, just interpreted as
  block/allow instead of demote/keep): **25.8% (python) / 22.2% (english,
  R14-3) / 1.9% (ETF)** — i.e. the SAME mixed result from R14-3 applies
  here. **A WRITE-gate built on goal-level domain-fit today would
  incorrectly block roughly a quarter of legit python-mandala candidates and
  a fifth of legit english-mandala candidates** — well above the <10% bar,
  for the same cell-vs-goal granularity reasons documented in R14-3. This is
  the single biggest reason NOT to wire this as an actual gate yet, whatever
  the wireability answer is.

**Bottom line for R14-2**: wireable in the goal-aware paths (file:line
above), NOT wireable as a per-write goal gate in the batch paths (structural,
not a code gap), and — same as R14-3 — **not accurate enough to enforce
today** (false-block rate exceeds the <10% bar on 2 of 3 real mandalas).
"Pool을 도메인-품질풀로" gate is directionally sound against blatant
cross-domain junk (93.5-100%) but would currently reject too much legitimate
content at the cell-adjacent edges.

## R14-4 — load/async verification + video-intrinsic cache feasibility

### Async/hot-path non-blocking — re-verified file:line

- Serve-side shadow (R13-1/R14-1): `scheduleDomainFitShadow(...)` calls at
  `src/skills/plugins/video-discover/v3/executor.ts:517` and `:1300` are
  plain (non-awaited) function calls; internally
  `src/modules/domain-fit-shadow/shadow.ts`'s `scheduleDomainFitShadow`
  dispatches with `void runDomainFitShadow(input, cfg).catch(...)` — the
  caller's stack frame returns immediately, the Ollama burst runs after.
- WRITE-path precedent (unchanged this session, cited for the "same shape"
  claim): `src/skills/plugins/video-discover/v5/executor.ts:397`
  (`void reusePickedToPool(...).catch(...)`) and `src/api/routes/cards.ts:508`
  (`void (async () => {...})()`, response already sent by `reply.code(202)`
  at line 593) — both structurally identical fire-and-forget dispatch.
- Goal-level call unit: ONE `centerGoal` per mandala per shadow run (not per
  cell) — R14-1 reduces the DISTINCT-goal-string count from 8 (one per cell,
  R13) to 1 (R14), but the call COUNT (one call per candidate) is unchanged
  — goal-level does not by itself reduce Ollama load, it only changes what
  text is compared. This matters for the cache-feasibility question below.

### Cache feasibility — YES in principle, with one accuracy caveat; not implemented (DDL=0 this session)

The idea: since goal-level domain-fit compares (mandala centerGoal, video
title), and the SAME popular video gets recruited across MANY different
mandalas/users (this is explicitly `video_pool`'s design — see
`reuse-from-v5.ts` header: "next request's pool-first match reuses them"),
splitting the judgment into (1) a **video-intrinsic domain LABEL** (title →
topic, no goal input, computed once, cacheable forever — a video's own
subject doesn't change) and (2) a **cheap label-vs-goal compare** would let
step (1) be a cache hit for every recruitment after the first.

**This is not a new pattern for this codebase — it is the SAME architecture
already used by the (now-legacy) v3 semantic center gate**: `mandala_embeddings`
(per-mandala, `getCenterGoalEmbedding`) + `video_pool_embeddings`
(per-video, generated at promote-time — see `promote-from-v2.ts` lines
16-18, "Generate embedding via Mac Mini Ollama... INSERT video_pool_embeddings")
+ a cosine-similarity compare (`mandala-filter.ts` `SEMANTIC_MIN_COSINE`).
The domain-fit T3 classifier was built as a MORE ACCURATE alternative to
exactly this pattern, specifically because raw embedding cosine failed the
"niche_legit" cluster (docs/qa/domain-fit-probe-T3.md: T1/T2 substring/jaccard
gates had "niche massacre" — 22-40% false-not-fit-on-legit — and the
"niche_legit" cluster is explicitly "vocabulary-non-overlapping but
domain-true fit", the case a coarse label + cosine compare is weakest at).

**Honest feasibility verdict**: architecturally straightforward (reuses an
existing, already-shipped caching pattern in this same codebase) and would
cut load specifically for videos reused across multiple mandalas (real,
given `video_pool`'s explicit shared-pool design — not measured this session,
would need a video_pool re-recruitment-rate query, out of scope), but:
1. Needs a new persisted field (e.g. `video_pool.domain_label` or a small
   join table) — **DDL, blocked this session** (compliance: real data
   change/DDL = 0). Analysis only, no schema change proposed as code.
2. If the label-vs-goal compare step downgrades to embedding cosine (cheap,
   fully cacheable) instead of an LLM judge, it risks reintroducing the SAME
   niche-vocabulary weakness T3 was built to fix. Recommendation if pursued:
   keep the compare step LLM-based too (label vs goal — much shorter input
   than full title vs goal, so still cheaper per call and still benefits
   from the video-intrinsic label being cached across mandalas), rather than
   downgrading to cosine, to avoid trading accuracy for cost.
3. Savings only materialize on REUSE (2nd+ time a given video is recruited)
   — first-encounter cost per video is unavoidable either way.

Not implemented this session (analysis + feasibility only, per R14-4 scope
"실현성 규명" — establish feasibility, not ship it).

## tsc / jest

- `tsc --noEmit -p .`: clean (R14-1 code change).
- Domain-fit-shadow suite: 39/39 pass (`tests/unit/modules/domain-fit-shadow.test.ts`,
  `tests/unit/modules/domain-fit-shadow-client.test.ts`,
  `tests/unit/config/domain-fit-shadow-config.test.ts`).
- `src/skills/plugins/video-discover` suite: 314 passed / 1 pre-existing
  unrelated failure (`trace-candidates.test.ts`, confirmed untouched by this
  branch via `git diff --stat`).
- enforce-0 / flag-off invariants re-verified by the same tests (no new
  invariant broken by the goal-level rescope or scalar addition).
