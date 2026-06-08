# v5 Common Relevance Gate + Specificity Ladder (CP497 design — NOT implemented)

**Status**: DESIGN ONLY. Approved by James 2026-06-06 (CP497). Implementation next session.
**Prerequisite for**: P1.1 pool serving (batch_trend revival), Phase B/C re-entry — pool candidates
MUST NOT be served without this gate (CP494+1 incident precondition, re-confirmed by measurement below).

---

## 1. Problem (single disease, two surfaces)

The CP494+1 (⑤ Phase B) prod incident put unrelated videos (Mario Kart / Osaka travel /
Galaxy Z-Flip) on a "KT cloud lecture" mandala. Root cause — **no relevance judge anywhere**:

- **Pool surface**: tsvector lexical match (`hybrid-rerank.ts` `tokens.join(' | ')`) — one
  shared token = a match. ts_rank ordering only; no relevance floor.
- **Live surface**: `cell_binning` picker bins fanout survivors by query cellIndex with no
  per-candidate judgment — niche cells with sparse supply admit generic backfill
  (measured: c4 "KT cloud × cost" 6/8 unrelated while rich cells stayed clean).

**CP497 measurement (read-only per-cell A/B simulation, real prod queries)** closed the
Phase C question: per-cell tsquery fixes DISTRIBUTION (8/8 cells filled, displacement gone)
but relevance fails on EVERY source combination — `v2_promoted` alone reproduces the incident
pattern (Z-Flip / metta-meditation titles), `+batch_trend` adds generic-token garbage
(decluttering / camper-van / watercolor) and "KT" tsquery-matches KT&G. Verdict:
**not data-bad, not read-method-bad — judge-absent.**

Rejected directions (do NOT revisit — recital required before any work here):
1. ~~centerGoal anchor restoration~~ — CP492 §27/§82: the original disease was center
   EXCESS (9-word broad concat → unsearchable). The fix that works in prod is the LLM
   *melting* the center into short per-cell semantic queries (`V5_QUERY_GEN=llm`).
2. ~~Full LLM picker return~~ — left because of llmMs 5.8–7.7s bottleneck + cell skew.
   `cell_binning` cell assignment stays.

---

## 2. (가) Common relevance gate — `v5/relevance-gate.ts` (new)

### Position (single judge point)
fanout candidates (pool + live merged) → `cell_binning` cell assignment → **GATE** → assemble.
One gate covers both incident surfaces. `cell_binning` itself is untouched (no bottleneck
regression).

### Judgment
`cosineSimilarity(cellAnchorEmb, candidateTitleEmb) >= V5_GATE_COS_MIN`

- **Cell anchor** = that cell's per-cell query text (the LLM already melts centerGoal into
  it — reuse, zero new LLM calls; this is NOT anchor restoration) + subGoal concat.
- **Candidate text** = title (channel name optional, decide at fixture calibration).
- Existing primitives only: `cosineSimilarity` / `cosineToRelevance` / `embedBatch`
  (`src/skills/plugins/iks-scorer/embedding.ts:466/481/132`).

### Embedding cost (hot-path — pre-ship measurement MANDATORY per CLAUDE.md quantitative rule)
- **Pool candidates**: reuse stored `video_pool_embeddings` — zero embed cost. (This gives
  the CP496 "92% unread / 532MB" embeddings their first consumer.)
- **Live candidates**: post-binning picks only (~60) via one `embedBatch` call. Measure ms
  with a perf-probe BEFORE ship; record in PR description.

### Failure-mode asymmetry (James-approved 2026-06-06)
- **Live candidates — fail-open ON GATE OUTAGE ONLY**: if the embedding service is down,
  live serves ungated (live is semantic search output = today's quality, safe).
  **When the gate is healthy, live candidates ARE subject to the cos floor** — this is what
  closes the c4 niche-backfill garbage case (which occurs with embeddings alive). The two
  states are distinct and must not be conflated:
  | Gate state | Pool candidates | Live candidates |
  |---|---|---|
  | healthy | floor applied | **floor applied** |
  | down (embed outage/timeout) | **fail-closed (not served)** | fail-open (served ungated) |
- **Pool candidates — fail-closed always**: unjudged pool serving IS the incident
  definition. No gate → no pool.

### LLM-judge (scoped, not a picker return)
Only for niche cells where backfill triggered (per-query rawCount below the ladder cliff):
one batched Haiku call judging the gate-passing candidates of those cells. Rich cells never
pay LLM latency.

### Calibration fixtures (precede the gate PR; floor value comes from measurement, not guess)
1. Incident contamination titles (Z-Flip / metta meditation / Mario Kart) → MUST drop.
2. Relevant English (e.g. "AWS Savings Plans explained" on a cost cell) → MUST pass
   (English ≠ garbage; the axis is relevance, not language).
3. 케이티 ↔ KT transliteration pair → MUST land on the same side of the floor.

### Flags / observability
- `V5_RELEVANCE_GATE` (default off), `V5_GATE_COS_MIN` (set from fixtures),
  `V5_GATE_LLM_JUDGE` (default off).
- Trace: `v5_gate { evaluated, dropped, byCell, gateMs, failMode }`.

---

## 3. (나) Specificity ladder (3 rungs; gate judges every rung's output)

1. **Rung 1**: queries MUST melt center identifying keywords (proper nouns / brand) — same
   work as §4 prompt fix.
2. **Rung 2**: per-query `rawCount < V5_LADDER_CLIFF` (default 8, confirm by measurement) →
   ONE regulated generalization re-query (drop identifying keyword, keep concept) +
   `generalized=true` card/cell meta → FE "범용" badge (separate FE PR). Generalized
   candidates still pass the gate (anchor swaps to the generalized query; the center cos
   floor stays to block off-topic drift).
3. **Rung 3**: still short → honest empty cell (`cellSupplyStatus` in the response; silent
   backfill prohibited).

### Rung-3 ↔ cell-skip interaction (James addition #2)
An honest-empty cell stays below the cell-skip threshold forever, so every add-cards round
re-searches it live — a quota loop. **Decision: cache the empty verdict with a TTL** —
`V5_EMPTY_CELL_TTL_H` (default 24h, tune by measurement): within TTL the cell is skipped
like a full cell (supply-empty marker, surfaced in `cellSupplyStatus`); after TTL it retries
(niche supply does appear over time — intent "keep trying niches" is preserved, just not on
every click). TTL=0 restores always-retry.

---

## 4. (다) Vendor prompt fix — `src/prompts/mandala-with-queries-generator.ts:56`

`"{목표 핵심어 1~2개}"` allows proper-noun loss (measured: only c0 kept "KT", the rest got
generic "클라우드" = AWS impersonating KT; tsvector side: "KT" matched KT&G). Replace with:
center's **identifying keywords (brand/product/proper noun) 1–2** melted semantically into
every query; copying the whole center phrase verbatim is prohibited (that is the rejected
CP492 broad-concat trap). Add ONE few-shot example = yesterday's measured 8/8-pass query
("KT 클라우드 리소스 비용 관리 팁").

## 5. (라) Label fix — same file `:51`

Current "max 10 chars" cuts mid-word ("KT클라우드 비용최"). Add one rule line: no mid-word
cuts — pick a shorter word if needed. Ships in the same PR as §4.

---

## 6. Implementation order (next session — agreed)

1. §4 + §5 prompt PR (low risk).
2. §2 gate PR — fixtures first, perf-probe ms before ship, `V5_RELEVANCE_GATE` off-default.
3. §3 ladder PR (includes rung-3 TTL).
4. Only then: P1.1 pool-serving canary (`V5_POOL_*` re-enable behind the gate) — dependency
   confirmed by CP497 measurement, not optional.

## 7. Accounting hook (⑥)

batch_trend admissible inventory = 14,130 rows (gold 7,126 + silver 7,004; bronze 6,319 is
already tier-gated out). Pool substitution saves 100u per pool-satisfied cell — counted in
the quota-increase application as "post-gate potential savings", separate from the shipped
cell-skip savings (801u → 301u measured, −62.4% on a 5-full-cell click; fleet average 0.75
full cells/mandala and monotonically growing).
