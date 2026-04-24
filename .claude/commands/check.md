---
name: check
description: "Agent-Native standard verification — quality gate before /ship"
allowed-tools: Bash(npm:*), Bash(npx:*), Bash(git:*), Bash(curl:*), Bash(cd:*), Read, Grep, Glob
---

Quality gate before `/ship`. Checks 5 categories: code quality, API standards, tests, backend verification, documentation.

Usage: `/check [scope?]`
- Omitted: full verification (all 5 categories)
- `--quick`: Hard Gate only (typecheck + lint + build)
- `--api`: API/Edge Function standards only
- `--test`: Test standards only

## Core Principles

> "ran without errors" ≠ "correct" — do NOT assume correctness from build pass alone.
> Hard Gate failure blocks `/ship`. Soft Gate warnings are displayed only.

## Gate Rules

| Type | On failure | Applies to |
|------|------------|------------|
| **Hard Gate** | Blocks /ship, MUST fix and re-run | Category 1 (code quality) |
| **Soft Gate** | /ship allowed, warning list displayed | Categories 2-5 |

## Verification Categories

### 1. Code Quality (Hard Gate — ANY failure blocks /ship)

```bash
# 1a. Backend type check
npx tsc --noEmit

# 1b. Frontend type check
cd frontend && npx tsc --noEmit

# 1c. ESLint
npm run lint

# 1d. Unit tests (if configured)
npm test 2>/dev/null || echo "no tests configured"

# 1e. Vite build
cd frontend && npm run build

# 1f. Hardcode/fragmentation audit
npx tsx scripts/audit/hardcode-audit.ts
```

ALL items MUST pass for Hard Gate PASS. Audit baseline at `reports/hardcode-audit/baseline.json` ratchets down only.

### 2. API/Edge Function Standards (Soft Gate)

Detect API routes or Edge Functions among changed files:
```bash
git diff --name-only HEAD~1 | grep -E '(src/api/|supabase/functions/)'
```

For detected files, check:
- Error responses are structured (`{ status, code, message }` pattern)
- Success responses follow standard format (`{ status, data }` pattern)
- **[G6] Fail Loudly**: business errors (LIMIT_EXCEEDED, NOT_FOUND, ALREADY_EXISTS, etc.) return explicit error codes
- try-catch blocks do NOT silently swallow errors

### 3. Test Standards (Soft Gate)

- Tests exist for changed code (same directory or under `tests/`)
- **[G8] E2E verification**: Playwright tests cover the changed UI
- If `tests/TEST.md` exists, it reflects latest results

### 4. Backend Verification (Soft Gate)

**[G1] Real Backend + [G3] Output Verification**:
- DB schema changes: `npx prisma generate` success + local `npx prisma db push` success confirmed
- Edge Function changes: verify via curl with actual call (dev environment)
- **[G5] Idempotency**: same API call twice produces no side effects
- **[G2] Rendering Gap**: changed fields propagated across full L0-L6 path
  - DB schema (L0) → Edge Function (L1) → Type definition (L2) → Converter (L3) → Hook (L4) → UI (L6)

### 5. Documentation Standards (Soft Gate)

- Whether CLAUDE.md needs updating (if core rules changed)
- Whether commit messages can include related Issue numbers
- Documentation exists for changed Edge Functions/APIs

### 6. Runtime Risk Patterns (Soft Gate — promoted from troubleshooting.md LEVEL-2)

Known repeat-offense patterns. Check changed files for these risks. If any match, require explicit ack before /ship.

**[6a] tsc pass ≠ runtime safe**
- Trigger: any FE change touching navigate/mutation lifecycle, or BE plugin loading.
- Check: `/verify` must include browser smoke (npm run dev + curl / UI click path). tsc alone is insufficient.
- Reference: troubleshooting.md "tsc pass ≠ runtime safe" (PR #403/#404 reverts).

**[6b] Fastify plugin version constraint**
- Trigger: `src/api/plugins/*.ts` changed, or new fp() wrapper added.
- Check: fp() `fastify` constraint matches `package.json` installed version (grep fastify version).
- Reference: troubleshooting.md "fp() fastify version must match" (PR #408 revert).

**[6c] navigate() before mutate()**
- Trigger: `useMutation` + `navigate()` in same handler (FE).
- Check: navigate runs in onSuccess/after await, NOT before mutation dispatch. Unmount kills onSuccess silently.
- Reference: troubleshooting.md "navigate() before mutate() = unmount kills onSuccess" (PR #404 revert).

**[6d] Global rate limit bucket**
- Trigger: changes to `src/api/plugins/rate-limit*`, `server.ts` rate config, or any endpoint with user-facing write.
- Check: method/endpoint scope separated (GET vs POST distinct buckets). Write bucket sized for burst (≥ expected max concurrent click count).
- Reference: troubleshooting.md "Global rate limit bucket = service death" (15min outage PR #408 → #407/#409 fix).

**[6e] Dead code before write**
- Trigger: NEW file under `src/api/plugins/`, `src/modules/*/`, or FE `frontend/src/features/*/`.
- Check: Grep for existing implementation of same concept before writing new.
- Reference: troubleshooting.md "Dead code in codebase" (rate-limit.ts 7일 dead code).

**[6f] Docker healthcheck localhost**
- Trigger: `Dockerfile` or `docker-compose*.yml` changes adding/editing healthcheck.
- Check: healthcheck URL uses `127.0.0.1` not `localhost` (IPv6 resolution on Alpine).
- Reference: troubleshooting.md "Alpine wget resolves localhost to IPv6 first".

**[6g] API response contract change without consumer grep**
- Trigger: change to any response shape / threshold / throw in `src/api/routes/`, `src/modules/`, `supabase/functions/`.
- Check: `grep -rn "<endpoint-or-type>"` across FE (`frontend/src/`) to enumerate consumers; each validated.
- Reference: troubleshooting.md "API 응답 계약 변경 시 consumer validation grep 필수" (CP415 PR #444 `totalActions < 64 throw` empty-actions fallout).

**[6h] PWA autoUpdate activates flag-gated dead code**
- Trigger: `registerType: 'autoUpdate'` or any `workbox`/`vite-plugin-pwa` config change.
- Check: No flag-gated view component is left in `src/` that autoUpdate could resurrect on client cache bust. Verify by grep for unreferenced route / feature flag guards.
- Reference: troubleshooting.md "PWA autoUpdate flag-gated dead-code" (CP415 PR #441 `MandalaWizardStreamView` user stranded).

**[6i] docker-compose environment: overrides env_file**
- Trigger: `docker-compose*.yml` `environment:` block edit OR `.env` value change for a key referenced in that block.
- Check: Both `environment:` block AND `.env` / CI `deploy.yml` sed step updated in same PR. `docker exec <c> printenv <KEY>` verifies post-deploy.
- Reference: troubleshooting.md "docker-compose env override silent miss" (CP416 `V3_CENTER_GATE_MODE` 2-layer flip).

**[6j] Partial-info verification (head-N / grep 1-line / snapshot 단일시점 / Edit partial-match)**
- Trigger: any Edit whose `old_string` is a substring rather than a unique anchor; any judgment based on `head -N` / single-line `grep` / single probe.
- Check: `old_string` `grep -c` returns 1; judgment surfaces full block context (10-20 surrounding lines); time-dependent signals re-measured at ≥ 2 timestamps.
- Reference: troubleshooting.md Regression Watchlist "Partial-info verification" (CP421 5× session-internal recurrence; counter=2).

**[6k] Prod manual edit silent revert**
- Trigger: any `ssh insighta-ec2 sed/patch/docker-compose edit` operation on `/opt/tubearchive/` that was not also committed to the repo.
- Check: Same change committed in `docker-compose.prod.yml` (or equivalent) on a branch that lands before next Deploy; otherwise flag as will-revert.
- Reference: troubleshooting.md "Prod manual edit silently reverted by next deploy" (CP419 `V3_CENTER_GATE_MODE=subword` double regression).

**[6l] Deploy Copy compose step overwrites prod**
- Trigger: `deploy.yml` change touching `Copy docker-compose.prod.yml to EC2` or any `scp`/`rsync` targeting `/opt/tubearchive/docker-compose*.yml`.
- Check: Repo version is source-of-truth; any intentional prod-only divergence must be moved to env var indirection (not docker-compose literal).
- Reference: troubleshooting.md "Deploy Copy docker-compose.prod.yml to EC2 step overwrites prod compose" (CP419 regression).

Promotion policy: an item is added here when it appears in troubleshooting.md at LEVEL-2+, OR at LEVEL-1 with high prod impact (user frustration / outage / data corruption). Items retired when counter drops or pattern becomes impossible by design.

## Output Format

```
## /check Results

### Gate Summary
| # | Category | Gate | Result | Details |
|---|----------|------|--------|---------|
| 1 | Code Quality | Hard | {PASS/FAIL} | tsc: {ok/fail}, lint: {ok/fail}, test: {ok/fail/N/A}, build: {ok/fail} |
| 2 | API Standards | Soft | {PASS/WARN/N/A} | {N} endpoints checked, {M} warnings |
| 3 | Tests | Soft | {PASS/WARN/N/A} | coverage: {if available %}, E2E: {if available status} |
| 4 | Backend | Soft | {PASS/WARN/N/A} | prisma: {ok/N/A}, edge fn: {ok/N/A} |
| 5 | Documentation | Soft | {PASS/WARN/N/A} | CLAUDE.md: {ok/needs update} |
| 6 | Runtime Risk | Soft | {PASS/WARN/N/A} | {N} LEVEL-2 patterns matched, {M} acked |

### Hard Gate: {PASS / FAIL}
{if FAIL: detailed failure items + fix suggestions}

### Soft Gate Warnings ({count})
{if warnings exist: list by item + fix suggestions}
{if none: "No warnings"}

### /ship Readiness
{if Hard Gate PASS: "Ready for /ship"}
{if Hard Gate FAIL: "Blocked — fix {N} Hard Gate failures first"}
```

## Behavior by $ARGUMENTS

| Argument | Categories run | Use case |
|----------|---------------|----------|
| (none) | All 1-5 | Full verification |
| `--quick` | 1 only | Quick build check |
| `--api` | 2, 4 | API standards after changes |
| `--test` | 3 | Test coverage check |

## CLI-Anything Framework Mapping

| Principle | Application |
|-----------|-------------|
| [G1] Real Backend | Category 4 — verify with actual DB/Edge Function, not mocks |
| [G2] Rendering Gap | Category 4 — check L0-L6 propagation path |
| [G3] Output Verification | Category 4 — exit 0 ≠ correct |
| [G5] Idempotency | Category 4 — same request twice safety |
| [G6] Fail Loudly | Category 2 — structured error responses |
| [G8] E2E Verification | Category 3 — Playwright coverage |
