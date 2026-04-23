#!/usr/bin/env bash
# ============================================================================
# apply-custom-sql.sh — Idempotent raw SQL runner (LEVEL-3 Hard Rule automation)
# ============================================================================
# Context: `prisma db push` silent-fails on Supabase auth-owned tables, dropping
# ALL new public tables without error. CLAUDE.md LEVEL-3 Hard Rule mandates
# feature-namespace raw SQL DDL under prisma/migrations/<ns>/NNN_*.sql with
# previously-manual psql application. This script automates that step under
# a strict allowlist of files verified idempotent at CP421.
#
# Idempotency contract: every listed file MUST use IF EXISTS / IF NOT EXISTS /
# CREATE OR REPLACE / ON CONFLICT DO NOTHING patterns. Adding a non-idempotent
# file will fail every subsequent deploy.
#
# Required env:
#   DIRECT_URL       — Supabase DIRECT connection URL (NOT pooler; needs DDL).
#
# Optional env:
#   SKIP_SQL_FILES   — space-separated list of allowlist paths to skip for
#                      this run. Used as emergency escape hatch when a specific
#                      file needs temporary disable without reverting the PR.
#                      Example (workflow_dispatch input or repo variable):
#                        SKIP_SQL_FILES="prisma/migrations/ontology/009_backfill_edges.sql"
#                      or to skip multiple:
#                        SKIP_SQL_FILES="prisma/migrations/ontology/009_backfill_edges.sql prisma/migrations/ontology/011_drop_edge_triggers.sql"
#                      Paths must match APPLY_FILES entries exactly.
#
# Safety:
#   - ON_ERROR_STOP=1 — first SQL error halts the script (no partial pass).
#   - statement_timeout=180000 (3 min) — 009 cold-run margin at current scale.
#   - verify-db-tables.js (subsequent step) remains the final safety net.
# ============================================================================

set -euo pipefail

if [ -z "${DIRECT_URL:-}" ]; then
  echo "::error::DIRECT_URL not set"
  exit 1
fi

# Strict allowlist (relative to repo root). Order matters — dependency first.
# CP421 probe verified every file is safe to re-run against current prod state.
#
# NOTE: 009_backfill_edges.sql — intentionally excluded at CP421.
#   CP421 read-only prod probe (breakdown of ontology.edges by src/tgt node
#   type) showed Query 1/2/3 of 009 would insert ~25k new CONTAINS / PLACED_IN
#   edges on first run (Query 4 alone is already pre-applied as ~103k
#   sector→topic edges). That is a scope + runtime (+5–15s) + side-effect
#   expansion beyond this PR's objective (deploy automation +
#   mandala_create_timings). 009 also happens to be untracked today; a later
#   PR can `git add` it and re-include after an edge-ownership policy review
#   (Lever A+ aftermath) confirms the backfill is desired.
APPLY_FILES=(
  "prisma/migrations/ontology/006_graph_functions.sql"
  "prisma/migrations/ontology/011_drop_edge_triggers.sql"
  "prisma/migrations/ontology/012_drop_goal_topic_node_triggers.sql"
  "prisma/migrations/mandala-timings/001_create_table.sql"
  "prisma/migrations/video_chunk_embeddings/001_create_table.sql"
)

SKIP_FILES=" ${SKIP_SQL_FILES:-} "
export PGOPTIONS="-c statement_timeout=180000"

for f in "${APPLY_FILES[@]}"; do
  if [[ "$SKIP_FILES" == *" $f "* ]]; then
    echo "::warning::Skipping $f (matched SKIP_SQL_FILES)"
    continue
  fi
  if [ ! -f "$f" ]; then
    echo "::error::Missing SQL file: $f"
    exit 1
  fi
  echo "::group::Applying $f"
  psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f "$f"
  echo "::endgroup::"
done

echo "Custom SQL migrations applied (${#APPLY_FILES[@]} files in allowlist)."
