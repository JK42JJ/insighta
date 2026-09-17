#!/usr/bin/env bash
#
# check-sql-allowlist.sh — a new raw DDL file has to be in the runner's allowlist.
#
# `prisma db push` silent-fails on Supabase when a statement touches an
# auth-owned table: it reports success and the new public tables are simply
# absent. The project's answer is raw DDL under prisma/migrations/<ns>/, applied
# by scripts/apply-custom-sql.sh — which runs an explicit allowlist, not a glob.
#
# PR #1632 shipped eighteen tables of DDL and did not touch that allowlist. The
# file sat in the repo, the runner never opened it, and the failure surfaced at
# deploy time as seventeen missing tables. That is the sixth recurrence of this
# class, so it gets a check rather than another line in a memory file.
#
# The check is narrow on purpose: it looks only at files this branch ADDS. The
# sixty-odd DDL files already applied in the past are not in the allowlist and
# do not need to be.
set -euo pipefail

BASE="${1:-origin/main}"
RUNNER="scripts/apply-custom-sql.sh"

added="$(git diff --name-only --diff-filter=A "$BASE"...HEAD -- 'prisma/migrations/**/*.sql' || true)"
[ -z "$added" ] && { echo "No new raw DDL in this branch."; exit 0; }

missing=()
while IFS= read -r f; do
  [ -z "$f" ] && continue
  grep -qF "\"$f\"" "$RUNNER" || missing+=("$f")
done <<< "$added"

if [ ${#missing[@]} -gt 0 ]; then
  echo "::error::New raw DDL is not in $RUNNER's allowlist, so the deploy will never apply it:"
  for f in "${missing[@]}"; do echo "  - $f"; done
  echo ""
  echo "Add each path to APPLY_FILES (or to the skip list with a reason)."
  echo "Make the file idempotent first — it runs on every deploy."
  exit 1
fi

echo "New raw DDL is in the allowlist:"
while IFS= read -r f; do [ -n "$f" ] && echo "  - $f"; done <<< "$added"
