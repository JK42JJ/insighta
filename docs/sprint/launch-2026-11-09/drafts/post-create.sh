#!/usr/bin/env bash
# DRAFT post-create step for the Codespace. Best effort: every step reports and
# continues, because Thursday's job is to learn which of them work.
set -u
sudo apt-get update -y
sudo apt-get install -y ripgrep jq python3 make g++ openssl postgresql postgresql-contrib || echo "WARN: apt base packages failed"
# pgvector: the package name depends on the distro and the Postgres major version.
PGMAJOR="$(ls /usr/lib/postgresql 2>/dev/null | sort -n | tail -1)"
sudo apt-get install -y "postgresql-${PGMAJOR}-pgvector" || echo "WARN: pgvector package not found; try the PGDG repository"
sudo service postgresql start || echo "WARN: postgres did not start"
# Local database for DDL checks only. Peer authentication over the unix socket:
# the container user "node" is the database superuser, so there is no password.
sudo -u postgres psql -c "CREATE USER node SUPERUSER;" || true
sudo -u postgres psql -c "CREATE DATABASE insighta_local OWNER node;" || true
LOCAL_URL='postgresql://node@localhost/insighta_local?host=/var/run/postgresql'
{
  echo "export LOCAL_DATABASE_URL='$LOCAL_URL'"
  echo "export DATABASE_URL='$LOCAL_URL'"
  echo "export DIRECT_URL='$LOCAL_URL'"
} >> ~/.bashrc
# Do NOT export CI: it lifts the jest worker cap (about 2 GB per worker).
echo "post-create done"
