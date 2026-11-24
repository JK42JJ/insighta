#!/usr/bin/env bash
# thursday-verify.sh — DRAFT, not executed yet.
# Runs every command in verify-commands.tsv once and writes a results table.
#   green: the command must pass on main today (proves the environment can run it)
#   red:   the command must FAIL today (proves the path and the runner are right; the
#          test or file it names is not written yet)
# Anything else is BROKEN: fix the environment or drop the task that depends on it.
# Prints no environment variables and needs no secrets.
set -u
TSV="${1:-verify-commands.tsv}"
OUT="${2:-thursday-results.md}"
TIMEOUT_S="${TIMEOUT_S:-1800}"

{
  echo "# Thursday verify run"
  echo
  echo "- run at: $(date -u +%FT%TZ), commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "- machine: $(nproc) cores, $(free -g 2>/dev/null | awk '/Mem:/{print $2}') GB RAM"
  echo
  echo "| id | expect | exit | verdict | last output |"
  echo "|---|---|---|---|---|"
} > "$OUT"

while IFS=$'\t' read -r id expect cmd; do
  case "$id" in ''|\#*) continue ;; esac
  log="$(mktemp)"
  if command -v timeout >/dev/null 2>&1; then
    timeout "$TIMEOUT_S" bash -c "$cmd" >"$log" 2>&1; rc=$?
  else
    bash -c "$cmd" >"$log" 2>&1; rc=$?
  fi
  case "$expect" in
    green) if [ "$rc" -eq 0 ]; then verdict="OK"; else verdict="BROKEN (should pass)"; fi ;;
    red)   if [ "$rc" -ne 0 ]; then verdict="OK (red as expected)"; else verdict="BROKEN (should fail)"; fi ;;
    *)     verdict="SKIP" ;;
  esac
  last="$(tail -n 2 "$log" | tr '\n|' ' /' | cut -c1-110)"
  echo "| $id | $expect | $rc | $verdict | $last |" >> "$OUT"
  rm -f "$log"
done < "$TSV"

echo "wrote $OUT"
echo "BROKEN rows: $(grep -c 'BROKEN' "$OUT")"
