# Shared helpers for the lab scripts.
#
# Sourced, never executed. Every lab uses the same three devices:
#
#   step  — a numbered heading, so you know where you are
#   say   — plain prose explaining what is about to happen and why
#   run   — prints the command, then runs it
#
# `run` is the important one. The point of these labs is not that a script
# produces output; it is that you see the exact command that produced it and
# can type it yourself afterwards. Anything a lab does, you could do by hand.
#
# The printed command is therefore quoted so it can be copied and pasted
# verbatim. An earlier version printed the arguments bare, which turned
#   ssh.sh k3s "hostname && uptime"
# into
#   ssh.sh k3s hostname && uptime
# — a different command, and one that runs `uptime` on the wrong machine.

set -uo pipefail

# Colours are switched off when the output is not a terminal, so piping a lab
# into a file or into `less` gives clean text.
if [ -t 1 ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; CYAN=$'\033[36m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; RED=$'\033[31m'; R=$'\033[0m'
else
  B=''; DIM=''; CYAN=''; GREEN=''; YELLOW=''; RED=''; R=''
fi

LAB_STEP=0
LAB_RULE='──────────────────────────────────────────────────────────────────────'

# No attempt is made to pad text to a right-hand border: Hangul occupies two
# terminal columns per character but one byte-length unit, so any such padding
# is wrong for exactly the text this project writes.
lab_title() {
  printf '\n%s%s%s\n' "$CYAN" "$LAB_RULE" "$R"
  printf '%s%s%s\n' "$B" "$1" "$R"
  [ $# -ge 2 ] && printf '%s%s%s\n' "$DIM" "$2" "$R"
  printf '%s%s%s\n' "$CYAN" "$LAB_RULE" "$R"
}

step() {
  LAB_STEP=$((LAB_STEP + 1))
  printf '\n%s%s %d. %s%s\n' "$B" "──" "$LAB_STEP" "$1" "$R"
}

say() { printf '%s\n' "$*" | fold -s -w 76 | sed 's/^/   /'; }

# Quote one argument for display so the printed line is copy-pasteable.
_q() {
  case "$1" in
    '' ) printf "''" ;;
    *[!a-zA-Z0-9/._=:@-]* ) printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")" ;;
    * ) printf '%s' "$1" ;;
  esac
}

run() {
  local disp='' a
  for a in "$@"; do disp="$disp $(_q "$a")"; done
  printf '\n%s   $%s%s\n' "$GREEN" "$disp" "$R"
  "$@" 2>&1 | sed 's/^/     /'
  return "${PIPESTATUS[0]}"
}

# Same as run, but for a shell pipeline that must be passed as one string.
runsh() {
  printf '\n%s   $ %s%s\n' "$GREEN" "$1" "$R"
  bash -c "$1" 2>&1 | sed 's/^/     /'
}

note() { printf '\n%s   NOTE  %s%s\n' "$YELLOW" "$*" "$R"; }
warn() { printf '\n%s   CAUTION  %s%s\n' "$RED" "$*" "$R"; }

done_msg() { printf '\n%s   ✓ %s%s\n\n' "$GREEN" "$1" "$R"; }

# Resolve the repository root from this file's location, so a lab can be run
# from any directory.
LAB_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SSH="$LAB_REPO/scripts/ops/ssh.sh"

# Every cluster read goes through this. It exists so no lab ever contains a
# hostname or an IP address: `ssh.sh` looks the address up from AWS by tag at
# the moment you run it. When an address changes, nothing here needs editing.
k() { bash "$SSH" k3s "sudo k3s kubectl $*" 2>&1 | grep -viE '^\[ssh\]'; }

# Display form of the same call, for labs that want to show `kubectl ...`
# rather than the SSH wrapper that carries it.
kshow() {
  printf '\n%s   $ kubectl %s%s\n' "$GREEN" "$*" "$R"
  k "$@" | sed 's/^/     /'
}

require_cluster() {
  if ! bash "$SSH" k3s "sudo k3s kubectl version --output=json >/dev/null" >/dev/null 2>&1; then
    warn "클러스터에 닿지 않습니다. 먼저 lab01 을 실행해 접속 경로를 확인하세요."
    exit 1
  fi
}
