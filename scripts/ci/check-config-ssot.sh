#!/usr/bin/env bash
# CP500++ CONFIG-SSOT guard — INV-CONFIG-SSOT structural enforcement.
#
# A runtime toggle must have exactly ONE definition channel. Two channels let
# one silently override the other (the §10-C silent-DEAD bug: a compose
# `environment:` literal wins over `env_file`/.env per Docker precedence, so a
# toggle written to .env by deploy.yml while also pinned in compose is dead).
#
# This guard FAILS when:
#   (a) a key appears in docker-compose.prod.yml api `environment:` AND is also
#       written to .env by .github/workflows/deploy.yml, or
#   (b) the same key is defined twice within compose api `environment:`
#       (Docker keeps the LAST occurrence; the earlier one is a silent no-op).
#
# Rule: toggle activation SSOT = compose `environment:`. deploy.yml writes ONLY
# secrets to .env. Design: docs/handoffs/crosscutting-audit-phase2-design.md (PR-1).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE="$ROOT/docker-compose.prod.yml"
DEPLOY="$ROOT/.github/workflows/deploy.yml"

[ -f "$COMPOSE" ] || { echo "config-ssot: compose not found: $COMPOSE"; exit 2; }
[ -f "$DEPLOY" ]  || { echo "config-ssot: deploy.yml not found: $DEPLOY"; exit 2; }

# --- compose api `environment:` keys (uncommented `- KEY=...` within the api block) ---
# awk emits lines from the `  api:` service header until the next top-level
# (2-space-indented) service header, so redis/frontend env vars are excluded.
compose_api_block="$(awk '
  /^  [a-zA-Z0-9_-]+:[[:space:]]*$/ { inapi = ($0 ~ /^  api:[[:space:]]*$/) }
  inapi { print }
' "$COMPOSE")"

compose_keys="$(printf '%s\n' "$compose_api_block" \
  | grep -E '^[[:space:]]+-[[:space:]]+[A-Za-z_][A-Za-z0-9_]*=' \
  | sed -E 's/^[[:space:]]+-[[:space:]]+//; s/=.*$//')"

# --- deploy.yml keys written to .env (lines touching .env, anchored `^KEY=`) ---
deploy_env_keys="$(grep -E '\.env' "$DEPLOY" \
  | grep -oE '\^[A-Za-z_][A-Za-z0-9_]*=' \
  | sed -E 's/^\^//; s/=$//' \
  | sort -u)"

fail=0

# (a) compose-SSOT ∩ deploy .env-write
conflict="$(comm -12 <(printf '%s\n' "$compose_keys" | sort -u) <(printf '%s\n' "$deploy_env_keys"))"
if [ -n "$conflict" ]; then
  echo "FAIL (a) — toggle double-defined in compose environment: AND deploy.yml .env-write:"
  printf '%s\n' "$conflict" | sed 's/^/    - /'
  echo '  -> keep it in the compose environment: block only; remove the deploy.yml .env write.'
  fail=1
fi

# (b) duplicate key within compose api environment:
dups="$(printf '%s\n' "$compose_keys" | sort | uniq -d)"
if [ -n "$dups" ]; then
  echo "FAIL (b) — duplicate key within compose api environment: (Docker keeps the LAST; earlier silently dead):"
  printf '%s\n' "$dups" | sed 's/^/    - /'
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "config-ssot: OK — no toggle double-definition (compose-SSOT intact)"
fi
exit "$fail"
