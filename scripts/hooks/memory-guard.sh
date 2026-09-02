#!/bin/bash
# Memory guard (PreToolUse hook for the Bash tool).
#
# Blocks heavy local commands (test runners, type-check, bundling, image builds,
# dependency installs) when the machine is already under memory pressure, when
# swap is already loaded, or when another heavy command is still running anywhere
# on the machine (any session, any worktree).
#
# Why: measured 2026-09-02 on the 24 GB dev machine, one ts-jest worker peaks at
# ~2 GB. Jest's default 13 workers next to a 12 GB container VM pushed the machine
# past RAM + swap ceiling (~30 GB) into a multi-minute stall, twice in one day.
#
# Exit 0 = allow. Exit 2 = block; stderr is returned to the agent.
# Fails open: an internal error allows the command and is logged.
#
# Test injection (used by tests/smoke/hooks/memory-guard.test.ts): when
# MEMORY_GUARD_TEST=1, pressure / swap / running-heavy values are read from
# MEMORY_GUARD_TEST_PRESSURE, MEMORY_GUARD_TEST_LEVEL, MEMORY_GUARD_TEST_SWAP_MB,
# MEMORY_GUARD_TEST_RUNNING instead of the kernel and the process table.
#
# James-only escape hatch: prefix the command with MEMORY_GUARD_BYPASS=1. Every
# bypass is logged. Agents must not use it.

set -u

# Commands that spawn multi-GB worker pools or full compiler programs.
HEAVY_PATTERN='(^|[^[:alnum:]_./-])(jest|vitest|playwright test|tsc( |$)|vite build|npm run build|npm run (test|verify|check)|npm test|npm ci|npm install|docker build|docker buildx build|prisma generate|tsx scripts/(verify|audit))'
# Processes that mean one of those is already running somewhere on the machine.
RUNNING_HEAVY_PATTERN='jest-worker/build/workers/processChild|node_modules/\.bin/(jest|vitest|playwright)|vitest/dist/workers|tsc --noEmit|vite build|docker buildx build|docker build '
# Inspection / remediation commands that mention the heavy tools are always allowed
# (pkill jest under pressure is the fix, not the problem).
INSPECT_PATTERN='^[[:space:]]*(pgrep|pkill|kill|ps|grep|rg|sysctl|top|vm_stat|memory_pressure|cat|tail|head)([[:space:]]|$)'
# kern.memorystatus_vm_pressure_level: 1 = normal, 2 = warning, 4 = critical.
MAX_PRESSURE_LEVEL=1
# kern.memorystatus_level: percent of memory the kernel counts as available
# (free + reclaimable). Measured 39 while a 13-worker Jest run was stalling the
# machine; a fresh multi-GB run needs headroom above that.
MIN_MEMORYSTATUS_LEVEL=45
# Swap in use is logged for the record only: it lags for hours after a spike.
LOG_FILE="${HOME}/.insighta-memory-guard.log"

log() { printf '%s | %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE" 2>/dev/null || true; }

INPUT=$(cat 2>/dev/null || echo '{}')
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")
[ -z "$CMD" ] && exit 0

echo "$CMD" | grep -qE "$HEAVY_PATTERN" || exit 0
echo "$CMD" | grep -qE "$INSPECT_PATTERN" && exit 0

CMD_SHORT=$(echo "$CMD" | tr '\n' ' ' | cut -c1-140)

if echo "$CMD" | grep -q 'MEMORY_GUARD_BYPASS=1'; then
  log "BYPASS | $CMD_SHORT"
  exit 0
fi

if [ "${MEMORY_GUARD_TEST:-0}" = "1" ]; then
  PRESSURE="${MEMORY_GUARD_TEST_PRESSURE:-1}"
  LEVEL="${MEMORY_GUARD_TEST_LEVEL:-80}"
  SWAP_USED_MB="${MEMORY_GUARD_TEST_SWAP_MB:-0}"
  RUNNING="${MEMORY_GUARD_TEST_RUNNING:-}"
else
  PRESSURE=$(sysctl -n kern.memorystatus_vm_pressure_level 2>/dev/null || echo 1)
  LEVEL=$(sysctl -n kern.memorystatus_level 2>/dev/null || echo 100)
  case "$LEVEL" in ''|*[!0-9]*) LEVEL=100 ;; esac
  SWAP_RAW=$(sysctl -n vm.swapusage 2>/dev/null | sed -E 's/.*used = ([0-9]+)(\.[0-9]+)?M.*/\1/' || echo 0)
  SWAP_USED_MB=${SWAP_RAW:-0}
  case "$SWAP_USED_MB" in ''|*[!0-9]*) SWAP_USED_MB=0 ;; esac
  RUNNING=$(ps -axo pid=,args= 2>/dev/null | grep -E "$RUNNING_HEAVY_PATTERN" | grep -vE 'grep -E|memory-guard' | head -3 | cut -c1-110)
fi

REASON=""
if [ "$PRESSURE" -gt "$MAX_PRESSURE_LEVEL" ] 2>/dev/null; then
  REASON="kernel memory pressure level ${PRESSURE} (1 = normal, 2 = warning, 4 = critical)"
elif [ "$LEVEL" -lt "$MIN_MEMORYSTATUS_LEVEL" ] 2>/dev/null; then
  REASON="kernel memorystatus level ${LEVEL}% < ${MIN_MEMORYSTATUS_LEVEL}% available"
elif [ -n "$RUNNING" ]; then
  REASON="another heavy command is still running: $(echo "$RUNNING" | head -1)"
fi

if [ -z "$REASON" ]; then
  exit 0
fi

log "BLOCK | pressure=${PRESSURE} level=${LEVEL} swap_used_mb=${SWAP_USED_MB} | ${REASON} | ${CMD_SHORT}"
cat >&2 <<MSG
MEMORY GUARD: heavy command blocked.
  reason: ${REASON}
  now:    pressure=${PRESSURE} memorystatus_level=${LEVEL}% swap_used=${SWAP_USED_MB}MB
  This machine stalls for minutes when a second multi-GB process starts (24 GB RAM, ~6 GB swap ceiling).
  Do not retry in a loop and do not bypass. Wait until 'sysctl kern.memorystatus_vm_pressure_level' is 1 and
  no other test/build is running, or stop the other run, or report to James. Log: ${LOG_FILE}
MSG
exit 2
