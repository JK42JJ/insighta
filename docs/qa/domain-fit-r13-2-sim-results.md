# R13-2 — domain-fit shadow offline simulation results (2026-07-04)

Branch: `feat/domain-fit-shadow` (base `origin/main` @ `1634d9c6`).
Script: `scripts/probes/domain-fit-r13-2-sim.mjs`. Raw output:
`scripts/probes/fixtures/r13-2-results.json`. Local inference only
(Mac Mini Ollama, `mandala-gen:latest`, frozen T3 —
`docs/qa/domain-fit-probe-T3.md`). No Anthropic/OpenRouter/YouTube calls.
No prod data mutation — all reads (`inet_server_addr()` confirmed prod:
`2600:1f13:838:6e23:d95c:dda0:1136:d1c6/128`, db `postgres`).

**238 fresh local-Ollama calls this session** (previous R11/R12 results were
NOT reused/replayed — every number below is a fresh classification).

## Data sources

1. **R12 gold set** (`scripts/probes/fixtures/r12-dataset.json`, 111 rows,
   108 non-ambiguous, real_prod goal/title pairs, gold-labeled). Re-scored
   fresh this session — an independent re-run of the R12 validation, not a
   replay of cached `r12-results-binary.json`.
2. **3 live prod mandalas** (read-only extract, `user_video_states` JOIN
   `youtube_videos`, real served/placed cards — the same 3 mandalas already
   human-judged in `docs/qa/search-quality-report-20260703.md` CP511, so the
   "ground truth" for these is the supervisor's own L1 visual QA pass):
   - `python_normal` — "파이썬 데이터 분석 입문" (`fd080ad1…`), 31 cards.
     CP511 verdict: **0% junk, all normal.**
   - `english_evergreen` — "6개월 내 영어 프리토킹 달성" (`7d5d759e…`), 45
     cards. CP511 verdict: mostly normal, 4-5 mild-clickbait, 0 scam/off-topic.
   - `etf_finance` — "ETF 투자로 노후 자산 만들기" (`5d8eefe0…`), 54 cards.
     CP511 verdict: heavy aggro-clickbait investment-promise junk **+ 1
     confirmed off-topic drift item** ("편집 가능한 PPT 생성 Claude AI").

   Per-candidate score is NOT available for these (only the winning
   `user_video_states` rows are persisted, not the full recruited-and-ranked
   `scored` array) — a synthetic descending proxy score is assigned per cell
   for the rerank arithmetic in (c). This is a known limitation; a follow-up
   with the flag ON would capture the *real* `score` per the R13-1
   `recordTrace` payload and remove this proxy.

## (a) Normal-cell false-not-fit rate — MIXED, one config fails the <10% bar

| Set | legit-known n | classified 비적합 | rate |
|---|---|---|---|
| R12 gold (`legit` clusters: niche_legit/auto_legit/sanity_on/homonym_fit) | 62 | 4 | **6.5%** — passes <10% bar |
| `python_normal` (per-CELL subgoal as the goal text, matching the live executor's `subGoals[cellIndex]`) | 31 | 8 | **25.8%** — FAILS the <10% bar |
| `english_evergreen` (per-cell subgoal) | 45 | 1 | 2.2% — passes |
| `etf_finance` (per-cell subgoal) | 54 | 1 | 1.9% — passes |

**The python_normal miss rate is the important finding.** Inspecting the 8
flagged titles (`r13-2-results.json` → `live.python_normal.rows`), most are
genuine **cell-level topic drift within an overall-legit mandala** — e.g.
cell "Matplotlib과 Seaborn으로 데이터 시각화" flagged "파이썬 코딩 무료
강의(활용편7) - 머신러닝, 영화 추천 시스템" (ML/recsys, not
matplotlib/seaborn) and "클로드의 이 기능" (a Claude-AI productivity video,
not python at all). These are NOT false positives against the *mandala's*
topic — CP511 correctly called the mandala 0% junk — but they ARE genuine
mismatches against the *specific cell* they were placed in. This means:
scoring against the narrow per-cell subgoal (what R13-1's Tier2 hook
actually does, matching the live executor) is measurably stricter than
scoring against a fuller goal statement (what the R12 gold set mostly uses),
and **on this one real mandala it exceeds the <10% false-not-fit bar**.
Two readings, both plausible, not adjudicated here: (i) the classifier is
over-strict at cell granularity, or (ii) some of these candidates are
genuinely cell-misassigned (a placement bug, not a domain-fit bug) and the
classifier is correctly surfacing that. R12's second-opinion number (6.5%,
goal-level) still clears the bar — the discrepancy is a granularity effect,
not a contradiction.

## (b) Drift-detection — catches both the synthetic gold set AND a real, previously-known drift item

- **R12 gold set** (46 genuine cross-domain mismatch pairs): **43/46 = 93.5%**
  caught (consistent with R12's previously published 95.5%, N=22 — this run
  used the larger N=46 drift set across all 4 drift clusters, small
  re-run variance expected from temperature=0.1, not exactly 0).
- **Live spot-check — 2/2 genuine known real-world drift items caught**:
  - `english_evergreen` cell 4 ("문법 기초 정리 및 자동화된 사용") flagged
    "캡컷 자동화!! AI로 캡컷 편집 자동화 하는 방법" (CapCut video-editing
    automation — lexically overlaps on "자동화" but is genuinely off-topic;
    correctly caught, a real homonym-style trap resolved correctly).
  - `etf_finance` cell 4 ("세금 효율적인 투자 방법 학습하기") flagged "클로드
    PPT 만들기: 편집 가능한 파워포인트 자동 생성" — **this is the exact
    off-topic card CP511's own human QA already flagged** in
    `search-quality-report-20260703.md` M4 ("Claude AI PPT 생성 = ETF
    만다라에 드리프트"). The shadow classifier independently reproduced a
    supervisor-verified real drift call, at cell level, zero false negatives
    in this small sample.

## (c) Rerank-multiplier balance (0.15 / 0.2 / 0.3) — LOW CONFIDENCE, proxy-score artifact

| Set | 0.15 rank_change_rate | 0.2 | 0.3 | legit pushed down (any m) |
|---|---|---|---|---|
| python_normal | 22.6% | 22.6% | 22.6% | 0 |
| english_evergreen | 11.1% | 17.8% | 17.8% | 0 |
| etf_finance | 0% | 3.7% | 3.7% | 0 |

Two honest caveats, not glossed over:
1. **0.2 and 0.3 are identical in 2/3 sets, and identical to 0.15 in the
   third.** With only a handful of candidates per cell (≤8) and a synthetic
   proxy score, a demoted candidate's new score drops below every neighbor
   at the *smallest* tested multiplier already — the sim has no room to show
   a 0.15 vs 0.3 gradient with this proxy. This is a limitation of the
   synthetic score, not evidence that 0.15/0.2/0.3 are equivalent in the real
   pipeline (where scores are continuous mandala-filter cosine/jaccard
   values, not a coarse 20-step proxy).
2. **"legit pushed down by a neighbor's demotion" = 0 in every cell/multiplier
   combo tested.** Read literally this says demoting not-fit candidates never
   collaterally hurts a legit neighbor in THIS sample — but given caveat 1,
   this is more likely an artifact of small per-cell N + the proxy score
   than a real property of the rerank. **Do not use this row as a go/no-go
   signal without redoing this measurement using REAL captured `score`
   values from the R13-1 shadow logs** (flip `DOMAIN_FIT_SHADOW=true` in a
   canary, let `recordTrace` accumulate `domain_fit_shadow.tier2` rows with
   the actual mandala-filter score per candidate, replay THAT distribution).

## (d) Load — confirms why this MUST stay async (matches an existing prod scar)

- 238 total calls, mean **1988ms**, p95 **3075ms**, max **4227ms**, single
  Mac Mini instance, concurrency=4.
- At the shipped `DOMAIN_FIT_SHADOW_MAX_CANDIDATES=40` default and
  `DOMAIN_FIT_SHADOW_CONCURRENCY=4`, one Tier-2 shadow run is ≈10 batches ×
  ~2s ≈ **20s** wall time for the local Ollama pass alone.
- This is the *exact same* Mac Mini Ollama dependency that
  `wizard-precompute.ts:124` already documents as the reason v3's cosine
  gate was moved off the sync wizard path in CP490 ("v3 cosine + Mac-mini
  Ollama dependency was producing 70s+ runs returning 0 cards"). R13-1's
  fire-and-forget design (never awaited by the caller, `recordTrace` write
  happens after the full local batch, off the serve path) is load-bearing,
  not a nice-to-have — a sync integration of this exact classifier would
  reproduce the same prior incident.

## Bottom line for James's enforce decision (not made here — shadow/logging only)

- Drift-catch: strong evidence (93.5% synthetic + 2/2 real spot-check,
  including one supervisor-verified real card).
- Normal-cell false-not-fit: passes at goal-level granularity (6.5%), **fails
  at the cell-level granularity the live pipeline actually uses** (25.8% on
  one real mandala) — this is the blocking question for any future enforce
  step, not yet resolved by this simulation.
- Multiplier choice (0.15 vs 0.2 vs 0.3): no usable signal from this
  simulation (proxy-score ceiling effect) — needs a real-score re-run.
- Load: safe only as async/shadow; would reproduce a known past incident if
  ever moved onto the sync serve path.
