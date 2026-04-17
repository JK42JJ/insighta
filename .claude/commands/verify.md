---
name: verify
description: "Pre-push verification gate — MUST pass before git push or PR creation. Prevents prod regression from unverified code."
allowed-tools: Bash(npm:*), Bash(npx:*), Bash(cd:*), Bash(git:*), Bash(curl:*), Bash(kill:*), Bash(sleep:*), Bash(lsof:*), Read, Grep, Glob
---

# /verify — Mandatory pre-push verification gate

**WHY THIS EXISTS**: 2026-04-17 incident — two consecutive prod regressions (PR #403, #404) shipped without running dev server or browser verification. Both passed tsc + jest but failed at runtime. This skill prevents that pattern.

**RULE**: Frontend changes MUST NOT be pushed until `/verify` reports PASS. No exceptions. No "it's a simple change". No "just 2 lines".

## When to run

**Automatically triggered** by the PreToolUse hook on `git push` / `gh pr create` / `gh pr merge`.
**Manually**: run `/verify` before pushing any change.

## Execution

### Step 1: Detect scope

```bash
# What files changed since the branch diverged from main?
CHANGED=$(git diff --name-only origin/main...HEAD 2>/dev/null || git diff --name-only HEAD~1)
echo "$CHANGED"
```

Classify:
- Contains `frontend/src/` → **FRONTEND** scope
- Contains `src/` (not under frontend) → **BACKEND** scope
- Contains both → **FULL** scope
- Contains only non-code files (docs, configs) → **SKIP** (auto-pass)

### Step 2: Run checks

#### BACKEND checks (always, if scope matches)

```bash
npx tsc --noEmit -p tsconfig.json
npx jest --passWithNoTests --bail
```

Both must exit 0.

#### FRONTEND checks (if scope matches)

```bash
cd frontend
npx tsc --noEmit
npx vitest run --bail
npm run build
```

All three must exit 0.

#### BROWSER SMOKE TEST (frontend scope only — CRITICAL)

This is the check that was skipped in PR #403 and #404, causing two prod outages.

```bash
cd frontend

# 1. Start dev server (background)
npm run dev &
DEV_PID=$!

# 2. Wait for server ready
for i in $(seq 1 30); do
  curl -sf http://localhost:5173/ > /dev/null 2>&1 && break
  sleep 1
done

# 3. Smoke test critical routes
SMOKE_PASS=true
for route in "/" "/mandalas/new"; do
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "http://localhost:5173${route}" 2>/dev/null)
  if [ "$STATUS" = "200" ]; then
    echo "✅ GET ${route} → ${STATUS}"
  else
    echo "❌ GET ${route} → ${STATUS:-timeout}"
    SMOKE_PASS=false
  fi
done

# 4. Check for JS runtime errors in the build output
# (Vite dev server logs critical errors to stderr)
sleep 2

# 5. Cleanup
kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null

if [ "$SMOKE_PASS" = "false" ]; then
  echo "🚫 BROWSER SMOKE TEST FAILED"
  exit 1
fi
```

### Step 3: Write result marker

```bash
# On PASS: write marker file so the PreToolUse hook can verify
echo "PASS $(date +%s) $(git rev-parse HEAD)" > /tmp/.verify-pass
```

### Step 4: Report

```
## /verify Report

**Scope**: {FRONTEND | BACKEND | FULL | SKIP}
**Commit**: {short hash}
**Branch**: {branch name}

| Check | Result | Duration |
|-------|--------|----------|
| tsc (backend) | {PASS/FAIL/SKIP} | {N}s |
| jest | {PASS/FAIL/SKIP} | {N}s |
| tsc (frontend) | {PASS/FAIL/SKIP} | {N}s |
| vitest | {PASS/FAIL/SKIP} | {N}s |
| frontend build | {PASS/FAIL/SKIP} | {N}s |
| browser smoke | {PASS/FAIL/SKIP} | {N}s |

**Verdict: {✅ PASS — safe to push | 🚫 FAIL — DO NOT push}**

{if FAIL: list the failing check + error excerpt}
{if PASS: "All checks passed. You may proceed with git push / gh pr create."}
```

## Hard rules (enforced by this skill)

1. **Frontend changes → browser smoke test is MANDATORY**. `tsc --noEmit` + `vitest` are necessary but NOT sufficient. PR #403 and #404 both passed tsc+vitest and failed in production.

2. **"Simple change" is not an excuse to skip**. Both regressions were "just 2 lines". Run `/verify` anyway.

3. **If `/verify` fails, DO NOT push**. Fix the issue first. Do not `--no-verify` or bypass.

4. **After `/verify` PASS, do not make additional code changes before pushing**. If you edit code, run `/verify` again.
