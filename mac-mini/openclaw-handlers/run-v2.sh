#!/bin/bash
# OpenClaw /v2 N handler (CP438).
# Dispatches mac-mini/v2-author/batch.sh — yt-dlp → claude -p → upsert-direct.
# Auto-promote to video_pool fires inside upsert-direct (PR #588 hook).
#
# Usage:
#   bash run-v2.sh           # default N=10
#   bash run-v2.sh 50        # author 50 v2 summaries this batch
#   V2_CONCURRENCY=3 bash run-v2.sh 50

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_bootstrap.sh
source "$DIR/_bootstrap.sh"

N="${1:-10}"
exec bash "$INSIGHTA_REPO/mac-mini/v2-author/batch.sh" "$N"
