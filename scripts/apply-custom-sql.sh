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
  "prisma/migrations/ontology/013_drop_trg_structural_edges_level.sql"
  "prisma/migrations/ontology/014_fix_trigger_seq_scans.sql"
  "prisma/migrations/ontology/016_mentions_similar_to_relation_types.sql"
  "prisma/migrations/ontology/017_fix_sync_mandala_seqscan.sql"
  "prisma/migrations/mandala-timings/001_create_table.sql"
  "prisma/migrations/video_chunk_embeddings/001_create_table.sql"
  "prisma/migrations/video_rich_summaries/001_add_user_id.sql"
  "prisma/migrations/wizard-precompute/001_table.sql"
  "prisma/migrations/pipeline-events/001_create_pipeline_events.sql"
  "prisma/migrations/note_documents/001_create_table.sql"
  "prisma/migrations/video_pool/001_add_tsvector_gin_index.sql"
  "prisma/migrations/discover-traces/001_create_video_discover_traces.sql"
  "prisma/migrations/billing/001_billing_subscriptions.sql"
  "prisma/migrations/billing/002_billing_events.sql"
  "prisma/migrations/system-settings/001_system_settings.sql"
  "prisma/migrations/video_pool/002_add_ivfflat_index.sql"
  "prisma/migrations/mandala_embeddings/001_add_ivfflat_index.sql"
  # CP462+ Issue #649 — Card preference signal (heart/archive/delete) +
  # mandala_relevance_pct 0-100 single fit score. Both files use
  # IF NOT EXISTS / DO $$ EXCEPTION duplicate_object NULL — idempotent
  # re-application is safe.
  "prisma/migrations/card-interactions/001_create_table.sql"
  "prisma/migrations/rich-summary-v2/005_mandala_relevance_pct.sql"
  # CP474 — v2 regen gate based on transcript_used (boolean). ADD COLUMN
  # IF NOT EXISTS + idempotent backfill (WHERE transcript_used = false).
  "prisma/migrations/rich-summary-v2/006_add_transcript_used.sql"
  # CP466 — Add Cards Phase 1 (surfacing). `surfaced_at` column + partial
  # index on user_video_states for Layer 1 Coverage dedup. ADD COLUMN IF
  # NOT EXISTS / CREATE INDEX IF NOT EXISTS — idempotent.
  "prisma/migrations/add-cards/001_user_video_states_surfacing_cols.sql"
  # CP474 — Promote auto-added + Heart-pinned rows to user-owned
  # (auto_added=false). Cleans up 120 historical rows that misrepresent
  # their origin; idempotent (subsequent runs match 0 rows).
  "prisma/migrations/user-video-states-cleanup/001_promote_pinned_auto_added.sql"
  # CP474 — youtube_videos 14 missing fields from videos.list. ADD COLUMN
  # IF NOT EXISTS — idempotent.
  "prisma/migrations/youtube-metadata-completeness/001_add_columns.sql"
  # CP488 — Search Quality Overhaul (D11 measurement oracle + D8 backlog +
  # D5 user_curated source documentation). All 3 files use
  # CREATE TABLE/COLUMN/INDEX IF NOT EXISTS + ON CONFLICT DO NOTHING +
  # DO $$ guarded FK creation — fully idempotent.
  "prisma/migrations/search-quality-overhaul/001_algo_versions_catalog.sql"
  "prisma/migrations/search-quality-overhaul/002_trace_run_mandala_cols.sql"
  "prisma/migrations/search-quality-overhaul/003_surfaced_at_user_curated.sql"
  # CP488 FLAG sub-PR — seed v0-pre-cp488 + update v1-current with explicit
  # boolean flags so admin can toggle the 3 CP488 hardenings on/off.
  "prisma/migrations/search-quality-overhaul/004_v0_pre_cp488_seed.sql"
  # CP488+ (2026-05-26) — video_pool.depth_level + companion columns for
  # search-time difficulty filtering. ADD COLUMN IF NOT EXISTS +
  # CREATE INDEX IF NOT EXISTS — fully idempotent.
  "prisma/migrations/video-pool-depth-level/001_add_columns.sql"
  # CP488+ (2026-05-27) — v2 Quality Audit Phase 1 MVP. 3 tables wrapped
  # in BEGIN/COMMIT, every CREATE TABLE / CREATE INDEX uses IF NOT EXISTS
  # — re-application safely no-ops. Default OFF behaviourally
  # (V2_QUALITY_AUDIT_ENABLED=false), so empty tables on prod until
  # operator flips the flag.
  "prisma/migrations/v2-quality-audit/001_create_audit_tables.sql"
  # CP489 (2026-05-28) — center_goal embedding cache (level=0) partial
  # unique index. Enables ON CONFLICT in
  # src/modules/mandala/center-goal-embedding.ts so concurrent add-cards
  # calls race-safely upsert one level=0 row per mandala. CREATE UNIQUE
  # INDEX IF NOT EXISTS — idempotent.
  "prisma/migrations/center-goal-cache/001_partial_unique_level0.sql"
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
