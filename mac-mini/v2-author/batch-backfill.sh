#!/bin/bash
# batch-backfill.sh — sequential CP446+ atom regeneration with IP-block
# backoff (single-worker, 2026-05-09 mode).
#
# Why sequential: an earlier 5-worker parallel run on the 1,296-row v2
# queue tripped YouTube's transcript-download IP rate-limit (1,253 / 1,296
# = 96.7% IpBlocked). list() still works during the block, but fetch()
# is throttled. Single-worker + per-video sleep keeps the request rate
# below the threshold; consecutive-IpBlocked detector triggers a longer
# backoff if the block recurs.
#
# Args:
#   $1  vid_list_file  — one youtube_video_id per line (e.g. failed-vids.txt)
#   $2  dur_meta_file  — TSV: <vid>\t<duration_sec>\t<source_language>
#
# Env:
#   V2_LOG_DIR        — log dir (default /tmp/insighta-backfill)
#   DRY_RUN=1         — pass-through to process-one.sh
#   SLEEP_BETWEEN_SEC — per-video sleep (default 15s)
#   IPBLOCK_THRESHOLD — consecutive IpBlocked count → backoff (default 10)
#   IPBLOCK_BACKOFF_SEC — backoff duration (default 3600s = 1h)
#   IPBLOCK_BACKOFF_MAX — max consecutive backoffs before abort (default 3)
#
# Exit:
#   0 — full queue processed
#   2 — OAuth cap hit (resumable via remaining-vids.txt)
#   3 — IpBlocked persistent past IPBLOCK_BACKOFF_MAX backoffs

set -uo pipefail

VID_LIST="${1:?usage: batch-backfill.sh <vid_list> <dur_meta>}"
DUR_META="${2:?usage: batch-backfill.sh <vid_list> <dur_meta>}"
LOG_DIR="${V2_LOG_DIR:-/tmp/insighta-backfill}"
mkdir -p "$LOG_DIR"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$DIR/../openclaw-handlers/_bootstrap.sh" ]; then
  # shellcheck source=../openclaw-handlers/_bootstrap.sh disable=SC1091
  source "$DIR/../openclaw-handlers/_bootstrap.sh"
fi

# Bash 3.2 (macOS default) lacks `declare -A`; awk lookup.
lookup_meta() {
  awk -F'\t' -v vid="$1" '$1 == vid { print $2 ":" $3; exit }' "$DUR_META"
}

# IpBlocked detector: process-one.sh's fetch.err captures fetch-transcript.py
# stderr. New fetch-transcript.py writes 'IpBlocked' substring on the
# attempt-failed line.
saw_ipblocked() {
  local vid="$1"
  grep -q "IpBlocked\|RequestBlocked" "$LOG_DIR/$vid.fetch.err" 2>/dev/null
}

SLEEP_BETWEEN_SEC="${SLEEP_BETWEEN_SEC:-15}"
IPBLOCK_THRESHOLD="${IPBLOCK_THRESHOLD:-10}"
IPBLOCK_BACKOFF_SEC="${IPBLOCK_BACKOFF_SEC:-3600}"
IPBLOCK_BACKOFF_MAX="${IPBLOCK_BACKOFF_MAX:-3}"

TOTAL=$(wc -l < "$VID_LIST" | tr -d ' ')
COUNTER=0
PASS=0
FAIL=0
SKIPPED=0
CONSEC_IPBLOCK=0
BACKOFF_COUNT=0

START_TS=$(date +%s)

echo "[batch-backfill] target=$TOTAL mode=sequential sleep=${SLEEP_BETWEEN_SEC}s ipblock_threshold=${IPBLOCK_THRESHOLD} backoff=${IPBLOCK_BACKOFF_SEC}s log_dir=$LOG_DIR dry_run=${DRY_RUN:-0}"

while IFS= read -r VID; do
  [ -z "$VID" ] && continue
  COUNTER=$((COUNTER + 1))

  if [ -f "$LOG_DIR/.oauth_limit_hit" ]; then
    echo "[batch-backfill] OAuth cap sentinel detected at #$COUNTER ($VID). Stopping queue."
    SKIPPED=$((TOTAL - COUNTER + 1))
    tail -n +"$COUNTER" "$VID_LIST" > "$LOG_DIR/remaining-vids.txt"
    echo "[batch-backfill] Remaining queue saved: $LOG_DIR/remaining-vids.txt ($SKIPPED items)"
    exit 2
  fi

  META=$(lookup_meta "$VID")
  [ -z "$META" ] && META="0:ko"
  DUR="${META%%:*}"
  LANG="${META##*:}"
  [ -z "$DUR" ] && DUR=0
  [ -z "$LANG" ] && LANG=ko

  echo "[batch-backfill] [$COUNTER/$TOTAL] $VID lang=$LANG dur=$DUR"
  V2_LOG_DIR="$LOG_DIR" \
    bash "$DIR/process-one.sh" "$VID" "$LANG" "$DUR" \
    >> "$LOG_DIR/batch.stdout.log" 2>> "$LOG_DIR/batch.stderr.log"
  RC=$?

  case $RC in
    0)
      PASS=$((PASS + 1))
      CONSEC_IPBLOCK=0
      ;;
    4)
      echo "[batch-backfill] OAuth cap on $VID (rc=4). Stopping queue."
      SKIPPED=$((TOTAL - COUNTER))
      tail -n +$((COUNTER + 1)) "$VID_LIST" > "$LOG_DIR/remaining-vids.txt"
      echo "[batch-backfill] Remaining queue saved: $LOG_DIR/remaining-vids.txt ($SKIPPED items)"
      exit 2
      ;;
    *)
      FAIL=$((FAIL + 1))
      if saw_ipblocked "$VID"; then
        CONSEC_IPBLOCK=$((CONSEC_IPBLOCK + 1))
        echo "[batch-backfill] $VID IpBlocked (consecutive=$CONSEC_IPBLOCK / threshold=$IPBLOCK_THRESHOLD)"
      else
        CONSEC_IPBLOCK=0
      fi
      ;;
  esac

  if [ "$CONSEC_IPBLOCK" -ge "$IPBLOCK_THRESHOLD" ]; then
    BACKOFF_COUNT=$((BACKOFF_COUNT + 1))
    if [ "$BACKOFF_COUNT" -gt "$IPBLOCK_BACKOFF_MAX" ]; then
      echo "[batch-backfill] IpBlocked persists past $IPBLOCK_BACKOFF_MAX backoffs. Stopping queue."
      tail -n +$((COUNTER + 1)) "$VID_LIST" > "$LOG_DIR/remaining-vids.txt"
      exit 3
    fi
    echo "[batch-backfill] $CONSEC_IPBLOCK consecutive IpBlocked. Backoff #$BACKOFF_COUNT — sleep ${IPBLOCK_BACKOFF_SEC}s..."
    sleep "$IPBLOCK_BACKOFF_SEC"
    CONSEC_IPBLOCK=0
    echo "[batch-backfill] backoff over, resuming"
  fi

  sleep "$SLEEP_BETWEEN_SEC"
done < "$VID_LIST"

ELAPSED=$(( $(date +%s) - START_TS ))
echo "[batch-backfill] DONE total=$TOTAL processed=$COUNTER pass=$PASS fail=$FAIL skipped=$SKIPPED backoffs=$BACKOFF_COUNT elapsed=${ELAPSED}s"
