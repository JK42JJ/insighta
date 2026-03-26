#!/usr/bin/env bash
# cc-ci-check.sh — CI status check with optional watch mode
# Replaces repeated sleep+gh run view pattern.
#
# Usage:
#   cc-ci-check.sh                     # Latest run, instant check
#   cc-ci-check.sh 23596688879         # Specific run, instant check
#   cc-ci-check.sh --watch             # Latest run, wait until complete
#   cc-ci-check.sh --watch 23596688879 # Specific run, wait until complete
#
# Watch mode writes result to /tmp/ci-result-{run-id}.txt
# Exit codes: 0=success, 1=failure, 2=timeout

set -euo pipefail

WATCH=false
RUN_ID=""
MAX_WAIT=600  # 10 minutes
POLL_INTERVAL=30

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch) WATCH=true; shift ;;
    *) RUN_ID="$1"; shift ;;
  esac
done

# Auto-detect latest run if not specified
if [[ -z "$RUN_ID" ]]; then
  RUN_ID=$(gh run list --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null)
  if [[ -z "$RUN_ID" ]]; then
    echo "ERROR: No CI runs found"
    exit 1
  fi
fi

RESULT_FILE="/tmp/ci-result-${RUN_ID}.txt"

get_status() {
  gh run view "$RUN_ID" --json status,conclusion,jobs \
    --jq '{
      status: .status,
      conclusion: (.conclusion // "—"),
      jobs: [.jobs[] | {name: .name, status: .status, conclusion: (.conclusion // "—")}]
    }' 2>/dev/null
}

print_summary() {
  local data="$1"
  local overall_status overall_conclusion
  overall_status=$(echo "$data" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null)
  overall_conclusion=$(echo "$data" | python3 -c "import sys,json; print(json.load(sys.stdin)['conclusion'])" 2>/dev/null)

  echo "=== CI Run #${RUN_ID} ==="
  echo "Status: ${overall_status} | Conclusion: ${overall_conclusion}"
  echo "--- Jobs ---"
  echo "$data" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for j in data['jobs']:
    icon = '✅' if j['conclusion'] == 'success' else '❌' if j['conclusion'] == 'failure' else '⏳' if j['status'] == 'in_progress' else '⬚'
    print(f\"  {icon} {j['name']}: {j['conclusion']}\")
" 2>/dev/null

  # If failed, get failure details
  if [[ "$overall_conclusion" == "failure" ]]; then
    echo "--- Failure Details ---"
    gh run view "$RUN_ID" --log-failed 2>/dev/null | head -30 || echo "(logs not yet available)"
  fi

  # Health check (only if deploy jobs completed)
  if echo "$data" | grep -q '"Deploy to EC2"' 2>/dev/null; then
    echo "--- Health Check ---"
    curl -sf https://insighta.one/health 2>/dev/null || echo "(health check failed)"
  fi
}

# Instant mode
if [[ "$WATCH" == false ]]; then
  DATA=$(get_status)
  print_summary "$DATA"
  exit 0
fi

# Watch mode
echo "Watching CI run #${RUN_ID} (max ${MAX_WAIT}s, poll every ${POLL_INTERVAL}s)..."
ELAPSED=0

while [[ $ELAPSED -lt $MAX_WAIT ]]; do
  DATA=$(get_status)
  STATUS=$(echo "$DATA" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null)

  if [[ "$STATUS" == "completed" ]]; then
    CONCLUSION=$(echo "$DATA" | python3 -c "import sys,json; print(json.load(sys.stdin)['conclusion'])" 2>/dev/null)
    print_summary "$DATA" | tee "$RESULT_FILE"
    echo ""
    echo "Result saved to: $RESULT_FILE"

    if [[ "$CONCLUSION" == "success" ]]; then
      exit 0
    else
      exit 1
    fi
  fi

  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
  echo "  ... ${ELAPSED}s elapsed (status: ${STATUS})"
done

echo "TIMEOUT: CI run #${RUN_ID} did not complete within ${MAX_WAIT}s"
DATA=$(get_status)
print_summary "$DATA" | tee "$RESULT_FILE"
exit 2
