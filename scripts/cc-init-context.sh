#!/usr/bin/env bash
# cc-init-context.sh — Consolidate /init Phase 2.5-4 bash calls into 1 invocation
# Replaces 15+ individual Bash tool calls with structured JSON-like output.
# Usage: bash scripts/cc-init-context.sh

set -euo pipefail

MEMORY_DIR="$HOME/.claude/projects/-Users-jeonhokim-cursor-insighta/memory"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== GIT STATUS ==="
echo "--- log ---"
git -C "$PROJECT_DIR" log --oneline -5 2>/dev/null || echo "(no commits)"
echo "--- diff ---"
git -C "$PROJECT_DIR" diff --stat 2>/dev/null || echo "(clean)"
echo "--- status ---"
git -C "$PROJECT_DIR" status -s 2>/dev/null || echo "(clean)"
echo "--- stash ---"
git -C "$PROJECT_DIR" stash list 2>/dev/null || echo "(no stash)"

echo ""
echo "=== GITHUB ==="
echo "--- stories ---"
gh issue list --state open --label story --json number,title --jq '.[] | "#\(.number): \(.title)"' 2>/dev/null || echo "(none)"
echo "--- ci ---"
gh run list --limit 2 --json status,conclusion,name,createdAt --jq '.[] | "\(.name) | \(.status) | \(.conclusion // "—") | \(.createdAt)"' 2>/dev/null || echo "(unavailable)"
echo "--- prs ---"
gh pr list --json number,title,state --jq '.[] | "#\(.number): \(.title) [\(.state)]"' 2>/dev/null || echo "(none)"

echo ""
echo "=== TMUX ==="
tmux list-panes -t tubearchive -F '#{pane_index}: #{pane_width}x#{pane_height} #{pane_current_command}' 2>/dev/null || echo "tmux: not in session"
echo "--- ops-dashboard ---"
tmux capture-pane -t tubearchive:1.3 -p -S -40 2>/dev/null || echo "(capture failed)"
echo "--- agent-dashboard ---"
AGENT_OUT=$(tmux capture-pane -t tubearchive:1.2 -p -S -10 2>/dev/null || echo "")
if echo "$AGENT_OUT" | grep -q "No task directory" 2>/dev/null; then
  echo "idle (skipped)"
else
  tmux capture-pane -t tubearchive:1.2 -p -S -40 2>/dev/null || echo "(capture failed)"
fi

echo ""
echo "=== AGENT-NATIVE SCAN ==="
echo "--- api-routes ---"
ls "$PROJECT_DIR/src/api/routes/" 2>/dev/null || echo "(none)"
echo "--- edge-functions ---"
ls "$PROJECT_DIR/supabase/functions/" 2>/dev/null || echo "(none)"
echo "--- test-counts ---"
BACKEND_TESTS=$(find "$PROJECT_DIR/tests/" -name '*.test.ts' 2>/dev/null | wc -l | tr -d ' ')
FRONTEND_TESTS=$(find "$PROJECT_DIR/frontend/src" -name '*.test.ts' -o -name '*.test.tsx' 2>/dev/null | wc -l | tr -d ' ')
E2E_TESTS=$(find "$PROJECT_DIR/frontend/tests/" "$PROJECT_DIR/tests/" -name '*.spec.ts' 2>/dev/null | wc -l | tr -d ' ')
echo "backend: $BACKEND_TESTS | frontend: $FRONTEND_TESTS | e2e: $E2E_TESTS"
echo "--- test-md ---"
test -f "$PROJECT_DIR/tests/TEST.md" && echo "exists" || echo "missing"

echo ""
echo "=== MEMORY HEALTH ==="
MEMORY_LINES=$(wc -l < "$MEMORY_DIR/MEMORY.md" 2>/dev/null | tr -d ' ')
echo "MEMORY.md: ${MEMORY_LINES}/200"
echo "--- open-requests ---"
grep -E '\| (wip|noted) \|' "$MEMORY_DIR/request-journal.md" 2>/dev/null || echo "(none)"
echo "--- checkpoint-tail ---"
tail -30 "$MEMORY_DIR/checkpoint.md" 2>/dev/null || echo "(not found)"
echo "--- session-log-tail ---"
tail -5 "$MEMORY_DIR/session-log.md" 2>/dev/null || echo "(not found)"
echo "--- eval-tail ---"
grep -E '^\| [0-9]' "$MEMORY_DIR/eval-scores.md" 2>/dev/null | tail -3 || echo "(no epochs)"
