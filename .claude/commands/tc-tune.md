---
name: tc-tune
description: "Run a video-discover TC round (10 mandalas ko5+en5) against dev or prod and compare with the previous round. Use for iterative tuning of mandala-filter / keyword-builder / shorts / cache."
allowed-tools: Bash(npx:*), Bash(ssh:*), Bash(docker:*), Bash(scp:*), Bash(rm:*), Bash(cp:*), Bash(git:*), Bash(grep:*), Bash(cat:*), Bash(wc:*), Bash(python3:*), Read, Write, Edit
---

# /tc-tune — Video-Discover TC round runner + diff

Runs a fixed 10-mandala TC round (ko5 + en5, AI-custom generation) against **dev** or **prod**, captures per-stage debug, and diffs against the most recent round in the same env. Purpose: iterative tuning (filter thresholds, query strategy, prompt, cache, async) with measurable deltas.

## Inputs

Parse `$ARGUMENTS`:

- `--env dev|prod`            — target (required)
- `--round N`                 — round label (default: auto-increment from reports/ ).
- `--note "short string"`    — attached to report front-matter (e.g. "lower MIN_SUB_RELEVANCE=0.1").
- `--keep`                    — do NOT cleanup mandalas after measurement (default: cleanup via SQL DELETE on `[tc-<env>-<ts>]` suffix).
- `--skip-cleanup-check`      — bypass pre-run check that requires 0 existing tc-labeled mandalas.

## Execution order

### Step 0 — Pre-run safety

1. Verify branch state: `git status --short`; **abort if not on main** (unless `--allow-branch` passed).
2. Verify CI/deploy: `gh pr list --state open --search "review-requested"` — warn if queue is hot.
3. Verify no residual tc mandalas (per env):
   - Dev: `docker exec supabase-db-dev psql -U supabase_admin -d postgres -c "SELECT COUNT(*) FROM public.user_mandalas WHERE title LIKE '% [tc-dev-%]';"`
   - Prod: run via `ssh insighta-ec2 docker exec insighta-api node -e "..."` — read-only count.
   - Abort if > 0 unless `--skip-cleanup-check`.

### Step 1 — Quota pre-check (prod only)

For each of primary / _2 / _3 YouTube keys, call `search.list?q=_probe&maxResults=1`. Count how many return 200. Log the number into the report header.

- If **all keys 403 quotaExceeded** → warn & ask user to continue (wait for daily reset).

### Step 2 — Run TC

- **Dev**:
  ```bash
  VIDEO_DISCOVER_V3=1 ENV_LABEL=dev USER_EMAIL=jamesjk4242@gmail.com \
  DIRECT_URL=<local supabase :5432> DATABASE_URL=<same> \
  YOUTUBE_API_KEY_SEARCH=<dev key from .env or provided> \
  OPENROUTER_API_KEY=<from .env> OPENROUTER_MODEL=<from .env> \
  LLM_PROVIDER=openrouter \
  npx tsx scripts/video-discover-tc/run-tc.ts
  ```
- **Prod**: run inside prod container via SSH (never extract secrets):
  ```bash
  # Ensure /app/prod-tc.js is in sync with scripts/video-discover-tc/run-tc.ts (JS-compiled mirror).
  scp scripts/video-discover-tc/prod-tc.js insighta-ec2:/tmp/
  ssh insighta-ec2 'docker cp /tmp/prod-tc.js insighta-api:/app/prod-tc.js && \
    docker exec insighta-api sh -c "VIDEO_DISCOVER_V3=1 ENV_LABEL=prod USER_EMAIL=jamesjk4242@gmail.com node /app/prod-tc.js" && \
    docker exec insighta-api cat /app/tmp-tc-reports/*.json > /tmp/prod-tc-report.json && \
    docker exec insighta-api rm -f /app/prod-tc.js && rm -f /tmp/prod-tc.js'
  scp insighta-ec2:/tmp/prod-tc-report.json reports/video-discover-tc/<ts>-prod-round<N>.json
  ```

- Each mandala waits 2s between runs (rate-limit friendly).

### Step 3 — Measure + compare

1. Parse latest `reports/video-discover-tc/*-<env>.json`.
2. Find the previous round in the same env (second-latest file).
3. Compute diff per mandala:
   - `recCount`: prev → now
   - `timings.aiGenerateMs`, `createMandalaMs`, `step1Ms`, `step2Ms`, `step3Ms`
   - `step2Result.debug.perQueryCounts` aggregate: total YouTube results, errors, quota-403 count
   - `step2Result.debug.mandalaFilterDroppedCenterGate` / `mandalaFilterDroppedJaccard`

### Step 4 — Cleanup (unless --keep)

- Dev: `docker exec supabase-db-dev psql ... DELETE FROM user_mandalas WHERE title LIKE '% [tc-dev-%]'`
- Prod: via container psql with same WHERE clause.

### Step 5 — Append to rounds log

Append a row to `reports/video-discover-tc/rounds.md`:

```
| round | env  | ts | note | success/10 | avg_rec | avg_createMs | avg_step2Ms | quota403 | delta_rec vs prev |
```

## Output format

```
## /tc-tune — env=<dev|prod>  round=<N>  note="<note>"

### Pre-run
- Keys available: primary=<y/n>  _2=<y/n>  _3=<y/n>
- Residual mandalas: <0|count>

### Results (10/10 completed? list fails)
| # | title | lang | rec | create_ms | step2_ms | quota_403 | status |

### Delta vs round <N-1> (<env>)
| # | Δrec | Δcreate_ms | Δstep2_ms | note |
(omit if no previous)

### Aggregate
- success ratio: n/10
- avg_rec: <n>  (Δ <±n>)
- avg_createMandala: <ms>  (Δ <±ms>)
- avg_step2: <ms>
- quota_403 events: <n>

### Cleanup
- <deleted N mandalas | --keep: retained>

### Report files
- JSON: reports/video-discover-tc/<ts>-<env>-round<N>.json
- Appended: reports/video-discover-tc/rounds.md
```

## Hard rules

1. **Never extract prod secrets to local**. Run prod TC inside the prod container only (via docker exec).
2. **Quota-safe**: if pre-check shows 0/3 keys healthy, abort with clear message (do not waste compute on known-failing).
3. **Cleanup by default**: every round leaves the DB clean unless `--keep` is passed.
4. **Branch guard**: only run on `main` (or explicitly allowed branches via `--allow-branch`) so measured code reflects deployed code.

## Hook candidate (future)

Wire a PostToolUse hook on `gh pr merge` completion that triggers `/tc-tune --env prod --note "post-#<pr>-auto"` five minutes after a deploy completes. Not in v1.
