# cosine-recruit flag ROI package — 26년금융 (2026-07-02)

> Materials only — the flag-on decision is James's gate (`V5_POOL_SERVE_COSINE_RECRUIT`,
> PR #1051, merged flag-OFF). Measured by CC under Claude-web supervision (CP509 → this
> session). Method identical to the CP509 benefit map: per-cell cosine top-5 over the
> ACTIVE pool × Haiku `computeCardRelevance` (center + cellGoal, ko).

## Context

Mandala `7f72e5d8` "26년 금융 투자 전문가 되기" (golden-cohort gc 65, borderline).
Direct-collect round 1 (this session): 7 cell-aligned queries → 44 unique → classifyQuality
gate 42 accepted (2 too_long) → `video_pool` (yt_promoted) + Ollama embeddings. YouTube API 0.

Before/after (same measure, cosine top-5 max/median gc per cell): no cell regressed.
- c5 자격증: max 65 → **92**, median 25 → **78** (new videos rank 1/3/4)
- c4 암호화폐: max 72 → 72, median 35 → **72** (new videos rank 4/5/8/9/10)
- c3 대체투자: median 45 → 62
- others unchanged (c2 92 / c7 78 / c0 72 / c1 65 / c6 72)
- mandala cell-median aggregate: 58.5 → **72**

## The gap this flag addresses (measured)

gc-good content now EXISTS in the pool for 3 weak cells, but neither serving path picks it up:

| cell | gc-good collected (Haiku) | cosine rank (cell embedding) | tsquery recruit match |
|------|---------------------------|------------------------------|----------------------|
| c1 국내주식 기본·기술분석 | 72 (차트 기초) | 13 | 0 (recruit 8건 전부 뉴스성, 콘텐츠 0) |
| c3 대체투자(부동산·펀드·옵션) | 72, 72 (리츠 입문 ×2) | 40 / 53 | 0 (post-'심화'-fix: honest empty) |
| c6 리스크·포트폴리오 최적화 | **88**, 78 (리스크관리 9가지 / 포트폴리오) | 33 / 39 | 0 |

- Keyword (tsquery) recruit misses them **structurally** (see below), cosine top-5 misses
  them because adjacent-generic finance titles sit closer to the cell embedding.
- A cosine-recruit pass with K beyond top-5 (rank 13–53) + the existing semantic gate
  (`V5_POOL_SERVE_RELEVANCE_MIN=60`) would admit exactly these (all ≥ 72, gate-passing).

## Expected lift if flag-on (this mandala)

- c1: cell median 45 → ~72 range (candidate gc 72)
- c6: cell median 72 → ~88 range (candidate gc 88/78)
- c3: median 62 → ~72 range (candidates gc 72×2)
- No-regression mechanism: gate 60 rejects any cosine-recruited candidate scoring < 60
  (proven fail-closed in CP509 canary: poolPassed=0 on gc<60 supply).

## Safety rails (already in code, PR #1051)

- Cost bound: cosine pass capped (recruit cap in pool-serve-fill cosine branch).
- Accuracy bound: same semantic gate (computeCardRelevance ≥ 60) as keyword recruits —
  cosine proximity alone cannot serve a card.
- Rollback: flag-off (`V5_POOL_SERVE_COSINE_RECRUIT=false`), config-only, no code revert.

## Suggested canary scope (materials, not a recommendation)

Single-mandala canary: enable for `7f72e5d8` only (or lowest-traffic window), then re-run
this same per-cell measure + golden-cohort gc; success = c1/c3/c6 medians move toward the
candidate gc values with zero regression elsewhere; failure = any cell after < before.

## Structural finding (record for G4 scoping as well)

**Colloquial video titles vs. literary cell-goal tokens do not intersect — tsquery recruit
is structurally blind to them.** Cell goals use written-register tokens (기본분석, 기술분석,
대체투자, 최적화); real YouTube learning titles use colloquial phrasing ("차트 보는 법",
"리츠 투자 입문", "리스크 관리하는 9가지 방법"). Keyword OR-match can only bridge this if
the title happens to contain the exact token — embeddings bridge it semantically (the gc-good
candidates above are all cosine-reachable at rank 13–53). Consequences:

1. Collecting more content cannot fix c1/c3/c6 under keyword-only recruit (the gap is the
   matcher, not supply) — re-collecting titles that parrot cell phrasing would game the
   embedding metric and was rejected (GATE-DIAG).
2. The residual W2 noise axis is the mirror image: leftover generic tokens ('심화' — fixed
   in `99ad1305` on branch `fix/w2-tsquery-stopword-simhwa`, 5/5 jest) pull cross-domain
   videos INTO cells; measured c3 recruit noise 2 → 0 after the fix.
3. G4 (serving-quality follow-up) should treat "recruit = lexical, serve-gate = semantic,
   bridge = embeddings" as the baseline architecture fact when scoping re-rank/recall work.

## Evidence trail

- Collection TSV: session scratchpad `fin26.dedup.tsv` (44 rows, 42 accepted).
- Probes (read-only, prod container): per-cell cosine top-5 ×2 (before/after), new-video
  rank probe, real-path tsquery recruit probe (W2 builder from dist), c3 post-fix recruit.
- Scoring: `computeCardRelevance` (Haiku quick, prod path), 40 + 14 + 1 calls.
- Branch: `fix/w2-tsquery-stopword-simhwa` @ `99ad1305` (stopword + test-runner fix).
