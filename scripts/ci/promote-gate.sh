#!/usr/bin/env bash
#
# Gate for promote.yml: has staging proved this exact commit?
#
#   promote-gate.sh <sha>
#
# Passes only when all of these hold:
#   1. <sha> is a full 40-character lowercase commit id.
#   2. It is an ancestor of the main ref (default origin/main).
#   3. deploy.yml has a push run for that commit that is completed.
#   4. In the latest attempt of that run, both staging checks concluded
#      `success`: the smoke check and the E2E job.
#
# Anything else is a failure: skipped, cancelled, in progress, or absent. A
# docs-only or chart-only merge skips the staging jobs (observed 2026-11-04,
# runs 41828376717 and 41826986229), and a skipped check proved nothing. There
# is no override here on purpose.
#
# Exit codes: 0 pass, 1 gate failed, 2 bad input or tool missing.
# The one-line reason goes to stderr. When GITHUB_STEP_SUMMARY is set, a short
# summary is appended to it.
#
# Environment:
#   GATE_MAIN_REF  ref the commit must be reachable from (default origin/main)
#   GATE_REPO      owner/name (default $GITHUB_REPOSITORY, else gh repo view)
#   GH_TOKEN       read by gh in Actions (needs actions: read)

set -uo pipefail

# Job names as GitHub reports them. Read from deploy.yml and e2e-staging.yml on
# 2026-11-04: `smoke-staging` has name "Staging smoke check"; `e2e-staging`
# calls the reusable workflow, so its job is "<caller name> / <called name>".
SMOKE_JOB="Staging smoke check"
E2E_JOB="Staging E2E / Playwright E2E (staging)"
DEPLOY_WORKFLOW="deploy.yml"
SHA_PATTERN='^[0-9a-f]{40}$'

SHA="${1:-}"
MAIN_REF="${GATE_MAIN_REF:-origin/main}"

summary() {
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] || return 0
  printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"
}

fail() { # code message
  echo "promote-gate: $2" >&2
  summary "### Promote gate: FAILED"
  summary "$2"
  exit "$1"
}

command -v jq >/dev/null 2>&1 || fail 2 "jq is not installed"
command -v gh >/dev/null 2>&1 || fail 2 "gh is not installed"

[[ "$SHA" =~ $SHA_PATTERN ]] || fail 2 "not a full commit sha: '${SHA}'"

git cat-file -e "${SHA}^{commit}" 2>/dev/null \
  || fail 1 "commit ${SHA} is not in this checkout (fetch-depth: 0 needed, or the sha is wrong)"
git merge-base --is-ancestor "$SHA" "$MAIN_REF" 2>/dev/null \
  || fail 1 "commit ${SHA} is not an ancestor of ${MAIN_REF}"

REPO="${GATE_REPO:-${GITHUB_REPOSITORY:-}}"
if [ -z "$REPO" ]; then
  REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null) \
    || fail 2 "cannot determine the repository (set GATE_REPO)"
fi

# `gh run list --commit` is missing from older gh releases; the REST filter
# behind it is stable.
runs=$(gh api "repos/${REPO}/actions/workflows/${DEPLOY_WORKFLOW}/runs?head_sha=${SHA}&event=push&per_page=20") \
  || fail 1 "could not list ${DEPLOY_WORKFLOW} runs for ${SHA}"

run=$(printf '%s' "$runs" | jq -c '[.workflow_runs[]?] | sort_by(.created_at) | last // empty')
[ -n "$run" ] || fail 1 "no ${DEPLOY_WORKFLOW} push run found for ${SHA}"

run_id=$(printf '%s' "$run" | jq -r '.id')
run_status=$(printf '%s' "$run" | jq -r '.status')
[ "$run_status" = "completed" ] \
  || fail 1 "${DEPLOY_WORKFLOW} run ${run_id} for ${SHA} is ${run_status}, not completed"

jobs=$(gh api "repos/${REPO}/actions/runs/${run_id}/jobs?filter=latest&per_page=100") \
  || fail 1 "could not read the jobs of run ${run_id}"

check_job() { # job name
  local name="$1" n conclusion
  n=$(printf '%s' "$jobs" | jq --arg n "$name" '[.jobs[]? | select(.name == $n)] | length')
  [ "$n" -ge 1 ] || fail 1 "run ${run_id} has no job '${name}'"
  # Every job with that name must have succeeded (a skipped duplicate is a failure).
  conclusion=$(printf '%s' "$jobs" \
    | jq -r --arg n "$name" '[.jobs[] | select(.name == $n) | (.conclusion // .status)] | unique | join(",")')
  [ "$conclusion" = "success" ] \
    || fail 1 "run ${run_id}: '${name}' is ${conclusion}, not success"
}

check_job "$SMOKE_JOB"
check_job "$E2E_JOB"

echo "promote-gate: PASS ${SHA} (${DEPLOY_WORKFLOW} run ${run_id}: '${SMOKE_JOB}' and '${E2E_JOB}' succeeded)"
summary "### Promote gate: passed"
summary "Commit \`${SHA}\`, ${DEPLOY_WORKFLOW} run ${run_id}: \`${SMOKE_JOB}\` and \`${E2E_JOB}\` succeeded."
exit 0
