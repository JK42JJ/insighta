#!/usr/bin/env bash
# keel-ledger.sh — read the Keel ledger (error_events, subsystem='keel') from
# this machine without SSH: Grafana's datasource proxy runs the SQL with the
# read-only role, and keel-url.sh already knows the basic-auth credential.
#
# Usage: scripts/ops/keel-ledger.sh [check] [limit]     default: all checks, 12 rows
#        scripts/ops/keel-ledger.sh --sql "<select ...>" raw query, table output
#
# Read-only: the Grafana role can only SELECT what its RLS policies allow.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="https://insighta.one/keel"
creds="$(bash "$HERE/keel-url.sh" 2>/dev/null)"
user="$(grep -oiE 'user(name)?[: =]+[A-Za-z0-9_-]+' <<<"$creds" | head -1 | awk -F'[: =]+' '{print $NF}')"
pass="$(grep -oiE 'pass(word)?[: =]+[A-Za-z0-9_-]+' <<<"$creds" | head -1 | awk -F'[: =]+' '{print $NF}')"
[ -n "$user" ] && [ -n "$pass" ] || { echo "keel-url.sh gave no credential" >&2; exit 2; }

if [ "${1:-}" = "--sql" ]; then
  sql="${2:?sql}"
else
  check="${1:-}"; limit="${2:-12}"
  where="subsystem='keel'"; [ -n "$check" ] && where="$where and stage='$check'"
  sql="select to_char(created_at at time zone 'Asia/Seoul','MM-DD HH24:MI') as kst, stage, severity, left(message,120) as message from error_events where $where order by created_at desc limit $limit"
fi

body="$(jq -cn --arg sql "$sql" '{queries:[{refId:"A",datasource:{uid:"insighta-pg"},format:"table",rawSql:$sql}]}')"
curl -sf -u "$user:$pass" -H 'Content-Type: application/json' "$URL/api/ds/query" -d "$body" \
  | jq -r '.results.A.frames[0] as $f | ($f.schema.fields | map(.name) | join("\t")), (($f.data.values | transpose)[] | map(tostring) | join("\t"))'
