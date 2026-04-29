#!/bin/bash
# OpenClaw /stats handler (CP438).
# Composes a Telegram-friendly stats report from the latest collect log.
# Read-only; no DB writes.
#
# Spec: collection-stats-reporter skill expects the collector to dump
# a per-source summary; this handler currently parses the orchestrator
# stdout patterns ([s1 ...] / [s2 ...] / [s3 ...] / [s4 ...] / [aggregate]
# / [done]). DB-derived domain/duration buckets will be added once a
# /api/v1/internal/collection-stats endpoint exists.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_bootstrap.sh
source "$DIR/_bootstrap.sh"

LOG_DIR="/tmp/insighta-collect-logs"
LATEST="$(ls -t "$LOG_DIR"/collect-*.log 2>/dev/null | head -1 || true)"

if [ -z "$LATEST" ]; then
  echo "수집 로그 없음. /collect 먼저 실행해줘."
  exit 0
fi

LOG_BASENAME="$(basename "$LATEST")"
LOG_TS="${LOG_BASENAME#collect-}"
LOG_TS="${LOG_TS%.log}"

# Pull the structured lines the orchestrator prints.
TARGET_LINE="$(grep -E '^\[collect-trending\]' "$LATEST" | head -1 || true)"
S1_LINE="$(grep -E '^\[s1 ' "$LATEST" | head -1 || true)"
S2_LINE="$(grep -E '^\[s2 ' "$LATEST" | head -1 || true)"
S3_LINE="$(grep -E '^\[s3 ' "$LATEST" | head -1 || true)"
S4_LINE="$(grep -E '^\[s4 ' "$LATEST" | head -1 || true)"
AGG_LINE="$(grep -E '^\[aggregate\]' "$LATEST" | head -1 || true)"
DONE_LINE="$(grep -E '^\[done\]' "$LATEST" | head -1 || true)"

cat <<EOF
📊 수집 리포트 (log: $LOG_TS)

$TARGET_LINE

소스 진단:
$S1_LINE
$S2_LINE
$S3_LINE
$S4_LINE

집계:
$AGG_LINE

최종:
$DONE_LINE
EOF
