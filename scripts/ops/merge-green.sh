#!/usr/bin/env bash
# merge-green.sh — merge a PR only after every check on its current head is
# read and green. Exists because #1634 was merged while the backend job was
# red (TS4111), which cost a hotfix PR and a second CI cycle (rules-ledger R31).
#
# Usage: scripts/ops/merge-green.sh <pr-number> [--check]
#   --check   report only, never merge
#
# Refuses when: any check is not COMPLETED/SUCCESS (SKIPPED and NEUTRAL are
# accepted), the head is BEHIND main (it updates the branch and asks you to
# run again once the new checks finish), or GitHub reports the PR unmergeable.
set -euo pipefail

pr="${1:?pr number}"; mode="${2:-merge}"
json="$(gh pr view "$pr" --json number,title,state,mergeable,mergeStateStatus,headRefOid,statusCheckRollup)"
state="$(jq -r .state <<<"$json")"
[ "$state" = "OPEN" ] || { echo "refuse: PR #$pr is $state"; exit 2; }
head="$(jq -r '.headRefOid[0:8]' <<<"$json")"
mstate="$(jq -r .mergeStateStatus <<<"$json")"
echo "PR #$pr $(jq -r .title <<<"$json")"
echo "head $head  mergeState $mstate  mergeable $(jq -r .mergeable <<<"$json")"

# A body edit re-triggers CI (pull_request: edited) and the concurrency group
# cancels the older run, so one head can carry two entries per check name.
# Judge only the most recently started entry of each name.
latest='.statusCheckRollup | map(select(.name != null)) | group_by(.name) | map(max_by(.startedAt // ""))'
checks="$(jq "$latest" <<<"$json")"
total="$(jq length <<<"$checks")"
[ "$total" -gt 0 ] || { echo "refuse: no checks reported on $head"; exit 2; }
bad="$(jq -r '.[]
  | select(.status != "COMPLETED" or ((.conclusion // "") | IN("SUCCESS","SKIPPED","NEUTRAL") | not))
  | "  \(.status) \(.conclusion // "-") \(.name // .context)"' <<<"$checks")"
if [ -n "$bad" ]; then
  echo "refuse: $(wc -l <<<"$bad" | tr -d ' ') of $total checks not green on $head:"; echo "$bad"; exit 1
fi
echo "all $total checks green on $head"

case "$mstate" in
  BEHIND)
    echo "head is behind main; updating the branch. Run again when the new checks finish."
    gh api -X PUT "repos/{owner}/{repo}/pulls/$pr/update-branch" --jq .message; exit 3 ;;
  CLEAN|HAS_HOOKS|UNSTABLE) ;;
  *) echo "refuse: mergeState $mstate"; exit 2 ;;
esac

[ "$mode" = "--check" ] && { echo "check only; not merging"; exit 0; }
# Squash-merge, then delete the remote branch only: --delete-branch also tries
# to switch the local checkout, which fails whenever the branch lives in a
# worktree, and that noise was read as a failed merge once.
branch="$(gh pr view "$pr" --json headRefName --jq .headRefName)"
gh pr merge "$pr" --squash
git push origin --delete "$branch" >/dev/null 2>&1 && echo "remote branch $branch deleted" || echo "remote branch $branch already gone"
