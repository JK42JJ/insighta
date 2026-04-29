#!/bin/bash
# Common bootstrap for Mac Mini OpenClaw handlers (CP438).
# Sources env vars + sets PATH + cd to Insighta repo.
# Sourced by run-collect.sh / run-stats.sh / run-v2.sh.

# .env is at the Mac Mini's video-dictionary root (CP438 onboarding location).
ENV_FILE="${MAC_MINI_ENV_FILE:-/Users/jamesjk/code/video-dictionary/.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "[bootstrap] WARN: env file not found at $ENV_FILE" >&2
fi

# Mac Mini PATH — ensures node, npm, npx, tsx, openclaw, yt-dlp, uv resolve.
export PATH="${PATH}:/usr/local/bin:/opt/homebrew/bin:${HOME}/.npm-global/bin"

# Insighta repo root (default; override with INSIGHTA_REPO env if needed).
export INSIGHTA_REPO="${INSIGHTA_REPO:-${HOME}/code/insighta}"

if [ ! -d "$INSIGHTA_REPO" ]; then
  echo "[bootstrap] FATAL: INSIGHTA_REPO not found at $INSIGHTA_REPO" >&2
  return 1 2>/dev/null || exit 1
fi

cd "$INSIGHTA_REPO"
