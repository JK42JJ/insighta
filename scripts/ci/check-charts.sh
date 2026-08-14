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

  # An environment whose images only exist in a registry whose host is not
  # committed declares requireImageRegistry. Supply a placeholder so the render
  # can be checked, and assert first that omitting it is an error -- a
  # requirement nothing enforces is a comment.
  extra=()
  if grep -q '^requireImageRegistry: true' "$vals"; then
    if helm template insighta "$CHART" -f "$vals" --namespace insighta >/dev/null 2>&1; then
      bad "$env: declares requireImageRegistry but renders without one"
    else
      ok "$env: refuses to render without imageRegistry"
    fi
    extra=(--set "imageRegistry=registry.invalid")
  fi

  if ! out=$(helm template insighta "$CHART" -f "$vals" --namespace insighta ${extra[@]+"${extra[@]}"} 2>&1); then
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
  # An empty list is a declaration that none are wanted, not a request for them.
  wantsecret=$(grep -cE '^imagePullSecrets:[[:space:]]*$' "$vals" || true)
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

# The Argo bootstrap points at a branch and a values file. Both can rot without
# any render failing: on 2026-08-14 all four manifests still referenced
# feat/p2-helm-chart-t0, which had been merged and deleted, so every
# Application would have failed to sync with nothing in the chart to explain
# why.
# Kubernetes canonicalises resource quantities: 1000m becomes 1, 1024Mi becomes
# 1Gi. A chart that writes the non-canonical form renders a value the API server
# stores differently, and every server-side-apply diff afterwards reports a
# change that is not one. Measured 2026-08-14: StatefulSet/insighta-postgres sat
# OutOfSync with a single difference, cpu "1000m" against a live "1".
echo "quantities:"
noncanon=$(grep -rnE '(cpu|memory): *"?[0-9]+(000m|024Mi)"?' "$CHART" || true)
if [ -n "$noncanon" ]; then
  bad "non-canonical resource quantities (Kubernetes will rewrite these):"
  printf '%s\n' "$noncanon" | sed 's/^/        /'
else
  ok "all resource quantities are in canonical form"
fi

echo "bootstrap:"
for f in charts/bootstrap/*.yaml; do
  [ -f "$f" ] || continue

  while read -r ref; do
    [ -z "$ref" ] && continue
    case "$ref" in
      # A 40-char hex string is a commit and cannot be checked this way.
      [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) continue ;;
    esac
    # Only the remote answers this. A local refs/remotes entry is not
    # evidence: a branch deleted on origin stays in the local repository until
    # someone prunes, and an earlier version of this check consulted it as a
    # fallback -- which made the check incapable of failing. Verified by
    # reintroducing the dead branch: the check passed.
    #
    # ls-remote exits 0 when found and 2 when the ref does not exist. Any
    # other status means the remote could not be reached, which is reported
    # rather than treated as a pass.
    set +e
    git ls-remote --exit-code --heads origin "$ref" >/dev/null 2>&1
    rc=$?
    set -e
    case "$rc" in
      0) ok  "$(basename "$f"): targetRevision $ref exists" ;;
      2) bad "$(basename "$f"): targetRevision '$ref' is not a branch on origin" ;;
      *) say "$(basename "$f"): could not reach origin (git ls-remote exit $rc) -- targetRevision unchecked" ;;
    esac
  done < <(grep -h 'targetRevision:' "$f" | awk '{print $2}' | sort -u)

  while read -r vf; do
    [ -z "$vf" ] && continue
    if [ -f "$CHART/$vf" ]; then
      ok "$(basename "$f"): $vf exists"
    else
      bad "$(basename "$f"): valueFile $vf does not exist"
    fi
  done < <(sed -n '/valueFiles:/,/^ *[a-z]/p' "$f" | grep -oE '^ *- [a-zA-Z0-9._/-]+\.yaml' | awk '{print $2}' | sort -u)
done

if command -v kubeconform >/dev/null; then
  echo "kubeconform:"
  for env in $ENVS; do
    reg=()
    grep -q '^requireImageRegistry: true' "$CHART/environments/$env.yaml" && reg=(--set "imageRegistry=registry.invalid")
    if helm template insighta "$CHART" -f "$CHART/environments/$env.yaml" --namespace insighta ${reg[@]+"${reg[@]}"} \
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
