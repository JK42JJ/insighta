#!/usr/bin/env bash
#
# Opens the ArgoCD web interface on this machine.
#
#   scripts/ops/argocd-ui.sh            open it
#   scripts/ops/argocd-ui.sh --password print the admin password and exit
#   scripts/ops/argocd-ui.sh --stop     close the tunnels
#
# Nothing is exposed to the internet. ArgoCD holds cluster-admin, so it is
# reached through two hops that both require the SSH key: a tunnel to the
# node's Kubernetes API, and a port-forward from there to the argocd-server
# service. Closing the terminal closes both.
#
# The alternative -- an Ingress with a public hostname -- would put a
# cluster-admin console on the internet behind one password. It is not worth
# the convenience.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KUBE_PORT=6443
UI_PORT=8080
KC="${HOME}/.kube/insighta-k3s.yaml"

log() { printf '[argocd] %s\n' "$*" >&2; }

stop() {
  pkill -f "L ${KUBE_PORT}:127.0.0.1:${KUBE_PORT}" 2>/dev/null || true
  pkill -f "port-forward.*argocd-server" 2>/dev/null || true
  log "tunnels closed"
}

[ "${1:-}" = "--stop" ] && { stop; exit 0; }

# ── kubeconfig, fetched once ────────────────────────────────────────────────
if [ ! -f "$KC" ]; then
  log "fetching kubeconfig"
  mkdir -p "$(dirname "$KC")"
  bash "$HERE/ssh.sh" k3s "sudo cat /etc/rancher/k3s/k3s.yaml" > "$KC"
  chmod 600 "$KC"
fi
export KUBECONFIG="$KC"

# ── hop 1: the node's API server ────────────────────────────────────────────
if ! kubectl get --raw=/readyz >/dev/null 2>&1; then
  HOST=$(bash "$HERE/ssh.sh" k3s --print-host)
  pkill -f "L ${KUBE_PORT}:127.0.0.1:${KUBE_PORT}" 2>/dev/null || true
  log "tunnelling to $HOST"
  ssh -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
      -i "${INSIGHTA_SSH_KEY:-$HOME/.ssh/insighta/prx01-tubearchive.pem}" \
      -f -N -o ExitOnForwardFailure=yes -L "${KUBE_PORT}:127.0.0.1:${KUBE_PORT}" "ubuntu@$HOST"
  for _ in $(seq 1 15); do kubectl get --raw=/readyz >/dev/null 2>&1 && break; sleep 1; done
fi
kubectl get --raw=/readyz >/dev/null 2>&1 || { log "cluster API unreachable"; exit 1; }

PW=$(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' 2>/dev/null | base64 -d || true)

if [ "${1:-}" = "--password" ]; then
  [ -n "$PW" ] && printf '%s\n' "$PW" || log "initial secret is gone -- the password has been changed"
  exit 0
fi

# ── hop 2: argocd-server ────────────────────────────────────────────────────
pkill -f "port-forward.*argocd-server" 2>/dev/null || true
kubectl -n argocd port-forward svc/argocd-server "${UI_PORT}:443" >/dev/null 2>&1 &
sleep 3

printf '\n'
printf '  ArgoCD    https://localhost:%s\n' "$UI_PORT"
printf '  user      admin\n'
if [ -n "$PW" ]; then
  printf '  password  %s\n' "$PW"
  printf '\n  This is the initial password. Change it in the interface and the\n'
  printf '  secret above can then be deleted.\n'
else
  printf '  password  changed -- the initial secret no longer exists\n'
fi
printf '\n  The certificate is self-signed, so the browser will warn. That is\n'
printf '  expected: the connection is already inside two SSH hops.\n'
printf '\n  scripts/ops/argocd-ui.sh --stop   to close\n\n'
