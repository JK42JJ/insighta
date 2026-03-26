#!/usr/bin/env bash
# cc-save-context.sh — Consolidate /save Step 1 bash calls into 1 invocation
# Replaces git log + git diff + git status + tail calls.
# Usage: bash scripts/cc-save-context.sh [last-checkpoint-hash]

set -euo pipefail

MEMORY_DIR="$HOME/.claude/projects/-Users-jeonhokim-cursor-insighta/memory"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LAST_HASH="${1:-}"

echo "=== GIT CHANGES ==="
echo "--- log ---"
if [[ -n "$LAST_HASH" ]]; then
  git -C "$PROJECT_DIR" log --oneline "${LAST_HASH}..HEAD" 2>/dev/null || echo "(no new commits)"
else
  git -C "$PROJECT_DIR" log --oneline -10 2>/dev/null || echo "(no commits)"
fi
echo "--- diff ---"
git -C "$PROJECT_DIR" diff --stat 2>/dev/null || echo "(clean)"
echo "--- status ---"
git -C "$PROJECT_DIR" status -s 2>/dev/null || echo "(clean)"

echo ""
echo "=== MEMORY STATE ==="
echo "--- memory-lines ---"
MEMORY_LINES=$(wc -l < "$MEMORY_DIR/MEMORY.md" 2>/dev/null | tr -d ' ')
echo "${MEMORY_LINES}/200"
echo "--- checkpoint-tail ---"
tail -30 "$MEMORY_DIR/checkpoint.md" 2>/dev/null || echo "(not found)"
echo "--- session-log-tail ---"
tail -5 "$MEMORY_DIR/session-log.md" 2>/dev/null || echo "(not found)"
echo "--- request-journal-tail ---"
tail -10 "$MEMORY_DIR/request-journal.md" 2>/dev/null || echo "(not found)"
echo "--- eval-last ---"
grep -E '^\| [0-9]' "$MEMORY_DIR/eval-scores.md" 2>/dev/null | tail -3 || echo "(no epochs)"
