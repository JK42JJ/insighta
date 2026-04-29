#!/bin/bash
# OpenClaw /collect handler (CP438).
# Runs mac-mini/video-collector/collect-trending.ts with optional target override
# and tees output to a timestamped log so /stats can read it back.
#
# Usage:
#   bash run-collect.sh           # default COLLECT_TARGET_TOTAL=1000
#   bash run-collect.sh 500       # override target to 500
#   COLLECT_DRY_RUN=1 bash run-collect.sh   # skip POST (debug)

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_bootstrap.sh
source "$DIR/_bootstrap.sh"

TARGET="${1:-}"
if [ -n "$TARGET" ]; then
  export COLLECT_TARGET_TOTAL="$TARGET"
fi

LOG_DIR="/tmp/insighta-collect-logs"
mkdir -p "$LOG_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/collect-$TS.log"

echo "[run-collect] target=${COLLECT_TARGET_TOTAL:-1000} log=$LOG_FILE"
echo "[run-collect] start=$(date -u +%FT%TZ)"

npx tsx mac-mini/video-collector/collect-trending.ts 2>&1 | tee "$LOG_FILE"

# Echo a one-line tail summary the agent can quote back to Telegram.
echo ""
echo "=== collect summary ==="
grep -E '^\[done\]|^\[aggregate\]|^\[s[1-4] ' "$LOG_FILE" | tail -10
