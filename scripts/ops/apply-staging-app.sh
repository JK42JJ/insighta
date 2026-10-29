#!/usr/bin/env bash
#
# Applies the staging Application (charts/bootstrap/staging-app.yaml) with the
# image registry filled in.
#
#   scripts/ops/apply-staging-app.sh            apply
#   scripts/ops/apply-staging-app.sh --dry-run  print the manifest with the
#                                               registry masked, apply nothing
#
# The registry host names the AWS account, and this repository is public, so
# the template carries a placeholder. The value is read from the live prod
# Application -- the one place it already exists -- rather than written down
# a second time, so the two environments cannot drift apart on it.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/../.." && pwd)"
TEMPLATE="${ROOT}/charts/bootstrap/staging-app.yaml"
PLACEHOLDER="__IMAGE_REGISTRY__"
KUBECTL="sudo k3s kubectl"

log() { printf '[staging-app] %s\n' "$*" >&2; }

registry="$("${HERE}/ssh.sh" k3s \
  "${KUBECTL} -n argocd get application insighta-prod -o jsonpath='{.spec.source.helm.parameters[?(@.name==\"imageRegistry\")].value}'" \
  2>/dev/null | tail -n 1)"

case "${registry}" in
  *.dkr.ecr.*.amazonaws.com) ;;
  *) log "could not read imageRegistry from insighta-prod (got: '${registry:-<empty>}')"; exit 1 ;;
esac

manifest="$(sed "s|${PLACEHOLDER}|${registry}|" "${TEMPLATE}")"
if printf '%s' "${manifest}" | grep -q "${PLACEHOLDER}"; then
  log "placeholder still present after substitution"; exit 1
fi

if [ "${1:-}" = "--dry-run" ]; then
  printf '%s\n' "${manifest}" | sed "s|${registry}|<registry>|"
  exit 0
fi

printf '%s\n' "${manifest}" | "${HERE}/ssh.sh" k3s "${KUBECTL} apply -f -"
log "applied; registry host not printed"
