#!/bin/bash
# batch-backfill.sh — re-process v2 videos through the CP446+ pipeline.
#
# Sequentially invokes process-one.sh for each video_id in the input
# list. Honors:
#   - DRY_RUN=1 : skip upsert (sample / gate-check mode)
#   - .oauth_limit_hit sentinel from process-one.sh (CC subscription
#     5h cap) : abort the remaining queue cleanly so the operator can
#     re-run after re-login without losing position.
#
# Args:
#   $1  vid_list_file  — one youtube_video_id per line
#   $2  dur_meta_file  — TSV: <vid>\t<duration_sec>\t<source_language>
#                         (run prepare-backfill-list.js to generate)
#
# Env:
#   V2_LOG_DIR        — log dir (default /tmp/insighta-backfill)
#   DRY_RUN=1         — pass-through to process-one.sh
#   INSIGHTA_API_URL  — required for non-dry-run prod writes
#   INTERNAL_BATCH_TOKEN — required for non-dry-run
#
# Exit:
#   0 — full queue processed (zero or more failures)
#   2 — OAuth cap hit; remaining queue NOT processed (resumable)
#
# stdout: per-video result lines (forwarded from process-one.sh) +
#         summary line at the end:
#   [batch-backfill] DONE total=N processed=M pass=P fail=F skipped=S

set -uo pipefail

VID_LIST="${1:?usage: batch-backfill.sh <vid_list> <dur_meta>}"
DUR_META="${2:?usage: batch-backfill.sh <vid_list> <dur_meta>}"
LOG_DIR="${V2_LOG_DIR:-/tmp/insighta-backfill}"
mkdir -p "$LOG_DIR"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source env (INSIGHTA_API_URL / INTERNAL_BATCH_TOKEN / WEBSHARE_*) — same
# pattern as batch.sh + daily-targeted.sh. _bootstrap.sh reads from
# /Users/jamesjk/code/video-dictionary/.env on Mac Mini per CP438. Skip
# silently in DRY_RUN mode (no upsert call), or when the bootstrap is
# absent (running on a non-Mac-Mini machine).
if [ -f "$DIR/../openclaw-handlers/_bootstrap.sh" ]; then
  # shellcheck source=../openclaw-handlers/_bootstrap.sh disable=SC1091
  source "$DIR/../openclaw-handlers/_bootstrap.sh"
fi

# Bash 3.2 (macOS default) lacks `declare -A`; use awk-based lookup
# against the TSV. Each lookup is O(N) but N=1296 is tiny vs the LLM
# call cost, so amortized overhead is negligible.
lookup_meta() {
  awk -F'\t' -v vid="$1" '$1 == vid { print $2 ":" $3; exit }' "$DUR_META"
}

TOTAL=$(wc -l < "$VID_LIST" | tr -d ' ')
CONC="${V2_CONCURRENCY:-5}"
START_TS=$(date +%s)

echo "[batch-backfill] target=$TOTAL concurrency=$CONC log_dir=$LOG_DIR dry_run=${DRY_RUN:-0}"

# Build (vid lang dur) triples — one per xargs invocation. Each line is
# fed as 3 args to process-one.sh via `xargs -n 3 -I {} bash -c '...'`.
# Same pattern as batch.sh:53-54 (CP437+).
PAIRS_FILE="$LOG_DIR/pairs.txt"
> "$PAIRS_FILE"
while read -r VID; do
  [ -z "$VID" ] && continue
  META=$(lookup_meta "$VID")
  [ -z "$META" ] && META="0:ko"
  DUR="${META%%:*}"
  LANG="${META##*:}"
  [ -z "$DUR" ] && DUR=0
  [ -z "$LANG" ] && LANG=ko
  echo "$VID $LANG $DUR" >> "$PAIRS_FILE"
done < "$VID_LIST"

PAIRS_TOTAL=$(wc -l < "$PAIRS_FILE" | tr -d ' ')
echo "[batch-backfill] pairs prepared: $PAIRS_TOTAL"

# Worker wrapper — exits early when sentinel exists so newly-spawned
# workers stop dispatching after an OAuth cap, while in-flight workers
# drain their current video. Wraps process-one.sh and forwards exit code.
WORKER="$LOG_DIR/worker.sh"
cat > "$WORKER" <<EOFW
#!/bin/bash
set -uo pipefail
VID="\$1"; LANG="\$2"; DUR="\$3"
LOG_DIR="$LOG_DIR"
DIR="$DIR"
if [ -f "\$LOG_DIR/.oauth_limit_hit" ]; then
  echo "[skip] \$VID — oauth_limit_hit"
  exit 0
fi
V2_LOG_DIR="\$LOG_DIR" bash "\$DIR/process-one.sh" "\$VID" "\$LANG" "\$DUR" \\
  >> "\$LOG_DIR/batch.stdout.log" 2>> "\$LOG_DIR/batch.stderr.log"
RC=\$?
echo "[done] \$VID rc=\$RC"
exit \$RC
EOFW
chmod +x "$WORKER"

# Dispatch via xargs -P (batch.sh:54 pattern). `|| true` so that an
# individual exit-4 (OAuth cap) doesn't kill the whole xargs batch —
# the WORKER's own sentinel check drains gracefully.
cat "$PAIRS_FILE" | xargs -n 3 -P "$CONC" -I {} bash -c 'eval set -- {}; "$0" "$1" "$2" "$3"' "$WORKER" || true

# Tally results from main.stdout (each WORKER appends one [done] line).
DONE_COUNT=$(grep -c '^\[done\]' "$LOG_DIR/main.stdout" 2>/dev/null || echo 0)
PASS=$(grep -c '^\[done\] .* rc=0$' "$LOG_DIR/main.stdout" 2>/dev/null || echo 0)
SKIP=$(grep -c '^\[skip\]' "$LOG_DIR/main.stdout" 2>/dev/null || echo 0)
FAIL=$((DONE_COUNT - PASS))

# OAuth cap → save remaining list (videos in PAIRS_FILE not in [done]
# lines). Workers that ran but skipped (sentinel) are also remaining.
if [ -f "$LOG_DIR/.oauth_limit_hit" ]; then
  awk '/^\[done\] / {print $2}' "$LOG_DIR/main.stdout" > "$LOG_DIR/_done_vids.txt"
  awk '/^\[skip\] / {print $2}' "$LOG_DIR/main.stdout" >> "$LOG_DIR/_done_vids.txt" 2>/dev/null
  grep -vF -f "$LOG_DIR/_done_vids.txt" "$VID_LIST" > "$LOG_DIR/remaining-vids.txt" || true
  REMAIN=$(wc -l < "$LOG_DIR/remaining-vids.txt" | tr -d ' ')
  echo "[batch-backfill] OAuth cap detected. Remaining=$REMAIN saved: $LOG_DIR/remaining-vids.txt"
fi

ELAPSED=$(( $(date +%s) - START_TS ))
echo "[batch-backfill] DONE total=$TOTAL pass=$PASS fail=$FAIL skip=$SKIP elapsed=${ELAPSED}s"
