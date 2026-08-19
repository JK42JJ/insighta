#!/usr/bin/env bash
#
# Verifies the timeout ladder in docs/ops/timeout-ladder.md.
#
# A request crosses several layers, each with its own timeout. When those values
# do not know about each other the shortest one decides everything, silently.
# That is what happened on 2026-08-14: the ingress moved to its 60s default
# while the workflows calling it still allowed 300s, so every long request was
# cut by a value declared nowhere, and the logs showed a 504 with no indication
# of which layer produced it.
#
# The rule this enforces: each layer must be longer than the one inside it.
#
#   external call  <  fastify  <  ingress  <  curl  <  github actions job
#
# Local use: bash scripts/ci/check-timeouts.sh

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

PASS=0; FAIL=0
ok(){ printf '  \033[32mok\033[0m    %s\n' "$*"; PASS=$((PASS+1)); }
no(){ printf '  \033[31mFAIL\033[0m  %s\n' "$*"; FAIL=$((FAIL+1)); }

PROD=charts/insighta/environments/prod.yaml
SERVER=src/api/server.ts

echo "timeout-ladder: reading declared values"

# ── ④ fastify ───────────────────────────────────────────────────────────────
FASTIFY=$(grep -oE 'requestTimeout:\s*[0-9_]+' "$SERVER" | grep -oE '[0-9_]+' | tr -d '_')
[ -n "$FASTIFY" ] || { no "requestTimeout not declared in $SERVER"; FASTIFY=0; }
FASTIFY=$((FASTIFY / 1000))

KEEPALIVE=$(grep -oE 'keepAliveTimeout:\s*[0-9_]+' "$SERVER" | grep -oE '[0-9_]+' | tr -d '_')
KEEPALIVE=$(( ${KEEPALIVE:-0} / 1000 ))

# ── ③ ingress ───────────────────────────────────────────────────────────────
INGRESS=$(grep -oE 'proxy-read-timeout:\s*"[0-9]+"' "$PROD" | grep -oE '[0-9]+')
[ -n "$INGRESS" ] || { no "proxy-read-timeout not declared in $PROD (controller would use 60)"; INGRESS=0; }

SEND=$(grep -oE 'proxy-send-timeout:\s*"[0-9]+"' "$PROD" | grep -oE '[0-9]+')
[ -n "$SEND" ] || no "proxy-send-timeout not declared in $PROD"

printf '  fastify=%ss  keepAlive=%ss  ingress=%ss\n' "$FASTIFY" "$KEEPALIVE" "$INGRESS"

# ── ordering ────────────────────────────────────────────────────────────────
if [ "$FASTIFY" -lt "$INGRESS" ]; then
  ok "fastify ($FASTIFY) < ingress ($INGRESS)"
else
  no "fastify ($FASTIFY) must be below ingress ($INGRESS), or the ingress cuts first and hides the cause"
fi

# keepAlive runs the other way: the server must not close a connection the
# ingress still considers usable, or requests fail intermittently with 502.
if [ "$KEEPALIVE" -gt "$INGRESS" ]; then
  ok "keepAliveTimeout ($KEEPALIVE) > ingress ($INGRESS)"
else
  no "keepAliveTimeout ($KEEPALIVE) must exceed ingress ($INGRESS) or connections close under it"
fi

# ── ② curl and ① job, per workflow ──────────────────────────────────────────
# Health probes are excluded: they are outside the ladder by design. Anything
# 60s or below against a /health-style path is treated as a probe.
for wf in .github/workflows/*.yml; do
  grep -q 'max-time' "$wf" || continue
  name=$(basename "$wf")

  job=$(grep -oE 'timeout-minutes:\s*[0-9]+' "$wf" | grep -oE '[0-9]+' | sort -n | head -1)
  [ -n "$job" ] || { no "$name: no timeout-minutes"; continue; }
  jobsec=$((job * 60))

  # the longest non-probe curl in the file is the one that must fit the ladder
  worst=0
  while read -r t; do
    [ "$t" -le 60 ] && continue          # probe, not a work call
    [ "$t" -gt "$worst" ] && worst=$t
  done < <(grep -oE 'max-time [0-9]+' "$wf" | grep -oE '[0-9]+')

  [ "$worst" -eq 0 ] && { ok "$name: probe-only, outside the ladder"; continue; }

  if [ "$worst" -gt "$INGRESS" ] && [ "$worst" -lt "$jobsec" ]; then
    ok "$name: ingress $INGRESS < curl $worst < job $jobsec"
  else
    no "$name: curl $worst must sit between ingress $INGRESS and job $jobsec"
  fi
done

# ── both Ingress objects carry the annotations ──────────────────────────────
# /api is served by the rate-limit Ingress, not the main one. Annotating only
# one leaves the path the scheduled jobs actually use on the 60s default.
if command -v helm >/dev/null 2>&1; then
  n=$(helm template insighta charts/insighta -f "$PROD" \
        --set imageRegistry=registry.invalid 2>/dev/null | grep -c 'proxy-read-timeout')
  ing=$(helm template insighta charts/insighta -f "$PROD" \
        --set imageRegistry=registry.invalid 2>/dev/null | grep -c '^kind: Ingress')
  if [ "$n" -eq "$ing" ] && [ "$ing" -gt 0 ]; then
    ok "all $ing Ingress objects carry proxy-read-timeout"
  else
    no "$n of $ing Ingress objects carry proxy-read-timeout"
  fi
else
  echo "  skip  helm not installed, Ingress render check skipped"
fi

echo
printf '  %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
