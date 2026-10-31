#!/usr/bin/env bash
#
# Copies the reference rows staging needs from prod: vocabularies, settings and
# catalogs, no user data. Prod is only read.
#
#   PROD_DIRECT_URL=postgresql://... \
#   STG_DIRECT_URL=postgresql://postgres.<ref>:... STG_PROJECT_REF=<ref> \
#     scripts/ops/sync-stg-reference.sh [reference-file]
#
# reference-file (default scripts/ops/stg-reference-tables.txt) lists the tables,
# parents first. In one transaction on staging it deletes their rows in reverse
# order and loads prod's. A foreign key that still points at a row being deleted
# fails the transaction, so run it after clean-stg-data.sh has emptied the tables
# that reference these.
#
# Columns marked `null:` are written as NULL: they point at prod-only rows
# (system_settings.updated_by references auth.users) and would break the foreign
# key on staging.
#
# Refuses to run unless the connection string names the staging project. The
# check comes before anything that opens a connection.

set -euo pipefail

log() { printf '[sync-stg-reference] %s\n' "$*" >&2; }
die() { log "refusing: $*"; exit 2; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIST="${1:-${HERE}/stg-reference-tables.txt}"

[ -n "${STG_PROJECT_REF:-}" ]  || die "STG_PROJECT_REF is not set"
[ -n "${STG_DIRECT_URL:-}" ]   || die "STG_DIRECT_URL is not set"
case "$STG_DIRECT_URL" in
  *"postgres.${STG_PROJECT_REF}:"*) ;;
  *) die "STG_DIRECT_URL does not name project ${STG_PROJECT_REF}" ;;
esac
[ -n "${PROD_DIRECT_URL:-}" ]  || die "PROD_DIRECT_URL is not set"
case "$PROD_DIRECT_URL" in
  *"postgres.${STG_PROJECT_REF}:"*) die "PROD_DIRECT_URL names the staging project" ;;
esac
[ -f "$LIST" ] || die "no reference file at $LIST"

ENTRIES="$(grep -vE '^[[:space:]]*(#|$)' "$LIST" | sed -E 's/[[:space:]]+#.*$//' || true)"
[ -n "$ENTRIES" ] || die "reference file lists no tables"
if printf '%s\n' "$ENTRIES" | awk '{print $1}' | grep -qvE '^(public|ontology|slidegen)\.[a-z0-9_]+$'; then
  die "reference file has an entry that is not schema.table"
fi
if printf '%s\n' "$ENTRIES" | awk 'NF>1 {print $2}' | grep -qvE '^null:[a-z0-9_]+(,[a-z0-9_]+)*$'; then
  die "reference file has a second field that is not null:col[,col]"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
: > "$WORK/deletes.txt"
: > "$WORK/loads.sql"
: > "$WORK/expect.txt"

n=0
while read -r table nulls _; do
  [ -n "$table" ] || continue
  n=$((n + 1))
  schema="${table%%.*}"
  name="${table##*.}"
  nullcols=""
  case "${nulls:-}" in null:*) nullcols="${nulls#null:}" ;; esac

  cols="$(psql "$PROD_DIRECT_URL" -Atq -v ON_ERROR_STOP=1 -c "
    select string_agg(format('%I', column_name), ',' order by ordinal_position)
    from information_schema.columns where table_schema = '${schema}' and table_name = '${name}'")"
  [ -n "$cols" ] || die "prod has no table ${table}"
  select_list="$(psql "$PROD_DIRECT_URL" -Atq -v ON_ERROR_STOP=1 -c "
    select string_agg(case when column_name = any(string_to_array('${nullcols}', ',')) then 'NULL'
                           else format('%I', column_name) end, ',' order by ordinal_position)
    from information_schema.columns where table_schema = '${schema}' and table_name = '${name}'")"

  data="${WORK}/${n}.copy"
  psql "$PROD_DIRECT_URL" -v ON_ERROR_STOP=1 -q -c "\\copy (select ${select_list} from ${schema}.${name}) to '${data}'"
  rows="$(wc -l < "$data" | tr -d ' ')"

  echo "DELETE FROM ${schema}.${name};" >> "$WORK/deletes.txt"
  echo "\\copy ${schema}.${name} (${cols}) from '${data}'" >> "$WORK/loads.sql"
  echo "${table} ${rows}" >> "$WORK/expect.txt"
done <<< "$ENTRIES"

# Children before parents when deleting.
awk '{a[NR]=$0} END {for (i=NR; i>0; i--) print a[i]}' "$WORK/deletes.txt" > "$WORK/apply.sql"
cat "$WORK/loads.sql" >> "$WORK/apply.sql"

log "loading ${n} reference tables into staging (project ${STG_PROJECT_REF})"
psql "$STG_DIRECT_URL" -v ON_ERROR_STOP=1 -q -1 -f "$WORK/apply.sql"

bad=0
while read -r table rows; do
  got="$(psql "$STG_DIRECT_URL" -Atq -c "select count(*) from ${table}")"
  if [ "$got" != "$rows" ]; then log "${table}: prod gave ${rows} rows, staging has ${got}"; bad=1; fi
done < "$WORK/expect.txt"
[ "$bad" = "0" ] || die "row counts differ after the copy"
log "done: $(awk '{s += $2} END {print s}' "$WORK/expect.txt") rows in ${n} tables, counts match"
