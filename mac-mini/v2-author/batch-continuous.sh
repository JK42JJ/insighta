#!/bin/bash
# Continuous v2-author dispatcher (CP438).
# Loops batch.sh until the candidate pool drains or MAX_ITERS reached.
#
# Usage:
#   bash batch-continuous.sh           # default 8 iterations × 200 = up to 1600 candidates
#   bash batch-continuous.sh 4 100     # 4 iterations × 100 each
#
# Per-iteration:
#   1. Probe /transcript/candidates?limit=1 — exit early if pool empty.
#   2. bash batch.sh <SIZE>
#   3. sleep COOLDOWN_SEC (default 30s) — let DB writes settle.
#
# Exit codes: 0 = clean drain or max iters reached, 1 = bootstrap missing,
# 2 = candidate probe failed.
#
# Spawn requirements: must run with the user's keychain accessible so
# inner `claude -p` subprocesses can authenticate. Run from:
#   - Mac Mini local Terminal, OR
#   - launchctl asuser <uid> bash batch-continuous.sh, OR
#   - tmux session started locally (NOT via plain ssh).

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../openclaw-handlers/_bootstrap.sh
source "$DIR/../openclaw-handlers/_bootstrap.sh" || { echo "[continuous] bootstrap failed"; exit 1; }

MAX_ITERS="${1:-8}"
SIZE="${2:-200}"
COOLDOWN_SEC="${BATCH_COOLDOWN_SEC:-30}"
LOG_DIR="${V2_LOG_DIR:-/tmp/insighta-v2-batch}"
mkdir -p "$LOG_DIR"
SUMMARY="$LOG_DIR/continuous-$(date +%Y%m%d-%H%M%S).log"

echo "[continuous] start=$(date -u +%FT%TZ) max_iters=$MAX_ITERS size=$SIZE cooldown=${COOLDOWN_SEC}s log=$SUMMARY" | tee "$SUMMARY"

for i in $(seq 1 "$MAX_ITERS"); do
  # 1. Probe candidate pool — exit early if drained.
  PROBE=$(curl -sS \
    "${INSIGHTA_API_URL%/}/api/v1/internal/transcript/candidates?limit=1" \
    -H "x-internal-token: ${INTERNAL_BATCH_TOKEN}" 2>/dev/null)
  PROBE_COUNT=$(printf '%s' "$PROBE" | jq -r '.videos | length' 2>/dev/null || echo "ERR")
  if [ "$PROBE_COUNT" = "ERR" ]; then
    echo "[continuous] iter=$i — candidate probe failed, aborting" | tee -a "$SUMMARY"
    exit 2
  fi
  if [ "$PROBE_COUNT" = "0" ]; then
    echo "[continuous] iter=$i — 0 candidates remaining, exiting cleanly" | tee -a "$SUMMARY"
    break
  fi

  echo "[continuous] iter=$i/$MAX_ITERS — pool has candidates, dispatching batch.sh $SIZE" | tee -a "$SUMMARY"
  bash "$DIR/batch.sh" "$SIZE" 2>&1 | tee -a "$SUMMARY"
  echo "[continuous] iter=$i — batch.sh done, cooldown ${COOLDOWN_SEC}s" | tee -a "$SUMMARY"

  if [ "$i" -lt "$MAX_ITERS" ]; then
    sleep "$COOLDOWN_SEC"
  fi
done

echo "[continuous] end=$(date -u +%FT%TZ)" | tee -a "$SUMMARY"
