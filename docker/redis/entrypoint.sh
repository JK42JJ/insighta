#!/bin/sh
# Render the ACL template with password env vars, then start redis-server.
# Passwords come from the container environment (written to .env on EC2 by
# deploy.yml from GitHub Secrets). The rendered ACL lives in /tmp so the
# image itself never contains secrets.
#
# Trailing CR/LF guard: docker-compose env_file parsing can retain newline
# bytes from the .env file as part of env var values. Base64 passwords
# never contain CR/LF, so stripping them is safe and fixes a class of
# silent auth failures where redis-cli sends "password\n" (env-sourced)
# but Redis ACL parser stored "password" (whitespace-split on load).

set -eu

strip_trailing_nl() {
  # $1 = env var name. Updates the var in place with CR/LF removed.
  eval "_value=\${$1:-}"
  _clean=$(printf '%s' "$_value" | tr -d '\r\n')
  eval "$1=\$_clean"
  eval "export $1"
  unset _value _clean
}

for V in REDIS_ADMIN_PASSWORD REDIS_COLLECTOR_PASSWORD REDIS_INSIGHTA_PASSWORD REDIS_INSIGHTA_UPSERT_PASSWORD; do
  strip_trailing_nl "$V"
done

: "${REDIS_ADMIN_PASSWORD:?missing REDIS_ADMIN_PASSWORD}"
: "${REDIS_COLLECTOR_PASSWORD:?missing REDIS_COLLECTOR_PASSWORD}"
: "${REDIS_INSIGHTA_PASSWORD:?missing REDIS_INSIGHTA_PASSWORD}"
: "${REDIS_INSIGHTA_UPSERT_PASSWORD:?missing REDIS_INSIGHTA_UPSERT_PASSWORD}"

envsubst < /etc/redis/redis.acl.template > /tmp/redis.acl
chmod 600 /tmp/redis.acl

exec redis-server /etc/redis/redis.conf --aclfile /tmp/redis.acl
