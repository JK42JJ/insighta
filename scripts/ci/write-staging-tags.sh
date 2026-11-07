#!/usr/bin/env bash
#
# Writes this run's image tags into staging-images.yaml on branch
# deploy/staging. Called by deploy.yml (publish-staging-tags) from a checkout
# of that branch.
#
#   write-staging-tags.sh <file> <sha> <api_built> <frontend_built> <redis_built> [agent_run]
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

FILE="$1"; SHA="$2"; API="$3"; FE="$4"; RD="$5"; AGENT="${6:-false}"

[ -f "$FILE" ] || { echo "no $FILE in this checkout"; exit 1; }
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "not a commit sha: $SHA"; exit 1; }

# sed without -i, so the script behaves the same with GNU sed (the runner) and BSD sed (a laptop).
sedi() { local expr="$1"; sed -E "$expr" "$FILE" > "$FILE.new" && mv "$FILE.new" "$FILE"; }

set_tag() {
  local key="$1" value="$2"
  grep -qE "^  ${key}:" "$FILE" || { echo "$key missing from $FILE"; exit 1; }
  sedi "s|^  ${key}:.*|  ${key}: ${value}|"
}

# An agent branch run (staging_only) pushes api and frontend to the dedicated staging repositories (insighta-stg-api, insighta-stg-frontend), tagged with the
# plain commit. The chart takes the repository name from api.image.repository / frontend.image.repository, so the override is a values block between markers;
# a later main run that builds the same image removes it and the image comes from the shared repository again. Tag and repository always move together.
drop_repo() { sedi "/^# stg-repo-override $1 begin\$/,/^# stg-repo-override $1 end\$/d"; }
put_repo() {
  drop_repo "$1"
  printf '# stg-repo-override %s begin\n%s:\n  image:\n    repository: %s\n# stg-repo-override %s end\n' "$1" "$1" "$2" "$1" >> "$FILE"
}

wrote=0
if [ "$API" = "true" ]; then
  set_tag apiTag "$SHA"; wrote=$((wrote + 1))
  if [ "$AGENT" = "true" ]; then put_repo api insighta-stg-api; else drop_repo api; fi
fi
if [ "$RD" = "true" ];  then set_tag redisTag "$SHA"; wrote=$((wrote + 1)); fi
if [ "$FE" = "true" ]; then
  if [ "$AGENT" = "true" ]; then set_tag frontendTag "$SHA"; else set_tag frontendTag "stg-$SHA"; fi
  wrote=$((wrote + 1))
  # Drop the two-line replicaCount: 0 override block, if it is still there (only that pair: the repository override block below also starts with "frontend:").
  if grep -qE '^frontend:$' "$FILE"; then
    sedi '/^frontend:$/{N;/\n  replicaCount: 0$/d;}'
    echo "frontend replicaCount override removed: a staging-built frontend now exists"
  fi
  if [ "$AGENT" = "true" ]; then put_repo frontend insighta-stg-frontend; else drop_repo frontend; fi
fi

echo "moved $wrote tag(s)"
grep -E '^  (api|frontend|redis)Tag:|^    repository:' "$FILE"
