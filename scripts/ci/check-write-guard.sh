#!/bin/bash
# Data-write reversibility guard (2026-07-14) — INV-DATA-TIMEMACHINE
#
# T10 incident (2026-07-13): a worker OVERWROTE relevance_pct — a field that
# is the INPUT of tone-down/sorting/serving — destroying 141 original values
# with no history. A feature flag only stops FUTURE writes; it cannot undo
# data. Hard rule (memory + supervisor-confirmed): a change that writes to
# EXISTING columns ships only with (a) original-field-immutable design
# (derived/dedicated column), or (b) a snapshot + rollback plan, and (c) a
# statement of whether the target field is another system's input.
#
# CI cannot verify semantics — this is a chokepoint-style declaration check
# (supervisor: PR-template self-report alone is too weak; grep-enforce it):
# when the diff ADDS bulk-write patterns in src/**, the PR body must carry a
# "Data-Write:" declaration block. "Data-Write: none-existing" declares the
# writes target NEW/dedicated columns only (case a).
#
# Env: PR_BODY, BASE_REF (default origin/main).

set -euo pipefail

BASE_REF="${BASE_REF:-origin/main}"
BODY="${PR_BODY:-}"

# Added lines introducing bulk/raw writes (tests excluded).
ADDED_WRITES=$(git diff "${BASE_REF}...HEAD" -- 'src/**/*.ts' ':!src/**/__tests__/**' \
  | grep -E '^\+' \
  | grep -E '\.updateMany\(|\$executeRaw|UPDATE [a-z_]+ SET' || true)

if [ -z "$ADDED_WRITES" ]; then
  echo "write-guard: OK — no new bulk-write patterns"
  exit 0
fi

if echo "$BODY" | grep -qiE 'Data-Write:'; then
  echo "write-guard: OK — Data-Write declaration present"
  exit 0
fi

echo "write-guard: FAIL — new bulk-write pattern(s) without a Data-Write declaration."
echo "New write lines:"
echo "$ADDED_WRITES" | head -10 | sed 's/^/  /'
echo ""
echo "Add a 'Data-Write:' block to the PR body declaring:"
echo "  1) target table.column(s)"
echo "  2) is the field another system's INPUT? (tone-down/sort/serving 등)"
echo "  3) reversibility: dedicated/new column (원본 불변) OR snapshot+rollback plan"
echo "  (writes to new/dedicated columns only → 'Data-Write: none-existing')"
exit 1
