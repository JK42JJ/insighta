#!/bin/bash
# PreToolUse hook — require explicit user approval marker before
# `gh pr merge` and `git push --force` (and `--force-with-lease`).
#
# CP462 /retro 12th #2 → CP463 ship: memory-only "계획 → 승인 → 실행"
# rule failed 5+ times across CP421~CP461 ("계획→승인→실행 위반 1건 PR #648
# 명시 승인 없이 머지"). This hook adds a hard friction step that forces
# Claude (or any caller) to surface the irreversible action one more
# time before it commits.
#
# Allowed forms:
#   • INSIGHTA_USER_OK=1 gh pr merge <N> --squash       (Claude must add env after user "ok")
#   • INSIGHTA_USER_OK=1 git push --force-with-lease    (only after user 's typed "ok"/"approved"/"머지")
#   • plain `git push` (non-force) is NOT blocked — verify-gate.sh handles FE marker
#   • read-only `gh pr view / list / checks` not blocked
#
# Telemetry: every bypass appends a row to
#   ~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/.approval-gate.log
# so /retro can audit how often the env was used and whether the surrounding
# user message actually contained an explicit approval token.

set -euo pipefail

INPUT=$(cat 2>/dev/null || echo '{}')
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")

LOG="$HOME/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/.approval-gate.log"

# `gh pr merge <N>` (squash/rebase/merge) — irreversible to public main
if echo "$CMD" | grep -qE '\bgh[[:space:]]+pr[[:space:]]+merge\b'; then
  if [ "${INSIGHTA_USER_OK:-}" = "1" ]; then
    printf '%s gh-pr-merge bypass cmd=%q\n' "$(date -u +%FT%TZ)" "$CMD" >> "$LOG" 2>/dev/null || true
    exit 0
  fi
  cat <<'EOF' >&2
🚫 BLOCKED: `gh pr merge` requires explicit user approval marker.

CP462 /retro 12th #2 — memory-only "계획→승인→실행" enforcement failed
5+ times. This hook makes irreversible merges visible.

Re-run with the approval env:
  INSIGHTA_USER_OK=1 gh pr merge <N> --squash --delete-branch

Only do so after the user has typed an explicit "ok" / "approved" /
"머지" / "진행" in chat for THIS specific PR. The bypass is logged to
~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/.approval-gate.log
for /retro audit.
EOF
  exit 1
fi

# Force push — irreversible to remote history
if echo "$CMD" | grep -qE '\bgit[[:space:]]+push\b.*--force(-with-lease)?\b'; then
  if [ "${INSIGHTA_USER_OK:-}" = "1" ]; then
    printf '%s git-force-push bypass cmd=%q\n' "$(date -u +%FT%TZ)" "$CMD" >> "$LOG" 2>/dev/null || true
    exit 0
  fi
  cat <<'EOF' >&2
🚫 BLOCKED: `git push --force` requires explicit user approval marker.

Re-run with:
  INSIGHTA_USER_OK=1 git push --force-with-lease <remote> <branch>

Force-push rewrites remote history. Only after user explicit "ok".
EOF
  exit 1
fi

exit 0
