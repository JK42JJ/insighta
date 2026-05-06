#!/bin/bash
# CP438+2 (PR #604, 2026-05-06): TTL-based transcript cache cleanup.
#
# Why this exists: process-one.sh deletes the cache only when v2 authoring
# passes. Failed videos (claude_invalid_json, upsert_failed) keep their
# transcript so the next claude -p invocation can re-run for free. Without
# a TTL, these accumulate forever — disk fill + stale data risk. This
# script enforces the 30-day retention boundary that justifies the policy
# vs the "transcripts NEVER persisted" legal directive (cache != persistence
# only when bounded).
#
# Schedule: LaunchAgent daily at 03:00 (Mac Mini ops window).
# Manual run: bash cleanup-transcript-cache.sh [--dry-run]

set -uo pipefail

CACHE_DIR="${TRANSCRIPT_CACHE_DIR:-$HOME/.insighta/transcript-cache}"
TTL_DAYS="${TRANSCRIPT_CACHE_TTL_DAYS:-30}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

if [ ! -d "$CACHE_DIR" ]; then
  echo "[cache-cleanup] cache dir not found: $CACHE_DIR — nothing to do"
  exit 0
fi

BEFORE=$(find "$CACHE_DIR" -type f -name '*.txt' | wc -l | tr -d ' ')
EXPIRED=$(find "$CACHE_DIR" -type f -name '*.txt' -mtime +"$TTL_DAYS" | wc -l | tr -d ' ')

if [ "$DRY_RUN" = "1" ]; then
  echo "[cache-cleanup] DRY-RUN cache_dir=$CACHE_DIR ttl_days=$TTL_DAYS total=$BEFORE expired=$EXPIRED"
  find "$CACHE_DIR" -type f -name '*.txt' -mtime +"$TTL_DAYS" -print | head -20
  exit 0
fi

find "$CACHE_DIR" -type f -name '*.txt' -mtime +"$TTL_DAYS" -delete
AFTER=$(find "$CACHE_DIR" -type f -name '*.txt' | wc -l | tr -d ' ')
DELETED=$((BEFORE - AFTER))

echo "[cache-cleanup] $(date -u +%FT%TZ) cache_dir=$CACHE_DIR ttl_days=$TTL_DAYS before=$BEFORE deleted=$DELETED after=$AFTER"
