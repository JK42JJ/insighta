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

# Ledger-scoped code paths. Three axes now (docs/LEDGERS.md, 2026-08-04):
#   T = search logic · C = curation · P = pool inflow
# The curation and pool paths were added after three PRs changed curation search
# on 2026-08-04 and all three passed with no number, because the scope below
# only knew about T. The guard was not wrong; an axis was missing.
PERF_PATHS_RE='^src/(skills/plugins/(video-discover|iks-scorer|batch-video-collector)/|modules/(judge|relevance|curation|video-pool)/|modules/queue/handlers/(curation-|batch-video-collector|pool-maintenance)|modules/mandala/(wizard-precompute|pipeline-runner|place-auto-added-cards|auto-add-recommendations)\.ts|config/(discover-|judge-|wizard-|precompute-|pool-serve|subgoal-anchor|inflow-gate|embed-|domains))'
# Flags inside compose (the file itself hosts many unrelated envs).
PERF_FLAG_RE='(V3_|V5_|DISCOVER_|JUDGE_|WIZARD_|PRECOMPUTE_|INFLOW_GATE|EMBED_SERVING_|OPENROUTER_EMBED_|POOL_SERVE|AUTO_ADD_|CURATION_|BATCH_COLLECTOR_)'

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
  echo "ledger: OK — no ledger-scoped paths touched"
  exit 0
fi

if echo "$PR_TEXT" | grep -qE '\b[TCP][0-9]+(-[A-Z]+)?\b'; then
  echo "ledger: OK — ledger number present"
  exit 0
fi

echo "ledger: FAIL — ledger-scoped paths changed without a T/C/P number."
echo "Touched:"
printf "%b" "$touched_perf" | sed 's/^/  - /'
echo ""
echo "Pick the axis by asking what reverting it restores (docs/LEDGERS.md):"
echo "  T — search logic      docs/handoffs/version-archetype-matrix-2026-07-12.md"
echo "  C — curation          docs/handoffs/curation-ledger.md"
echo "  P — pool inflow       docs/handoffs/pool-inflow-ledger.md"
echo ""
echo "Register the change there, then put its number (e.g. 'C3') in the PR title or body."
exit 1
