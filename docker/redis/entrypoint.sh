#!/bin/sh
# Render the ACL template with password env vars, then start redis-server.
# Passwords come from the container environment (written to .env on EC2 by
# deploy.yml from GitHub Secrets). The rendered ACL lives in /tmp so the
# image itself never contains secrets.

set -eu

: "${REDIS_ADMIN_PASSWORD:?missing REDIS_ADMIN_PASSWORD}"
: "${REDIS_COLLECTOR_PASSWORD:?missing REDIS_COLLECTOR_PASSWORD}"
: "${REDIS_INSIGHTA_PASSWORD:?missing REDIS_INSIGHTA_PASSWORD}"
: "${REDIS_INSIGHTA_UPSERT_PASSWORD:?missing REDIS_INSIGHTA_UPSERT_PASSWORD}"

envsubst < /etc/redis/redis.acl.template > /tmp/redis.acl
chmod 600 /tmp/redis.acl

exec redis-server /etc/redis/redis.conf --aclfile /tmp/redis.acl
