#!/usr/bin/env bash
#
# Writes this run's image tags into staging-images.yaml on branch
# deploy/staging. Called by deploy.yml (publish-staging-tags) from a checkout
# of that branch.
#
#   write-staging-tags.sh <file> <sha> <api_built> <frontend_built> <redis_built>
#
# Only images this run built are moved, for the reason publish-tags gives for
# prod: a tag naming an image that was never pushed is ImagePullBackOff at the
# next sync. A tag left alone keeps naming the last image built for it.
#
# The frontend tag is stg-<sha>, not <sha>. The frontend bundle has the
# Supabase URL compiled in, so staging runs its own build of the same commit.
# The first time one exists, the replicaCount: 0 override that kept a
# prod-built frontend out of staging is removed.

set -euo pipefail

FILE="$1"; SHA="$2"; API="$3"; FE="$4"; RD="$5"

[ -f "$FILE" ] || { echo "no $FILE in this checkout"; exit 1; }
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "not a commit sha: $SHA"; exit 1; }

set_tag() {
  local key="$1" value="$2"
  grep -qE "^  ${key}:" "$FILE" || { echo "$key missing from $FILE"; exit 1; }
  sed -i -E "s|^  ${key}:.*|  ${key}: ${value}|" "$FILE"
}

wrote=0
if [ "$API" = "true" ]; then set_tag apiTag "$SHA"; wrote=$((wrote + 1)); fi
if [ "$RD" = "true" ];  then set_tag redisTag "$SHA"; wrote=$((wrote + 1)); fi
if [ "$FE" = "true" ]; then
  set_tag frontendTag "stg-$SHA"
  wrote=$((wrote + 1))
  # Drop the two-line override block, if it is still there.
  if grep -qE '^frontend:$' "$FILE"; then
    sed -i -E '/^frontend:$/,/^  replicaCount: 0$/d' "$FILE"
    echo "frontend override removed: a staging-built frontend now exists"
  fi
fi

echo "moved $wrote tag(s)"
grep -E '^  (api|frontend|redis)Tag:' "$FILE"
