#!/usr/bin/env bash
#
# Builds or shows the staging env Secret from prod's (build-stg-secret.py).
#
#   scripts/ops/apply-stg-secret.sh --diff    how staging differs from prod; changes nothing
#   scripts/ops/apply-stg-secret.sh --apply   write it, and restart the staging api if it changed
#
# The staging database, Supabase settings and OpenRouter key come from ~/.insighta/stg-supabase.env
# (credentials.md L14). Nothing secret is printed: the report lists key names, and
# values only for the flags that are set to a fixed value on staging.
#
# --apply restarts the api, which on staging replaces its pod (about 30 seconds
# without an api), and the worker when one runs. It restarts only when the Secret
# actually changed.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${HOME}/.insighta/stg-supabase.env"
MODE="${1:---diff}"

case "$MODE" in --diff | --apply) ;; *) echo "usage: apply-stg-secret.sh [--diff|--apply]" >&2; exit 2 ;; esac
[ -f "$ENV_FILE" ] || { echo "no ${ENV_FILE} (see credentials.md L14)" >&2; exit 2; }

# shellcheck source=/dev/null
OVERRIDES="$(
  set -a; . "$ENV_FILE"; set +a
  python3 -c '
import json, os
e = os.environ
print(json.dumps({
    "DATABASE_URL": e["STG_DATABASE_URL"], "DIRECT_URL": e["STG_DIRECT_URL"],
    "SUPABASE_URL": e["STG_SUPABASE_URL"], "SUPABASE_ANON_KEY": e["STG_SUPABASE_ANON_KEY"],
    "SUPABASE_SERVICE_ROLE_KEY": e["STG_SUPABASE_SERVICE_ROLE_KEY"],
    "OPENROUTER_API_KEY": e["STG_OPENROUTER_API_KEY"],
}))'
)"

SCRIPT_B64="$(base64 < "${HERE}/build-stg-secret.py" | tr -d '\n')"
OUT="$(printf '%s' "$OVERRIDES" | "${HERE}/ssh.sh" k3s \
  "echo ${SCRIPT_B64} | base64 -d > /tmp/build-stg-secret.py && python3 /tmp/build-stg-secret.py ${MODE}; rc=\$?; rm -f /tmp/build-stg-secret.py; exit \$rc" \
  2>&1 | grep -v '^\[ssh\]')"
printf '%s\n' "$OUT"

if [ "$MODE" = "--apply" ] && printf '%s\n' "$OUT" | grep -qE '^changed: [1-9]'; then
  "${HERE}/ssh.sh" k3s "sudo k3s kubectl -n insighta-staging rollout restart deploy/insighta-api" 2>&1 | grep -v '^\[ssh\]'
  # One pod at a time: the api must be back before the worker starts. Restarting both at
  # once took the ingress controller down for 4.5 minutes on 2026-11-04 (a liveness probe
  # timed out while two Node processes booted on the 2 vCPU node).
  "${HERE}/ssh.sh" k3s "sudo k3s kubectl -n insighta-staging rollout status deploy/insighta-api --timeout=180s" 2>&1 | grep -v '^\[ssh\]'
  # The worker reads the Secret too (summaries are made there), and a pod only reads it at start.
  "${HERE}/ssh.sh" k3s "sudo k3s kubectl -n insighta-staging get deploy/insighta-worker -o jsonpath='{.spec.replicas}' | grep -qx '[1-9][0-9]*' && sudo k3s kubectl -n insighta-staging rollout restart deploy/insighta-worker || true" 2>&1 | grep -v '^\[ssh\]'
fi
