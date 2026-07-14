#!/bin/bash
# T-ledger guard (2026-07-14, supervisor-approved) — INV-T-LEDGER-COMPLETE
#
# The T-ledger (docs/handoffs/version-archetype-matrix-2026-07-12.md) is the
# time-machine index for ALL search-performance changes. One unnumbered change
# breaks its completeness guarantee — which happened on 2026-07-13 (the judge
# track ran through 2 PRs with no T number until James asked). Memory-only
# discipline has a documented 0% hold rate in this repo (Rule H/J/A.2);
# guards hold. So: a PR that touches search-performance paths MUST carry a
# T number ("T10", "T11", "T10-R"...) in its title or body.
#
# Scope is deliberately NARROW (supervisor: never block unrelated PRs).
# Env: PR_TITLE / PR_BODY (from the workflow), BASE_REF (default origin/main).

set -euo pipefail

BASE_REF="${BASE_REF:-origin/main}"
PR_TEXT="${PR_TITLE:-} ${PR_BODY:-}"

# Search-performance code paths (keep in sync with the T-ledger §11 scope).
PERF_PATHS_RE='^src/(skills/plugins/(video-discover|iks-scorer)/|modules/(judge|relevance)/|modules/mandala/(wizard-precompute|pipeline-runner|place-auto-added-cards|auto-add-recommendations)\.ts|config/(discover-|judge-|wizard-|precompute-|pool-serve|subgoal-anchor|inflow-gate|embed-))'
# Perf flags inside compose (the file itself hosts many unrelated envs).
PERF_FLAG_RE='(V3_|V5_|DISCOVER_|JUDGE_|WIZARD_|PRECOMPUTE_|INFLOW_GATE|EMBED_SERVING_|OPENROUTER_EMBED_|POOL_SERVE|AUTO_ADD_)'

CHANGED=$(git diff --name-only "${BASE_REF}...HEAD" 2>/dev/null || true)

touched_perf=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if echo "$f" | grep -qE "$PERF_PATHS_RE"; then
    touched_perf="${touched_perf}${f}\n"
  fi
done <<< "$CHANGED"

# compose: only when the DIFF HUNKS touch perf flags, not any compose edit.
if echo "$CHANGED" | grep -q '^docker-compose.prod.yml$'; then
  if git diff "${BASE_REF}...HEAD" -- docker-compose.prod.yml | grep -E '^[+-]' | grep -qE "$PERF_FLAG_RE"; then
    touched_perf="${touched_perf}docker-compose.prod.yml (perf flag)\n"
  fi
fi

if [ -z "$touched_perf" ]; then
  echo "t-ledger: OK — no search-performance paths touched"
  exit 0
fi

if echo "$PR_TEXT" | grep -qE '\bT[0-9]+(-[A-Z]+)?\b'; then
  echo "t-ledger: OK — T number present for perf change"
  exit 0
fi

echo "t-ledger: FAIL — search-performance paths changed without a T number."
echo "Touched:"
printf "%b" "$touched_perf" | sed 's/^/  - /'
echo ""
echo "Fix: register the change in docs/handoffs/version-archetype-matrix-2026-07-12.md"
echo "and put its T number (e.g. 'T11') in the PR title or body."
exit 1
