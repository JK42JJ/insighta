#!/usr/bin/env bash
#
# Rotate the YouTube OAuth client secret on the production side.
#
#   scripts/ops/rotate-youtube-oauth-secret.sh /path/to/new-secret.txt
#
# The file holds the new secret and nothing else (one line, from "Add secret"
# in the Google Cloud console). The value is never printed; every report line
# shows the first twelve characters of its sha256 instead, so the same hash
# can be checked against the running pod afterwards.
#
# What it does, in order:
#   1. sanity-check the file (GOCSPX- prefix, one line, mode not world-readable)
#   2. patch the cluster secret insighta-env, key YOUTUBE_CLIENT_SECRET,
#      sending the value over the SSH session's stdin (not in the command line)
#   3. set the GitHub repository secret of the same name
#   4. restart api and worker and wait for the rollouts
#   5. read the key back from a running api pod and compare hashes
#   6. remove the input file
#
# What it does not do, and what stays manual:
#   - the Supabase Auth Google provider (dashboard) and the local .env, which
#     use the same OAuth client (verified by client id hash on 2026-09-11)
#   - disabling the old secret in the Google console, which comes after a
#     YouTube token refresh has been seen to work with the new one

set -euo pipefail

FILE="${1:-}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "usage: $0 <file containing the new client secret>" >&2; exit 1; }

case "$(stat -f '%Lp' "$FILE" 2>/dev/null || stat -c '%a' "$FILE")" in
  *[1-7]) echo "[rotate] refusing: $FILE is readable by group or others; chmod 600 it first" >&2; exit 1 ;;
esac

NEW=$(tr -d '\r\n' < "$FILE")
case "$NEW" in
  GOCSPX-*) ;;
  *) echo "[rotate] refusing: the file does not look like a Google OAuth client secret" >&2; exit 1 ;;
esac
[ "$(wc -l < "$FILE" | tr -d ' ')" -le 1 ] || { echo "[rotate] refusing: more than one line in $FILE" >&2; exit 1; }

H() { printf '%s' "$1" | sha256sum | cut -c1-12; }
NEW_HASH=$(H "$NEW")
echo "[rotate] new secret hash $NEW_HASH"

SSH="scripts/ops/ssh.sh"
NS=insighta-prod
K="sudo k3s kubectl -n $NS"

# stdin must reach the remote shell, or the value cannot travel without
# appearing in a command line. Prove it before relying on it.
[ "$(printf 'probe' | bash "$SSH" k3s 'cat' 2>/dev/null)" = "probe" ] \
  || { echo "[rotate] the SSH helper does not forward stdin; aborting before any change" >&2; exit 1; }

OLD_HASH=$(bash "$SSH" k3s "$K get secret insighta-env -o jsonpath='{.data.YOUTUBE_CLIENT_SECRET}' | base64 -d | sha256sum | cut -c1-12" 2>/dev/null | tail -1)
echo "[rotate] cluster secret before: $OLD_HASH"

printf '%s' "$NEW" | base64 | tr -d '\n' | bash "$SSH" k3s \
  "V=\$(cat); $K patch secret insighta-env --type=merge -p \"{\\\"data\\\":{\\\"YOUTUBE_CLIENT_SECRET\\\":\\\"\$V\\\"}}\"" >/dev/null
echo "[rotate] cluster secret patched"

gh secret set YOUTUBE_CLIENT_SECRET < "$FILE" >/dev/null
echo "[rotate] github secret set"

bash "$SSH" k3s "$K rollout restart deploy/insighta-api deploy/insighta-worker && $K rollout status deploy/insighta-api --timeout=180s && $K rollout status deploy/insighta-worker --timeout=180s" >/dev/null
echo "[rotate] api and worker restarted"

POD_HASH=$(bash "$SSH" k3s "$K exec deploy/insighta-api -- sh -c 'printf %s \"\$YOUTUBE_CLIENT_SECRET\" | sha256sum | cut -c1-12'" 2>/dev/null | tail -1)
if [ "$POD_HASH" = "$NEW_HASH" ]; then
  echo "[rotate] verified: running api pod carries $POD_HASH"
else
  echo "[rotate] MISMATCH: pod carries $POD_HASH, expected $NEW_HASH -- investigate before disabling the old secret" >&2
  exit 2
fi

rm -P "$FILE" 2>/dev/null || rm -f "$FILE"
echo "[rotate] input file removed"
cat <<'NEXT'
[rotate] remaining manual steps:
  1. Supabase dashboard -> Authentication -> Providers -> Google: paste the new secret, save.
  2. Local .env YOUTUBE_CLIENT_SECRET: update by hand (the .env file is never edited by automation).
  3. Sign in with Google once and run one YouTube playlist sync on an already-linked account.
  4. Google Cloud console -> the OAuth client -> old secret: Disable. Re-run step 3. Then Delete.
  5. GitHub -> Security -> Secret scanning -> alerts #2 and #3: close as revoked.
NEXT
