#!/bin/bash
# OpenClaw /promote handler (CP438).
# Calls /api/v1/internal/video-pool/promote-from-v2 with batch limit
# (default 100). Returns the JSON shape the agent quotes back to Telegram.
#
# Usage:
#   bash run-promote.sh           # default limit 100
#   bash run-promote.sh 50        # limit 50
#   PROMOTE_DRY_RUN=1 bash run-promote.sh   # show counts without writes

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_bootstrap.sh
source "$DIR/_bootstrap.sh"

LIMIT="${1:-100}"
DRY_RUN="${PROMOTE_DRY_RUN:-0}"

PAYLOAD=$(printf '{"limit":%d,"dry_run":%s}' "$LIMIT" "$([ "$DRY_RUN" = "1" ] && echo true || echo false)")

echo "[run-promote] limit=$LIMIT dry_run=$DRY_RUN"

curl -sS \
  -X POST "${INSIGHTA_API_URL%/}/api/v1/internal/video-pool/promote-from-v2" \
  -H "x-internal-token: ${INTERNAL_BATCH_TOKEN:?missing}" \
  -H 'content-type: application/json' \
  -d "$PAYLOAD" \
  -w "\nHTTP %{http_code}\n"
