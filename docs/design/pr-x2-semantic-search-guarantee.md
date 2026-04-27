# PR X2 — Semantic Search Guarantee

> Date: 2026-04-28
> Issue: #543 (Round 2 PR train)
> Status: spec — pending PR X1 deploy verification before code work

## §0 Mission

Guarantee semantic search accuracy after PR #544 raised `HARD_SIMILARITY_FLOOR` to 0.4. Validate that the current Qwen3-Embedding-8B model produces ≥ 80% top-3 hit rate on a 13-domain ground-truth set; if it does not, evaluate model swap or hybrid FTS boost.

**Don't touch**:
- The `searchMandalasByGoal` SQL query shape (PR #544's domain — only the floor + threshold are tunable).
- The `recommendation_cache` schema (PR #545's domain).
- D&D, mandala generation, video-discover skill internals.

## §1 Decision tree

```
        ┌─────────────────────────────────────────┐
        │ Wait for PR X1 prod deploy (this PR's   │
        │ blocker)                                │
        └──────────────────┬──────────────────────┘
                           │
                           ▼
   ┌────────────────────────────────────────────────┐
   │ User runs §4 manual smoke (13 queries)         │
   └─────────────────┬──────────────────────────────┘
                     │
       ┌─────────────┴─────────────┐
       │ top-3 hit ≥ 80%?          │
       └──────┬───────────┬────────┘
              │ Yes       │ No
              ▼           ▼
    ┌──────────────┐  ┌──────────────────────────────────┐
    │ X2 = no-op,  │  │ X2.1: Hybrid FTS pre-boost       │
    │ close PR X2  │  │   (cheap, model-agnostic)        │
    │ as RESOLVED  │  └──────────┬───────────────────────┘
    └──────────────┘             │
                                 ▼
                ┌─────────────────────────────────────┐
                │ Re-measure → still < 80%?           │
                └──────────┬──────────────────────────┘
                           │ Yes only
                           ▼
                ┌─────────────────────────────────────┐
                │ X2.2: BGE-M3 swap (expensive)       │
                │   - re-embed 1306 templates         │
                │   - dim mismatch (4096 → 1024) →    │
                │     migration plan                  │
                └─────────────────────────────────────┘
```

## §2 Ground truth — 13 domains

See `docs/reports/issue-543/ground-truth-13.json`.

Coverage check on prod `mandala_embeddings`:

| Domain | Query | Found template? |
|--------|-------|-----------------|
| 수학 / 음악 / 운동 / 프로그래밍 / 요리 / 영어 | … | ✓ all 13 mapped |
| 창업 / 투자 / 글쓰기 / 디자인 / 멘토링 / 일본어 / 건강 | … | ✓ |

13/13 ground-truth templates identified with their `expected_mandala_id`.

## §3 Baseline measurement (pre-X2)

See `docs/reports/issue-543/baseline-measurement.md`.

Top-1 proxy hit rate (using expected template's stored embedding as query): **9/13 = 69.2%**.

This proxy method is biased — a real user query like `수학` produces a different embedding than the 60-character expected goal that happens to contain "수학". Direction of bias unknown, so prod manual smoke is required to settle.

## §4 Validation procedure (user manual smoke, prod)

After PR #544 + PR #545 deploy verified green, the user opens the wizard and types each query in `ground-truth-13.json` in sequence. For each, capture the top-5 templates returned in the `template_found` SSE event.

Pass criteria — for at least 11/13 queries (≈ 84%), the response includes at least one of:
- the `expected_mandala_id`, OR
- a template whose `center_goal` semantically matches the same domain (e.g. for `수학`, any 수학-mentioning template is accepted)

If 11+/13 → PR X2 closed as a no-op success.

## §5 Implementation specs (only if §4 fails)

### §5.1 X2.1 — Hybrid FTS boost (preferred)

**Code change locus**: `src/modules/mandala/search.ts` Step 1 SQL.

Add a `to_tsvector` weight bonus to the cosine similarity score:

```sql
WITH ranked AS (
  SELECT
    mandala_id::text AS mandala_id,
    center_goal,
    -- existing cosine
    1 - (embedding <=> ${embeddingStr}::vector) AS cosine_sim,
    -- new: text-match bonus (0 or 0.1)
    CASE WHEN to_tsvector('simple', center_goal) @@ plainto_tsquery('simple', ${goalText})
         THEN 0.1 ELSE 0 END AS text_bonus,
    ROW_NUMBER() OVER (...) AS rn
  FROM mandala_embeddings
  WHERE ${where}
)
SELECT *, (cosine_sim + text_bonus) AS score
FROM ranked
WHERE rn = 1
ORDER BY score DESC
LIMIT ${limit}
```

- No new index required (FTS evaluates inline; `tsvector` cost is O(n) over filtered rows ≈ 16 at floor 0.4 → negligible).
- Bonus tuning: 0.1 keeps cosine signal dominant while breaking ties in favour of literal-keyword matches.
- Backward-compat: existing callers see only an additive score change; threshold/floor unchanged.

### §5.2 X2.2 — BGE-M3 swap (expensive, last resort)

Only if §5.1 still misses pass criteria. Out-of-scope for first iteration; spec stub:

- Replace Qwen3-Embedding-8B (4096d) with BGE-M3 (1024d).
- Migration: new `mandala_embeddings_v2` table, dual-write during cutover, batch backfill 1306 rows via Mac Mini Ollama (BGE-M3 model).
- `MANDALA_EMBED_DIMENSION` env: 4096 → 1024.
- Roll back via `MANDALA_EMBED_PROVIDER` flag.
- Estimated wall: 2-3 sessions (re-embed batch + dim mismatch handling + dual-read window).

## §6 Hard Rule compliance

- LLM API calls (CLAUDE.md ban): the §4 validation runs through prod service path (user-typed query → prod backend → service-permitted OpenRouter embed). Our scripts do **not** call OpenRouter directly. Proxy measurements in §3 use only stored embeddings.
- DB work order: any §5.2 schema change goes local-first via `prisma db push` + raw DDL parallel (per LEVEL-3 silent-fail rule), then CI deploy.
- `.env` immutable: any new tuning knob (e.g. `SEARCH_TEXT_BONUS`) added via runtime config or `docker-compose.yml`, never via `.env` edit.

## §7 Test plan

- Unit: extend `tests/unit/modules/search-threshold.test.ts` with hybrid score test (mock cosine + text_bonus).
- Smoke: extend `frontend/src/__tests__/smoke/use-wizard-stream.test.ts` to assert `template_found` `templates.length >= 1` for `수학` query against a fixture corpus.
- Regression: full backend jest suite — pre-stash baseline 19 fail / 385 pass must hold.
