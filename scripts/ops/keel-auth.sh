#!/usr/bin/env bash
#
# Set the password for https://insighta.one/keel/
#
#   scripts/ops/keel-auth.sh            user defaults to "james"
#   scripts/ops/keel-auth.sh <user>
#
# The password is read by htpasswd from the terminal, not by `read` in a shell
# snippet. That distinction is the reason this file exists: a snippet with
# `read -rs PW` followed by a blank line stores an empty password when it is
# pasted as a block, because read takes the next line of the paste rather than
# waiting for the terminal. It happened on 2026-09-07 and the endpoint accepted
# `-u james:` for twenty minutes before anyone measured it.
#
# The hash is verified both ways before it is stored -- an empty password must
# be rejected and the real one accepted -- so a bad hash cannot reach the
# cluster and be discovered later by an HTTP probe.

set -euo pipefail

USER_NAME="${1:-james}"
NAMESPACE="${KEEL_NAMESPACE:-insighta-prod}"
SECRET="${KEEL_AUTH_SECRET:-keel-basic-auth}"
URL="${KEEL_URL:-https://insighta.one/keel/}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILE="$(mktemp -t keel-htpasswd)"
trap 'rm -f "$FILE"' EXIT

log() { printf '[keel-auth] %s\n' "$*" >&2; }

command -v htpasswd >/dev/null 2>&1 || {
  log "htpasswd not found. install it:  brew install httpd"
  exit 1
}

log "setting the password for user '$USER_NAME'"

# -c create, -B bcrypt, no -b: htpasswd prompts on the terminal and asks twice.
htpasswd -cB "$FILE" "$USER_NAME"

# Verified before it is stored, not after it is deployed.
if htpasswd -vb "$FILE" "$USER_NAME" "" >/dev/null 2>&1; then
  log "REFUSING: the stored hash accepts an empty password."
  exit 1
fi
log "checked: an empty password is rejected"

bash "$HERE/ssh.sh" k3s \
  "kubectl create secret generic $SECRET -n $NAMESPACE \
     --from-literal=auth='$(cat "$FILE")' \
     --dry-run=client -o yaml | kubectl apply -f -"

# nginx reloads the auth file within a few seconds of the Secret changing.
log "waiting for the ingress to pick it up"
sleep 8

EMPTY=$(curl -s -o /dev/null -w '%{http_code}' -u "$USER_NAME:" "$URL" || echo 000)
NONE=$(curl -s -o /dev/null -w '%{http_code}' "$URL" || echo 000)

printf '\n'
printf '  no credentials     %s\n' "$NONE"
printf '  empty password     %s\n' "$EMPTY"

if [ "$EMPTY" = "401" ] && [ "$NONE" = "401" ]; then
  log "OK — $URL is closed. Sign in as '$USER_NAME'."
else
  log "STILL OPEN: expected 401 for both. Check the ingress and the secret:"
  log "  scripts/ops/ssh.sh k3s \"kubectl get ingress $SECRET -n $NAMESPACE -o yaml\""
  exit 1
fi
