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

# Only gate on push/PR commands. `git -C <dir> push` is a push too.
# The command must actually run one: the words inside a here-document body (a script or a note
# being written to a file) are text, not a command, and the match must sit where a command can
# start (line start, after ; & | ( or an opening quote as in `bash -c "git push"`), optionally
# after VAR=value prefixes. Before 2026-11-23 any command that merely mentioned "git push" was
# judged as a push.
CMD_CODE="$(printf '%s' "$CMD" | perl -0pe 's/<<-?[ \t]*(["\x27]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n.*?\n[ \t]*\2[ \t]*(?=\n|$)/\n/sg' 2>/dev/null || printf '%s' "$CMD")"
PUSH_RE='(^|[;&|(`"'"'"'][[:space:]]*)([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*(git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+push|gh[[:space:]]+pr[[:space:]]+create|gh[[:space:]]+pr[[:space:]]+merge)([[:space:]]|$)'
if ! printf '%s\n' "$CMD_CODE" | grep -qE "$PUSH_RE"; then
  exit 0
fi

# A block must reach Claude Code as exit code 2 with the reason on stderr. Exit code 1 with the
# reason on stdout (as this hook did until 2026-11-23) is shown as a "hook error" and the command
# runs anyway, so the gate blocked nothing.
block() {
  echo "$1" >&2
  [ -n "${2:-}" ] && echo "$2" >&2
  exit 2
}

# The branch being pushed may live in a worktree rather than in this hook's
# working directory: a command that starts with `cd <dir> &&` or uses
# `git -C <dir>` is judged against that directory, or the gate would read the
# wrong checkout's HEAD and diff (2026-09-15, brief panel PR).
# `|| true`: under `set -o pipefail` a non-matching grep would otherwise abort
# the hook with no message, which blocks every plain `git push`.
REPO_DIR="$(echo "$CMD" | grep -oE '(^|[;&|][[:space:]]*)cd[[:space:]]+[^[:space:];&|]+' | head -1 | sed -E 's/.*cd[[:space:]]+//' || true)"
if [ -z "$REPO_DIR" ]; then
  REPO_DIR="$(echo "$CMD" | grep -oE 'git[[:space:]]+-C[[:space:]]+[^[:space:]]+' | head -1 | sed -E 's/.*-C[[:space:]]+//' || true)"
fi
REPO_DIR="${REPO_DIR/#\~/$HOME}"
if [ -n "$REPO_DIR" ] && [ -d "$REPO_DIR" ]; then
  cd "$REPO_DIR" || block "🚫 BLOCKED: cannot enter $REPO_DIR to check the push." 
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
  block "🚫 BLOCKED: Frontend files changed but /verify was not run." "Run /verify first, then retry."
fi

# Parse marker: "PASS <timestamp> <commit-sha>"
MARKER_TS=$(awk '{print $2}' "$MARKER" 2>/dev/null || echo "0")
MARKER_SHA=$(awk '{print $3}' "$MARKER" 2>/dev/null || echo "none")
CURRENT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
NOW=$(date +%s)

# Expired? (10 minute window)
ELAPSED=$((NOW - MARKER_TS))
if [ "$ELAPSED" -gt 600 ]; then
  block "🚫 BLOCKED: /verify result expired (${ELAPSED}s ago, max 600s). Run /verify again." "The marker is read before the command runs: write it in an earlier command, not in the same one as the push."
fi

# Different commit?
if [ "$MARKER_SHA" != "$CURRENT_SHA" ]; then
  block "🚫 BLOCKED: /verify ran on $(echo "$MARKER_SHA" | head -c 7) but HEAD is $(echo "$CURRENT_SHA" | head -c 7). Run /verify again."
fi

echo "✅ /verify PASS confirmed ($(echo "$CURRENT_SHA" | head -c 7), ${ELAPSED}s ago). Proceeding."
exit 0
