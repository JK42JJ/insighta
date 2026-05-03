#!/bin/bash
# v2-author batch dispatcher (CP438+1).
# Args: $1 = N (default 10) — number of candidates to author this batch.
# Concurrency: 5 (tunable via V2_CONCURRENCY env).
# Env (optional):
#   DOMAINS — comma-separated domain slugs (e.g. "social,creative") to
#     bias the candidates selector toward under-represented buckets.
#   TRANSCRIPT_FETCHER — 'ytapi' (default, no proxy) or 'ytdlp' (legacy).
#
# Pipeline per video: process-one.sh handles transcript fetch → claude -p →
# upsert-direct. Auto-promote to video_pool fires inside the upsert-direct
# route (PR #588 hook).

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../openclaw-handlers/_bootstrap.sh
source "$DIR/../openclaw-handlers/_bootstrap.sh"

N="${1:-10}"
CONC="${V2_CONCURRENCY:-5}"
DOMAINS="${DOMAINS:-}"
TRANSCRIPT_FETCHER="${TRANSCRIPT_FETCHER:-ytapi}"
V2_LOG_DIR="${V2_LOG_DIR:-/tmp/insighta-v2-batch}"
mkdir -p "$V2_LOG_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
SUMMARY="$V2_LOG_DIR/summary-$TS.log"

export V2_LOG_DIR INSIGHTA_API_URL INTERNAL_BATCH_TOKEN TRANSCRIPT_FETCHER \
  WEBSHARE_HOST WEBSHARE_PORT WEBSHARE_USERNAME WEBSHARE_PASSWORD \
  YTDLP_BIN CLAUDE_BIN

CLAUDE_BIN="${CLAUDE_BIN:-$HOME/.npm-global/bin/claude}"
export CLAUDE_BIN

echo "[v2-batch] target=$N concurrency=$CONC fetcher=$TRANSCRIPT_FETCHER domains=${DOMAINS:-(any)} log_dir=$V2_LOG_DIR" | tee "$SUMMARY"
echo "[v2-batch] start=$(date -u +%FT%TZ)" | tee -a "$SUMMARY"

# 1. Fetch candidates
CAND_URL="${INSIGHTA_API_URL%/}/api/v1/internal/transcript/candidates?limit=$N"
if [ -n "$DOMAINS" ]; then
  CAND_URL="${CAND_URL}&domains=$(printf '%s' "$DOMAINS" | jq -sRr @uri)"
fi
CANDS_JSON=$(curl -sS "$CAND_URL" -H "x-internal-token: ${INTERNAL_BATCH_TOKEN}")
COUNT=$(printf '%s' "$CANDS_JSON" | jq -r '.videos | length' 2>/dev/null || echo 0)

if [ "$COUNT" = "0" ] || [ -z "$COUNT" ]; then
  echo "[v2-batch] no candidates available — done" | tee -a "$SUMMARY"
  exit 0
fi
echo "[v2-batch] candidates fetched: $COUNT" | tee -a "$SUMMARY"

# 2. Dispatch concurrently via xargs -P. Each worker = process-one.sh.
PAIRS=$(printf '%s' "$CANDS_JSON" | jq -r '.videos[] | "\(.youtube_video_id) \(.default_language // "ko")"')
echo "$PAIRS" | xargs -n 2 -P "$CONC" -I {} bash -c 'eval set -- {}; "'"$DIR"'/process-one.sh" "$1" "$2"' || true

# 3. Aggregate per-video result lines.
PASS=$(grep -h ' pass ' "$V2_LOG_DIR"/*.log 2>/dev/null | wc -l | tr -d ' ')
NO_CAP=$(grep -h ' no_caption' "$V2_LOG_DIR"/*.log 2>/dev/null | wc -l | tr -d ' ')
INV_JSON=$(grep -h ' claude_invalid_json' "$V2_LOG_DIR"/*.log 2>/dev/null | wc -l | tr -d ' ')
UP_FAIL=$(grep -h ' upsert_failed' "$V2_LOG_DIR"/*.log 2>/dev/null | wc -l | tr -d ' ')

cat <<EOF | tee -a "$SUMMARY"
[v2-batch] done=$(date -u +%FT%TZ)
[v2-batch] candidates=$COUNT pass=$PASS no_caption=$NO_CAP claude_invalid_json=$INV_JSON upsert_failed=$UP_FAIL
EOF
