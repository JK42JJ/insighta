#!/usr/bin/env bash
#
# Renders every environment of charts/insighta and checks the result.
#
# The repository validates TypeScript through eight CI jobs and, until this
# script, validated Kubernetes manifests through none. The cost was measured on
# 2026-08-14: adding a `redis.enabled` guard without the matching default
# removed the redis Service and StatefulSet from dev, staging and prod at once.
# `helm lint` passed. Every existing job passed. It was caught by hand.
#
# Two layers here:
#   1. kubeconform, which checks the rendered objects against the real
#      Kubernetes API schemas -- wrong apiVersion, misspelled field, bad type.
#   2. Explicit expectations per environment, which is the part that catches an
#      object going missing. A schema validator is perfectly happy with an
#      empty render.
#
# Local use: bash scripts/ci/check-charts.sh
# kubeconform is optional locally and required in CI.

set -euo pipefail

CHART="charts/insighta"
ENVS="dev staging prod validation"
FAIL=0

say()  { printf '  %s\n' "$*"; }
bad()  { printf '  FAIL  %s\n' "$*"; FAIL=1; }
ok()   { printf '  ok    %s\n' "$*"; }

command -v helm >/dev/null || { echo "helm not found"; exit 127; }

# Expectations, one line per environment:
#   <env>|<kind/name that must exist, comma separated>|<must NOT exist>
#
# These are not a restatement of the templates. Each entry is a decision that
# was made for a reason and would be a defect to lose silently.
read -r -d '' EXPECT <<'EOF' || true
dev|Service/insighta-redis,StatefulSet/insighta-redis,Deployment/insighta-api,Deployment/insighta-worker|Job/insighta-schema-sync
staging|Service/insighta-redis,StatefulSet/insighta-redis,Deployment/insighta-api,Job/insighta-schema-sync|
prod|Service/insighta-redis,StatefulSet/insighta-redis,Deployment/insighta-api,Deployment/insighta-worker,Job/insighta-schema-sync|StatefulSet/insighta-postgres
validation|Deployment/insighta-api,Deployment/insighta-worker,StatefulSet/insighta-postgres|StatefulSet/insighta-redis,Ingress/insighta,Job/insighta-schema-sync
EOF

echo "chart-verify: $CHART"

for env in $ENVS; do
  vals="$CHART/environments/$env.yaml"
  [ -f "$vals" ] || { bad "$env: $vals missing"; continue; }

  if ! out=$(helm template insighta "$CHART" -f "$vals" --namespace insighta 2>&1); then
    bad "$env: render failed"
    printf '%s\n' "$out" | sed 's/^/        /' | head -20
    continue
  fi

  # A render that produces nothing is a pass for every syntactic check and a
  # catastrophe in production. Guard the floor before checking specifics.
  count=$(printf '%s\n' "$out" | grep -c '^kind:' || true)
  if [ "$count" -lt 4 ]; then
    bad "$env: rendered only $count objects"
    continue
  fi

  # kind/name pairs actually present, e.g. Deployment/insighta-api
  present=$(printf '%s\n' "$out" \
    | awk '/^kind: /{k=$2} /^  name: /{if(k!=""){print k"/"$2; k=""}}' \
    | sort -u)

  line=$(printf '%s\n' "$EXPECT" | grep "^$env|") || { bad "$env: no expectations"; continue; }
  want=$(printf '%s' "$line" | cut -d'|' -f2)
  deny=$(printf '%s' "$line" | cut -d'|' -f3)

  missing=""
  for w in ${want//,/ }; do
    printf '%s\n' "$present" | grep -qx "$w" || missing="$missing $w"
  done
  [ -n "$missing" ] && bad "$env: missing:$missing"

  extra=""
  for d in ${deny//,/ }; do
    [ -z "$d" ] && continue
    printf '%s\n' "$present" | grep -qx "$d" && extra="$extra $d"
  done
  [ -n "$extra" ] && bad "$env: present but must not be:$extra"

  # Private registry pulls need a secret. Without one every pod sits in
  # ImagePullBackOff and nothing else in the render looks wrong.
  wantsecret=$(grep -c '^imagePullSecrets:' "$vals" || true)
  gotsecret=$(printf '%s\n' "$out" | grep -c 'imagePullSecrets:' || true)
  podspecs=$(printf '%s\n' "$out" | grep -c '^      containers:' || true)
  if [ "$wantsecret" -gt 0 ] && [ "$gotsecret" -ne "$podspecs" ]; then
    bad "$env: imagePullSecrets on $gotsecret of $podspecs pod specs"
  fi

  # The in-cluster database is an ordinary resource, so a pre-install hook runs
  # before it exists and can never connect. Measured 2026-08-14: P1001,
  # BackoffLimitExceeded.
  if grep -qA1 '^postgresDev:' "$vals" && grep -A1 '^postgresDev:' "$vals" | grep -q 'enabled: true'; then
    if printf '%s\n' "$out" | grep -q 'helm.sh/hook: pre-install'; then
      bad "$env: schema-sync is a pre-install hook while postgresDev is enabled"
    fi
  fi

  [ "$FAIL" -eq 0 ] && ok "$env: $count objects"
  [ "$FAIL" -eq 1 ] && say "$env: $count objects"
done

if command -v kubeconform >/dev/null; then
  echo "kubeconform:"
  for env in $ENVS; do
    if helm template insighta "$CHART" -f "$CHART/environments/$env.yaml" --namespace insighta \
       | kubeconform -strict -summary -ignore-missing-schemas 2>&1 | sed "s/^/    $env /"; then :; else
      bad "$env: kubeconform"
    fi
  done
else
  say "kubeconform not installed -- skipped (CI installs it)"
fi

if [ "$FAIL" -ne 0 ]; then
  echo
  echo "chart-verify FAILED"
  exit 1
fi
echo
echo "chart-verify OK"
