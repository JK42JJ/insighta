#!/usr/bin/env bash
#
# Open the invariant dashboard.
#
#   scripts/ops/grafana-ui.sh          http://localhost:3001
#   scripts/ops/grafana-ui.sh 8080     a different local port
#
# Two hops, the same shape as argocd-ui.sh: this laptop -> the node over ssh,
# then the node -> the pod with kubectl port-forward. Grafana has no Ingress and
# no login form, which is deliberate. Putting it on the internet would mean a
# password to manage and a login surface to get wrong, for a viewer one person
# opens; the SSH key already answers "who is this", and it is the credential
# that actually matters here.
#
# Nothing is left behind: the port-forward dies with the ssh session.

set -euo pipefail

LOCAL_PORT="${1:-3001}"
NAMESPACE="${GRAFANA_NAMESPACE:-insighta-prod}"
SERVICE="${GRAFANA_SERVICE:-svc/insighta-grafana}"
REMOTE_PORT=18300

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '[grafana] %s\n' "$*" >&2; }

if lsof -iTCP:"$LOCAL_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  log "local port $LOCAL_PORT is already in use; pass another: $0 <port>"
  exit 1
fi

# Resolve the host the same way every other operational script does -- by Name
# tag, through ssh.sh, which also authorizes this machine's address on the
# security group first. Writing an IP here would make this file lie the next
# time the instance changes.
HOST_IP="$(bash "$HERE/ssh.sh" k3s --print-host)"
KEY="${INSIGHTA_SSH_KEY:-$HOME/.ssh/insighta/prx01-tubearchive.pem}"

log "checking the pod is up"
if ! bash "$HERE/ssh.sh" k3s \
     "kubectl get deploy -n $NAMESPACE insighta-grafana -o jsonpath='{.status.readyReplicas}'" \
     2>/dev/null | grep -q '^1$'; then
  log "grafana is not ready in $NAMESPACE."
  log "it is evicted before anything serving traffic (priority -100), so under"
  log "node pressure this is the expected state, not a fault. check with:"
  log "  scripts/ops/ssh.sh k3s \"kubectl get pods -n $NAMESPACE -l app.kubernetes.io/component=grafana\""
  exit 1
fi

log "http://localhost:${LOCAL_PORT}  (ctrl-c to close)"

# -t so the remote port-forward receives the interrupt and exits with the shell,
# rather than being orphaned on the node.
exec ssh -t \
  -o ConnectTimeout=15 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
  -i "$KEY" \
  -L "${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}" \
  "ubuntu@${HOST_IP}" \
  "kubectl port-forward -n ${NAMESPACE} ${SERVICE} ${REMOTE_PORT}:3000 --address 127.0.0.1"
