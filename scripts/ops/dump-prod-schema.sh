#!/usr/bin/env bash
#
# Writes the baseline a staging reset applies: prod's structure, no rows.
#
#   PROD_DIRECT_URL=postgresql://... scripts/ops/dump-prod-schema.sh <outdir>
#
# Produces <outdir>/schema.sql (tables, indexes, functions, policies, types,
# triggers of schemas public, ontology and slidegen) and <outdir>/buckets.sql
# (the storage bucket definitions). It only reads prod: pg_dump --schema-only
# and one SELECT.
#
# Why prod and not the repository: the repository cannot rebuild an empty
# database. `prisma db push` fails on Supabase's auth-owned tables and creates
# no public table, and no migration creates the ontology schema. Measured
# 2026-10-29 on a fresh project. Prod is the only complete description of the
# structure the application runs against.
#
# Two things are taken out of the dump because the staging role cannot run them:
#   - CREATE SCHEMA public   (exists on every Supabase project)
#   - ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
#     ("permission denied to change default privileges")

set -euo pipefail

log() { printf '[dump-prod-schema] %s\n' "$*" >&2; }

OUT="${1:-}"
[ -n "$OUT" ] || { log "usage: dump-prod-schema.sh <outdir>"; exit 2; }
[ -n "${PROD_DIRECT_URL:-}" ] || { log "PROD_DIRECT_URL is not set"; exit 2; }

SCHEMAS=(public ontology slidegen)

mkdir -p "$OUT"
schema_args=()
for s in "${SCHEMAS[@]}"; do schema_args+=(-n "$s"); done

pg_dump "$PROD_DIRECT_URL" --schema-only --no-owner "${schema_args[@]}" -f "$OUT/schema.raw.sql"
grep -vE '^CREATE SCHEMA public;$|^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ' \
  "$OUT/schema.raw.sql" > "$OUT/schema.sql"
rm -f "$OUT/schema.raw.sql"

psql "$PROD_DIRECT_URL" -Atq -c "
  select format(
    'insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (%L, %L, %L, %L, %L) on conflict (id) do nothing;',
    id, name, public, file_size_limit, allowed_mime_types)
  from storage.buckets order by id" > "$OUT/buckets.sql"

tables=$(grep -c '^CREATE TABLE ' "$OUT/schema.sql" || true)
buckets=$(grep -c '^insert into storage.buckets' "$OUT/buckets.sql" || true)
log "baseline written to $OUT: ${tables} tables, ${buckets} buckets"
