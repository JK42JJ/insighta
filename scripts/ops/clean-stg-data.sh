#!/usr/bin/env bash
#
# Empties the data a verification run leaves in the staging database and keeps
# the data staging needs to be useful: reference rows, shared content and the
# test account's settings.
#
#   STG_DIRECT_URL=postgresql://postgres.<ref>:... STG_PROJECT_REF=<ref> \
#     scripts/ops/clean-stg-data.sh [keep-file]
#
# Run when a verification cycle ends: after a promotion reached prod, or when a
# staging run is abandoned. The structure is not touched (staging was built from
# the same migrations as prod and already has them); a drifted or lost structure
# is rebuild-stg-db.sh's job.
#
# keep-file (default scripts/ops/stg-keep-tables.txt) lists the tables whose rows
# survive, one `schema.table  # reason` per line. Every other table in public,
# ontology and slidegen is truncated, so a new table is cleared until it is
# listed. The truncate is a single statement without CASCADE: a listed table
# that references an unlisted one makes it fail instead of silently emptying the
# listed table, and the whole clean rolls back.
#
# Never touched: the auth schema (the test account), storage objects (the
# storage tables refuse direct deletes; a leftover count is reported), the
# structure and the extensions.
#
# Refuses to run unless the connection string names the staging project. The
# check comes before anything that opens a connection.

set -euo pipefail

log() { printf '[clean-stg-data] %s\n' "$*" >&2; }
die() { log "refusing: $*"; exit 2; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEEP_FILE="${1:-${HERE}/stg-keep-tables.txt}"

[ -n "${STG_PROJECT_REF:-}" ] || die "STG_PROJECT_REF is not set"
[ -n "${STG_DIRECT_URL:-}" ] || die "STG_DIRECT_URL is not set"
case "$STG_DIRECT_URL" in
  *"postgres.${STG_PROJECT_REF}:"*) ;;
  *) die "STG_DIRECT_URL does not name project ${STG_PROJECT_REF}" ;;
esac
[ -f "$KEEP_FILE" ] || die "no keep file at $KEEP_FILE"

# Entries are read as `schema.table`; anything else in the file is a mistake that
# would otherwise turn into SQL.
# grep exits 1 when nothing is left after the comments are removed; that is the
# empty-list case handled just below, not an error to die on silently.
keep_names="$(grep -vE '^[[:space:]]*(#|$)' "$KEEP_FILE" | awk '{print $1}' || true)"
[ -n "$keep_names" ] || die "keep file lists no tables: that would clear everything"
if printf '%s\n' "$keep_names" | grep -qvE '^(public|ontology|slidegen)\.[a-z0-9_]+$'; then
  die "keep file has an entry that is not schema.table: $(printf '%s\n' "$keep_names" | grep -vE '^(public|ontology|slidegen)\.[a-z0-9_]+$' | head -1)"
fi

SETUP_SQL="$(mktemp)"
CLEAN_SQL="$(mktemp)"
trap 'rm -f "$SETUP_SQL" "$CLEAN_SQL"' EXIT

{
  echo "CREATE TEMP TABLE keep (t text PRIMARY KEY);"
  printf '%s\n' "$keep_names" | sed "s/.*/INSERT INTO keep VALUES ('&');/"
} > "$SETUP_SQL"

cat > "$CLEAN_SQL" <<'SQL'
DO $$
DECLARE
  missing text;
  doomed  text;
  tables_cleared int;
  rows_removed bigint := 0;
  kept_report text := '';
  r record;
  c bigint;
BEGIN
  -- A name that matches no table is a typo or a dropped table; either way the
  -- list no longer says what it was written to say.
  SELECT string_agg(k.t, ', ') INTO missing FROM keep k
   WHERE NOT EXISTS (SELECT 1 FROM pg_tables p WHERE p.schemaname || '.' || p.tablename = k.t);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'keep list names tables that do not exist: %', missing;
  END IF;

  FOR r IN
    SELECT schemaname, tablename FROM pg_tables
     WHERE schemaname IN ('public', 'ontology', 'slidegen')
       AND schemaname || '.' || tablename NOT IN (SELECT t FROM keep)
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', r.schemaname, r.tablename) INTO c;
    rows_removed := rows_removed + c;
  END LOOP;

  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ' ORDER BY schemaname, tablename), count(*)
    INTO doomed, tables_cleared
    FROM pg_tables
   WHERE schemaname IN ('public', 'ontology', 'slidegen')
     AND schemaname || '.' || tablename NOT IN (SELECT t FROM keep);

  IF doomed IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || doomed || ' RESTART IDENTITY';
  END IF;

  FOR r IN SELECT t FROM keep ORDER BY t LOOP
    EXECUTE format('SELECT count(*) FROM %s', r.t) INTO c;
    IF c > 0 THEN kept_report := kept_report || r.t || '=' || c || ' '; END IF;
  END LOOP;

  RAISE NOTICE 'cleared % tables, % rows removed', tables_cleared, rows_removed;
  RAISE NOTICE 'kept rows: %', coalesce(nullif(kept_report, ''), '(none)');
END $$;
SQL

log "cleaning staging data (project ${STG_PROJECT_REF}); keeping the tables in ${KEEP_FILE##*/}"
psql "$STG_DIRECT_URL" -v ON_ERROR_STOP=1 -q -1 -f "$SETUP_SQL" -f "$CLEAN_SQL" 2>&1 \
  | sed -E 's/^psql:[^ ]+ NOTICE:  /  /; s/^NOTICE:  /  /' >&2

leftover="$(psql "$STG_DIRECT_URL" -Atq -c "select count(*) from storage.objects")"
if [ "$leftover" != "0" ]; then
  log "warning: ${leftover} storage object(s) remain. The storage tables refuse direct deletes; remove them through the Storage API."
fi
log "done"
