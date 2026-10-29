#!/usr/bin/env bash
#
# Rebuilds the staging database structure from prod's: every table, function,
# policy and type, with no rows. A repair tool for when staging has drifted from
# prod or has to be created again -- NOT the routine clean-up between
# verifications; that is clean-stg-data.sh, which keeps the data staging needs.
#
#   STG_DIRECT_URL=postgresql://postgres.<ref>:... STG_PROJECT_REF=<ref> \
#     scripts/ops/rebuild-stg-db.sh <baseline-dir>
#
# <baseline-dir> is the output of dump-prod-schema.sh. DESTRUCTIVE: all rows in
# public, ontology and slidegen are lost, reference data included. Run
# scripts/apply-custom-sql.sh afterwards to put the seeded reference rows back.
#
# What it does, in one transaction (a failure leaves staging as it was):
#   1. drops every object in public that no extension owns, and the whole
#      ontology and slidegen schemas;
#   2. applies the baseline structure;
#   3. inserts the storage bucket definitions (existing buckets are kept: the
#      storage tables refuse direct deletes).
#
# What it never touches: the auth schema (the staging test account lives there
# and sign-ups are closed, so it is the only user) and the extensions (vector,
# pg_trgm).
#
# Refuses to run unless the connection string names the staging project. The
# check comes before anything that opens a connection.

set -euo pipefail

log() { printf '[rebuild-stg-db] %s\n' "$*" >&2; }
die() { log "refusing: $*"; exit 2; }

BASE="${1:-}"
[ -n "${STG_PROJECT_REF:-}" ] || die "STG_PROJECT_REF is not set"
[ -n "${STG_DIRECT_URL:-}" ] || die "STG_DIRECT_URL is not set"
case "$STG_DIRECT_URL" in
  *"postgres.${STG_PROJECT_REF}:"*) ;;
  *) die "STG_DIRECT_URL does not name project ${STG_PROJECT_REF}" ;;
esac
[ -n "$BASE" ] || die "usage: rebuild-stg-db.sh <baseline-dir>"
[ -f "$BASE/schema.sql" ]  || die "no schema.sql in $BASE"
[ -f "$BASE/buckets.sql" ] || die "no buckets.sql in $BASE"

DROP_SQL="$(mktemp)"
trap 'rm -f "$DROP_SQL"' EXIT

cat > "$DROP_SQL" <<'SQL'
-- Roles the baseline grants to. NOLOGIN: they exist so the GRANTs resolve.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grafana_ro')  THEN CREATE ROLE grafana_ro NOLOGIN;  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'slidegen_rw') THEN CREATE ROLE slidegen_rw NOLOGIN; END IF;
END $$;

DROP SCHEMA IF EXISTS ontology CASCADE;
DROP SCHEMA IF EXISTS slidegen CASCADE;

-- public: everything an extension does not own. Extension-owned objects carry a
-- pg_depend row of type 'e'; dropping those would break the vector columns.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    IF r.relkind IN ('v') THEN
      EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', r.relname);
    ELSIF r.relkind = 'm' THEN
      EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS public.%I CASCADE', r.relname);
    ELSIF r.relkind = 'f' THEN
      EXECUTE format('DROP FOREIGN TABLE IF EXISTS public.%I CASCADE', r.relname);
    ELSE
      EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.relname);
    END IF;
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('DROP ROUTINE IF EXISTS %s CASCADE', r.sig);
  END LOOP;

  FOR r IN
    SELECT t.typname FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
  END LOOP;

  FOR r IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('e', 'a', 'i'))
  LOOP
    EXECUTE format('DROP SEQUENCE IF EXISTS public.%I CASCADE', r.relname);
  END LOOP;
END $$;

SQL

log "rebuilding staging structure (project ${STG_PROJECT_REF})"
psql "$STG_DIRECT_URL" -v ON_ERROR_STOP=1 -q -1 -f "$DROP_SQL" -f "$BASE/schema.sql" -f "$BASE/buckets.sql"

expected=$(grep -c '^CREATE TABLE ' "$BASE/schema.sql" || true)
actual=$(psql "$STG_DIRECT_URL" -Atq -c "
  select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'ontology', 'slidegen') and c.relkind in ('r', 'p')")
if [ "$expected" != "$actual" ]; then
  die "baseline defines ${expected} tables, staging has ${actual} after the rebuild"
fi
rows=$(psql "$STG_DIRECT_URL" -Atq -c "
  select coalesce(sum(n_live_tup), 0)::bigint from pg_stat_user_tables
  where schemaname in ('public', 'ontology', 'slidegen')")
log "done: ${actual} tables (matches the baseline), about ${rows} rows -- run scripts/apply-custom-sql.sh next"
