#!/bin/bash
# Pre-push verification gate (PreToolUse hook)
#
# Blocks `git push`, `gh pr create`, `gh pr merge` when frontend files
# are changed and /verify has not been run (or result expired/mismatched).
#
# Created: 2026-04-17 after two consecutive prod regressions (PR #403, #404)
# shipped without browser verification.

set -euo pipefail

# Read tool input from stdin (Claude Code PreToolUse hook JSON)
INPUT=$(cat 2>/dev/null || echo '{}')
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")

# Only gate on push/PR commands
if ! echo "$CMD" | grep -qE 'git push|gh pr create|gh pr merge'; then
  exit 0
fi

# Check if any frontend files changed vs main
CHANGED=$(git diff --name-only origin/main...HEAD 2>/dev/null || echo "")
if ! echo "$CHANGED" | grep -q 'frontend/src/'; then
  # No frontend changes → pass through
  exit 0
fi

# Frontend files changed — verify marker required
MARKER="/tmp/.verify-pass"

if [ ! -f "$MARKER" ]; then
  echo "🚫 BLOCKED: Frontend files changed but /verify was not run."
  echo "Run /verify first, then retry."
  exit 1
fi

# Parse marker: "PASS <timestamp> <commit-sha>"
MARKER_TS=$(awk '{print $2}' "$MARKER" 2>/dev/null || echo "0")
MARKER_SHA=$(awk '{print $3}' "$MARKER" 2>/dev/null || echo "none")
CURRENT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
NOW=$(date +%s)

# Expired? (10 minute window)
ELAPSED=$((NOW - MARKER_TS))
if [ "$ELAPSED" -gt 600 ]; then
  echo "🚫 BLOCKED: /verify result expired (${ELAPSED}s ago, max 600s). Run /verify again."
  exit 1
fi

# Different commit?
if [ "$MARKER_SHA" != "$CURRENT_SHA" ]; then
  echo "🚫 BLOCKED: /verify ran on $(echo "$MARKER_SHA" | head -c 7) but HEAD is $(echo "$CURRENT_SHA" | head -c 7). Run /verify again."
  exit 1
fi

echo "✅ /verify PASS confirmed ($(echo "$CURRENT_SHA" | head -c 7), ${ELAPSED}s ago). Proceeding."
exit 0
