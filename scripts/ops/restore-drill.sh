#!/usr/bin/env bash
#
# Restore drill: full restore of the latest production backup into a
# throwaway PostgreSQL 17 + pgvector container, with row counts compared to
# the dump. Proves the backup is restorable and measures how long it takes.
#
#   scripts/ops/restore-drill.sh                 latest backup
#   scripts/ops/restore-drill.sh db/2026/09/backup_20260910.sql.gz
#
# What the first drill (2026-09-11) taught, and what this script encodes:
#   - the dump references public.vector, so the vector extension has to exist
#     in the public schema of the target before the dump is fed in; without it
#     the two embedding tables fail to create, psql then reads their COPY data
#     as SQL and dies out of memory. That failure used to be recorded as
#     "full restore OOMs on mandala_embeddings". It was this.
#   - the dump is written by pg_dump 17 with \restrict, so the target needs a
#     17.x client and server (pgvector/pgvector:pg17 has both).
#   - the official image restarts once during initdb; wait for the second
#     "ready" line or the prerequisites go to a server that is shutting down.
#   - the backup covers the public schema only. auth.users and the other
#     Supabase-managed schemas are not in it, so foreign keys to auth.users
#     fail to attach at the end. Those errors are expected; data errors are not.

set -uo pipefail

KEY="${1:-}"
WORK="${RESTORE_DRILL_DIR:-$(mktemp -d /tmp/restore-drill.XXXXXX)}"
BUCKET="${BACKUP_BUCKET:-insighta-backups}"
IMAGE="pgvector/pgvector:pg17"
NAME="restore-drill"
log() { printf '[drill] %s\n' "$*"; }

T0=$(date +%s)
[ -n "$KEY" ] || KEY=$(aws s3 ls "s3://$BUCKET/db/" --recursive | sort | tail -1 | awk '{print $4}')
[ -n "$KEY" ] || { log "no backup found under s3://$BUCKET/db/"; exit 1; }
log "backup s3://$BUCKET/$KEY"
aws s3 cp "s3://$BUCKET/$KEY" "$WORK/backup.sql.gz" --only-show-errors || { log "download failed"; exit 1; }
gzip -t "$WORK/backup.sql.gz" || { log "gzip integrity failed"; exit 1; }
T1=$(date +%s); log "downloaded and verified in $((T1-T0))s"

docker rm -f -v "$NAME" >/dev/null 2>&1
docker pull -q "$IMAGE" >/dev/null || { log "image pull failed"; exit 1; }
docker run -d --name "$NAME" --memory 3g -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=restore_drill "$IMAGE" \
  -c maintenance_work_mem=256MB -c max_wal_size=2GB -c fsync=off >/dev/null || { log "container start failed"; exit 1; }
for _ in $(seq 1 90); do
  [ "$(docker logs "$NAME" 2>&1 | grep -c 'database system is ready to accept connections')" -ge 2 ] && break; sleep 1
done
ok=0
for _ in $(seq 1 60); do
  if docker exec "$NAME" psql -U postgres -d restore_drill -Atc 'select 1' >/dev/null 2>&1; then ok=$((ok+1)); [ "$ok" -ge 3 ] && break; else ok=0; fi; sleep 1
done
[ "$ok" -ge 3 ] || { log "server never became ready"; docker rm -f -v "$NAME" >/dev/null; exit 1; }

docker exec -i "$NAME" psql -U postgres -d restore_drill -q <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','supabase_admin','supabase_auth_admin'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
  END LOOP;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb $$;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
SQL
log "prerequisites: $(docker exec "$NAME" psql -U postgres -d restore_drill -Atc "SELECT 'vector in '||n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE extname='vector'")"

T2=$(date +%s)
gzip -dc "$WORK/backup.sql.gz" | docker exec -i "$NAME" psql -U postgres -d restore_drill -v ON_ERROR_STOP=0 -q >"$WORK/restore.out" 2>"$WORK/restore.err"
T3=$(date +%s)
DATA_ERRORS=$(grep -cE '^ERROR:.*(COPY|invalid input|out of memory|syntax error|trailing junk)' "$WORK/restore.err")
log "restore finished in $((T3-T2))s; errors total $(grep -c '^ERROR' "$WORK/restore.err"), data-related $DATA_ERRORS"
grep -E '^ERROR' "$WORK/restore.err" | sed -E 's/"[^"]{0,80}"/"…"/g' | cut -c1-100 | sort | uniq -c | sort -nr | head -6 | sed 's/^/[drill]   /'

gzip -dc "$WORK/backup.sql.gz" | awk 'BEGIN{inc=0} /^COPY public\./{t=$2; sub(/^public\./,"",t); n=0; inc=1; next} inc && $0=="\\."{print t, n; inc=0; next} inc{n++}' | sort > "$WORK/dump-counts.txt"
docker exec "$NAME" psql -U postgres -d restore_drill -Atc "SELECT string_agg(format('SELECT %L AS t, count(*) AS n FROM public.%I', tablename, tablename), ' UNION ALL ') FROM pg_tables WHERE schemaname='public';" > "$WORK/count-query.sql"
docker exec -i "$NAME" psql -U postgres -d restore_drill -Atc "$(cat "$WORK/count-query.sql")" | tr '|' ' ' | sort > "$WORK/restored-counts.txt"
MISMATCH=$(join "$WORK/dump-counts.txt" "$WORK/restored-counts.txt" | awk '$2!=$3' | wc -l | tr -d ' ')
TABLES=$(wc -l < "$WORK/dump-counts.txt" | tr -d ' ')
SIZE=$(docker exec "$NAME" psql -U postgres -d restore_drill -Atc "SELECT pg_size_pretty(pg_database_size('restore_drill'))")
log "row counts: $MISMATCH mismatches of $TABLES tables; restored size $SIZE"
[ "$MISMATCH" -eq 0 ] || join "$WORK/dump-counts.txt" "$WORK/restored-counts.txt" | awk '$2!=$3 {print "[drill]   MISMATCH", $0}'

docker rm -f -v "$NAME" >/dev/null
rm -f "$WORK/backup.sql.gz"
log "done: total $(( $(date +%s) - T0 ))s (download $((T1-T0))s, restore $((T3-T2))s). Work files in $WORK"
[ "$MISMATCH" -eq 0 ] && [ "$DATA_ERRORS" -eq 0 ]
