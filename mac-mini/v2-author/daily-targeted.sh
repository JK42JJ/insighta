#!/bin/bash
# CP438+1 Q6 (2026-05-03): daily targeted batch for under-represented domains.
#
# Designed for cron — fires 4×/day at 00:00 / 06:00 / 12:00 / 18:00 UTC,
# each slot author 25 candidates biased toward `social` and `creative`
# domains (current distribution: social=4 / creative=26 / total v2=773).
#
# 100 / day total. Safe under youtube-transcript-api residential-IP load.
#
# Cron entry (run `crontab -e` on Mac Mini):
#   0 0,6,12,18 * * * /Users/jamesjk/code/insighta/mac-mini/v2-author/daily-targeted.sh
#
# Override via env:
#   DAILY_TARGETED_N — candidates per slot (default 25)
#   DAILY_TARGETED_DOMAINS — comma-separated domain slugs (default social,creative)

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
N="${DAILY_TARGETED_N:-25}"
DOMAINS="${DAILY_TARGETED_DOMAINS:-social,creative}"

# Bot-gate hygiene: spread the 25 over the slot rather than burst all at once.
# Run sequentially with conc=1 + 30s sleep between videos. Slow but safer.
export V2_CONCURRENCY=1
export DOMAINS

LOG_DIR="${V2_LOG_DIR:-/tmp/insighta-v2-batch}"
mkdir -p "$LOG_DIR"
TS="$(date -u +%Y%m%d-%H%M%S)"
LOG="$LOG_DIR/daily-targeted-$TS.log"

echo "[daily-targeted] start=$(date -u +%FT%TZ) N=$N domains=$DOMAINS conc=$V2_CONCURRENCY" | tee "$LOG"

bash "$DIR/batch.sh" "$N" >>"$LOG" 2>&1
RC=$?

echo "[daily-targeted] done=$(date -u +%FT%TZ) rc=$RC" | tee -a "$LOG"
exit $RC
