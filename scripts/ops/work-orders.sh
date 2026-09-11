#!/usr/bin/env bash
# List work orders by status, or print the question queue.
#   scripts/ops/work-orders.sh            all, grouped by status
#   scripts/ops/work-orders.sh open       one status
#   scripts/ops/work-orders.sh questions  the queue
set -euo pipefail
DIR="$(cd "$(dirname "$0")/../.." && pwd)/docs/work-orders"
case "${1:-list}" in
  questions) sed -n '1,200p' "$DIR/QUESTIONS.md" ;;
  list|"")
    for st in open running verified draft closed; do
      hits=$(grep -l "^status: $st" "$DIR"/WO-*.md 2>/dev/null || true)
      [ -n "$hits" ] || continue
      printf '\n[%s]\n' "$st"
      for f in $hits; do
        printf '  %-48s %s\n' "$(basename "$f" .md)" "$(grep -m1 '^# 목표' -A1 "$f" | tail -1 | cut -c1-90)"
      done
    done ;;
  *) grep -l "^status: $1" "$DIR"/WO-*.md 2>/dev/null | xargs -n1 basename | sed 's/\.md$//' ;;
esac
