#!/bin/bash
# OpenClaw /v2 N handler (CP438 — placeholder).
#
# Spec (handoff §5):
#   1. Fetch top N transcript-ready candidates from EC2
#      (GET /api/v1/internal/transcript/candidates?limit=N).
#   2. Mac Mini yt-dlp transcript collection (mac-mini/transcript-collector/collect.ts).
#   3. CC (Claude Code session) authors v2 layered JSON per video.
#   4. POST upsert-direct to EC2.
#   5. Trigger ontology bridge.
#   6. Telegram report: "v2 완료 N개, S=0.xxx".
#
# Step 3 requires Claude Code session on Mac Mini; not yet wired. This
# handler currently runs only step 1 + step 2 and leaves transcripts in
# the staging dir for manual CC review.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_bootstrap.sh
source "$DIR/_bootstrap.sh"

N="${1:-10}"

echo "[run-v2] phase 1 — fetch transcript candidates (N=$N)"
TRANSCRIPT_BATCH_SIZE="$N" npx tsx mac-mini/transcript-collector/collect.ts 2>&1 | tail -20

echo ""
echo "[run-v2] phase 2 — staging dir contents"
STAGE_DIR="${TRANSCRIPT_OUTPUT_DIR:-/tmp/insighta-transcripts}"
ls -la "$STAGE_DIR" 2>/dev/null | head -20 || echo "(staging dir empty or missing: $STAGE_DIR)"

echo ""
echo "[run-v2] CC v2 author + upsert + ontology = manual step (not yet automated)."
echo "Operator next: open CC session on Mac Mini, run ${INSIGHTA_REPO}/scripts/v2-author-batch.ts (TBD)."
