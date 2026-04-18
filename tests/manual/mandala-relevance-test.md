# Mandala Card Relevance Test

> **Purpose.** Validate that newly-created mandalas receive topic-relevant
> recommendation cards, and that the 9-axis mandala-filter (PR #398) keeps
> functioning end-to-end under prod traffic.
>
> **Why bother.** The CP385 launch recovery (PR #398 Tier 1 disable + 9-axis
> filter, PR #411 YouTube key rotation) was ship-verified at the time, but
> user manual test **0417010** on 2026-04-17 surfaced a relevance regression
> that no automated path had flagged. This file exists so the same class of
> regression is caught within minutes, not days, on every subsequent
> video-discover / recommendation-cache / Tier 1 change.
>
> **When to re-run.**
>
> - Any change under `src/skills/plugins/video-discover/v3/**`
> - Any change to `recommendation_cache` schema or write path
> - Any prod env-flag toggle (`V3_ENABLE_TIER1_CACHE`, `V3_TARGET_PER_CELL`,
>   `V3_TARGET_TOTAL`, `MAX_QUERIES`)
> - After any `recommendation_cache` purge / bulk delete
> - After YouTube policy tracking updates (shorts threshold, search.list
>   behaviour)
> - **Weekly** as a scheduled drift check (see "Scheduled sampling" below)

---

## How to run the test

Three pieces of evidence are produced each run, and all three must be
stored so later comparisons are possible.

### A. Env-flag snapshot

```bash
# Prod (via SSH or Lightsail session)
docker exec <api-container> printenv | grep -E 'V3_ENABLE_TIER1_CACHE|V3_TARGET|MAX_QUERIES|YOUTUBE_API_KEY_SEARCH'
```

Expected (post-PR #398 baseline):

| Key | Expected | Notes |
|-----|----------|-------|
| `V3_ENABLE_TIER1_CACHE` | unset or `false` | Tier 1 cache disabled by default |
| `V3_TARGET_PER_CELL` | 8 (cap) | PR #400 renamed floor→cap |
| `V3_TARGET_TOTAL` | 64 | PR #400 |
| `MAX_QUERIES` | 12 | PR #400 |
| `YOUTUBE_API_KEY_SEARCH` | set | primary key |
| `YOUTUBE_API_KEY_SEARCH_2` | set | rotation slot 2 (PR #411) |
| `YOUTUBE_API_KEY_SEARCH_3` | set | rotation slot 3 (PR #411) |

Save as `env-<env>-<YYYYMMDDTHHMM>.txt`.

### B. `rec_reason` distribution SQL

```bash
# Use DIRECT_URL (not the pooler) so the read is not rate-limited
psql "$DIRECT_URL" -Aqt -c "
  SELECT rec_reason, count(*)
  FROM recommendation_cache
  WHERE created_at > now() - interval '7 days'
  GROUP BY rec_reason
  ORDER BY count(*) DESC
"
```

Expected (Tier 1 disabled):

- `cache` rows ≤ 1% of total (ideally 0 for the window)
- `tier2-*` / `ai-search` / `rule-search` rows dominate
- Any row with `rec_reason = 'cache'` AND `created_at` within 24h = **red flag**

Save as `rec-reason-<env>-<YYYYMMDDTHHMM>.txt`.

### C. Mandala relevance sampling (user flow)

1. Fresh user account or clean existing test-user session.
2. Create a new mandala with a **specific**, non-generic title
   (e.g. "3개월 내 토익 900 달성", not "공부하기").
3. Wait for wizard → dashboard transition to settle.
4. On the dashboard, for each of the 9 cells (1 center + 8 sub-goals),
   open the first 3 card recommendations and record:
   - Card title
   - Subjective relevance to the cell label: **HIGH / OK / OFF-TOPIC**
5. Cross-check with DB (optional but preferred):

   ```bash
   psql "$DIRECT_URL" -c "
     SELECT mandala_id, cell_position, card_title, rec_reason, rec_score
     FROM recommendation_cache
     WHERE mandala_id = '<new-mandala-id>'
     ORDER BY cell_position, rec_score DESC
   "
   ```

Save as `relevance-<env>-<YYYYMMDDTHHMM>.md` with the table below filled
in. Attach the mandala `id` and user-visible title.

| Cell | Label | Top-3 titles | H/O/OFF |
|------|-------|--------------|---------|

### D. `/tc-tune` automated confirmation (optional but recommended)

```bash
/tc-tune --env prod
```

Compare the generated report with the baseline under
`reports/video-discover-tc/2026-04-17T14-02-18-prod.json`:

- `recCount` per mandala (target: ≥ 8, stretch: ≥ 10)
- `rec_reason` per card
- No quota-cascade 403 (PR #411 should have eliminated these)

Save the new JSON in `reports/video-discover-tc/` — the runner already
does this automatically.

---

## Pass criteria

### LEVEL-0 — Must pass (regression blocks ship)

| # | Check | How to verify |
|---|-------|---------------|
| 1 | `V3_ENABLE_TIER1_CACHE` unset or `false` on prod | Section A env snapshot |
| 2 | `recommendation_cache.rec_reason = 'cache'` < 1% of last 7 days | Section B SQL |
| 3 | No LEVEL-3 CLAUDE.md hard-rule violation on write path | Grep `from('recommendation_cache')` before release |
| 4 | For a freshly-created mandala, at least 1 cell has ≥ 1 HIGH-relevance card | Section C table |
| 5 | No card with obviously cross-user content (e.g. unrelated brand names, spam) | Section C inspection |

### LEVEL-1 — Should pass (quality bar)

| # | Check | How to verify |
|---|-------|---------------|
| 6 | ≥ 5 of 9 cells have at least 1 HIGH-relevance card | Section C table |
| 7 | `/tc-tune --env prod` `recCount` avg ≥ 8 over 10 mandalas | Section D JSON |
| 8 | No 403 quota-cascade in TC run (per PR #411) | Section D JSON → `debug.quotaRotation` |
| 9 | Wizard → dashboard perceived < 3s (once Issue #413 fix ships) | Stopwatch, parallel to this test |

### LEVEL-2 — Aspirational

| # | Check | How to verify |
|---|-------|---------------|
| 10 | ≥ 7 of 9 cells have ≥ 2 HIGH-relevance cards | Section C |
| 11 | OFF-TOPIC rate < 10% across all sampled cards | Section C |
| 12 | Per-cell rec_score monotonically decreasing (top-3 within 0.1 band) | Section C DB query |

### Interpretation matrix

- LEVEL-0 fails → **stop ship / hotfix immediately**. File incident.
- LEVEL-1 fails, LEVEL-0 passes → file Issue referencing this run's
  artifacts. Do not stop ship unless regression is within last 48h.
- LEVEL-2 fails → log in findings, treat as tuning signal for next
  `/tc-tune` cycle.

---

## Findings log

### 2026-04-17 — CP386.5 TC baseline (pre-regression-report)

- Dev: 10/10 mandalas succeeded, rec avg 10.9, total 109
  (`reports/video-discover-tc/2026-04-17T13-37-06-459Z-dev.json`)
- Prod: 6/10 success, KO 5/5 + EN 1/5 — **quota cascade** (resolved
  after PR #411 merge). `createMandalaMs` prod avg 15.3s (→ Issue #413).
- LEVEL-0 verification: not performed at this date; backfilled into
  Issue #414 as diagnostic procedure.

### 2026-04-17 — 0417010 user report (regression trigger)

- User reported ~2–3 relevant of ~8–10 cards for a freshly-created
  mandala.
- Quantitative re-test pending (Issue #414).
- LEVEL-0 / LEVEL-1 status: **unknown** until Section A + B + C
  artefacts are captured post-PR #411 deploy.

### _(next re-run appended here)_

---

## Known gaps / open items

- Section D (`/tc-tune`) does not yet sample `rec_reason` per card in
  its output. Consider adding to `scripts/video-discover-tc/run-tc.ts`
  so Section B and D can be cross-verified from a single artefact.
- No scheduled runner. Candidate: a weekly GitHub Actions job that
  executes `/tc-tune --env prod` + Section B SQL and diffs against the
  latest baseline.
- Subjective HIGH/OK/OFF-TOPIC labelling is human-in-the-loop. A small
  LLM judge (Claude/Gemini with a strict rubric) could automate 60–80%
  of the call. Out of scope until the human baseline stabilises.

---

## Related code (do-not-touch-without-audit list)

Files on the hot path for this test; hard rules apply per CLAUDE.md:

- `src/skills/plugins/video-discover/v3/executor.ts` — `V3_ENABLE_TIER1_CACHE` gate
- `src/skills/plugins/video-discover/v3/mandala-filter.ts` — 9-axis filter
- `src/skills/plugins/video-discover/v3/manifest.ts` — cap constants
- `src/skills/plugins/video-discover/v2/keyword-builder.ts` — `MAX_QUERIES`, sub_goal coverage
- `src/skills/plugins/video-discover/v2/youtube-client.ts` — shorts threshold, key rotation
- `src/api/routes/mandalas.ts` — `/create-with-data` write path
- Any Edge Function under `supabase/functions/` that writes to
  `recommendation_cache` — audit per "Write Path 전수 검토" hard rule

Rollback commands (if a test reveals a mis-set flag in prod):

```bash
# Turn off Tier 1 cache (the canonical post-PR-#398 state)
docker exec <api-container> sh -c 'unset V3_ENABLE_TIER1_CACHE'
# — or, preferred, restart the container with the env var removed
# from the compose file.

# Purge a recent cross-user bleed (only touches recommendation_cache,
# never user_local_cards — per CLAUDE.md Hard Rule "사용자 직접 추가
# 카드 불변").
psql "$DIRECT_URL" -c "
  DELETE FROM recommendation_cache
  WHERE created_at > '<incident-ts>'
    AND rec_reason = 'cache'
"
```

---

## Reference artefacts

- Dev TC baseline: `reports/video-discover-tc/2026-04-17T13-37-06-459Z-dev.json`
- Prod TC baseline: `reports/video-discover-tc/2026-04-17T14-02-18-prod.json`
- PR #398 — 9-axis filter + Tier 1 disable
- PR #400 — cap semantics + pool widening (MAX_QUERIES 12, per-cell cap 8)
- PR #411 — YouTube API key rotation (quota cascade fix)
- Issue #413 — Wizard 30s+ latency
- Issue #414 — Mandala card relevance regression (this test was filed
  together with the Issue)

---

**Last updated:** 2026-04-18
