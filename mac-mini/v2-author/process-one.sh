#!/bin/bash
# Process ONE video: transcript fetch → claude -p (v2 schema) → POST upsert-direct.
# Args: $1 = youtube_video_id  $2 = source_language (ko|en)
# Env: INSIGHTA_API_URL / INTERNAL_BATCH_TOKEN
#      TRANSCRIPT_FETCHER (default 'ytapi'; 'ytdlp' for legacy WebShare path)
#      For ytdlp path: WEBSHARE_* required.
# Exit 0 = pass, 1 = no_caption, 2 = claude_invalid_json, 3 = upsert_failed
# stdout: single line "[<vid>] <result>" suitable for batch.sh aggregation.

set -uo pipefail

VID="$1"
LANG="${2:-ko}"
LOG_DIR="${V2_LOG_DIR:-/tmp/insighta-v2-batch}"
mkdir -p "$LOG_DIR"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRANSCRIPT_FETCHER="${TRANSCRIPT_FETCHER:-ytapi}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# CP438+1 (2026-05-03): stamp transcript_attempted_at on videos we tried but
# could not author (no_caption / claude_invalid_json) so the candidates
# selector excludes them for 7-day cooldown. Fire-and-forget — never block
# the per-video pipeline on the mark request.
mark_attempted() {
  curl -sS --max-time 5 \
    -X POST "${INSIGHTA_API_URL%/}/api/v1/internal/transcript/mark-attempted" \
    -H "x-internal-token: ${INTERNAL_BATCH_TOKEN}" \
    -H 'content-type: application/json' \
    --data "{\"videoId\":\"$1\"}" >/dev/null 2>&1 || true
}

# 1. Transcript fetch — youtube-transcript-api (default) or yt-dlp (legacy).
if [ "$TRANSCRIPT_FETCHER" = "ytapi" ]; then
  # Direct YouTube web-client API. No proxy required.
  TRANSCRIPT=$(python3 "$DIR/fetch-transcript.py" "$VID" "$LANG" 2>"$LOG_DIR/$VID.fetch.err")
  FETCH_RC=$?
  if [ $FETCH_RC -ne 0 ] || [ -z "$TRANSCRIPT" ]; then
    REASON=$(head -c 120 "$LOG_DIR/$VID.fetch.err" 2>/dev/null | tr '\n' ' ')
    echo "[$VID] no_caption ($REASON)" | tee "$LOG_DIR/$VID.log"
    mark_attempted "$VID"
    exit 1
  fi
else
  # Legacy yt-dlp + WebShare path. Used when TRANSCRIPT_FETCHER=ytdlp.
  YTDLP_BIN="${YTDLP_BIN:-/opt/homebrew/bin/yt-dlp}"
  PROXY="http://${WEBSHARE_USERNAME}:${WEBSHARE_PASSWORD}@${WEBSHARE_HOST}:${WEBSHARE_PORT}"
  "$YTDLP_BIN" \
    --write-auto-subs --sub-format vtt --sub-lang "$LANG" --skip-download \
    --proxy "$PROXY" --socket-timeout 20 \
    -o "$TMP/%(id)s.%(ext)s" \
    "https://www.youtube.com/watch?v=$VID" >"$TMP/ytdlp.log" 2>&1 || true
  VTT=$(ls "$TMP"/*.vtt 2>/dev/null | head -1)
  if [ -z "$VTT" ]; then
    echo "[$VID] no_caption" | tee "$LOG_DIR/$VID.log"
    mark_attempted "$VID"
    exit 1
  fi
  TRANSCRIPT=$(awk '
    /^WEBVTT/ || /^Kind:/ || /^Language:/ || /^[0-9]+:[0-9]+/ || /-->/ || /^align:/ || /^position:/ { next }
    /^$/ { next }
    { gsub(/<[^>]*>/, ""); gsub(/&nbsp;/, " "); print }
  ' "$VTT" | awk '!seen[$0]++' | head -c 30000)
fi

if [ ${#TRANSCRIPT} -lt 200 ]; then
  echo "[$VID] no_caption (transcript too short: ${#TRANSCRIPT} chars)" | tee "$LOG_DIR/$VID.log"
  mark_attempted "$VID"
  exit 1
fi

# 3. Build prompt + invoke claude -p
# Schema synced to src/modules/skills/rich-summary-v2-prompt.ts SSOT (CP438):
#   content_type:  tutorial | lecture | vlog | interview | documentary | review (NOT explainer/case_study/discussion/news)
#   one_liner:     ≤ 20 chars (NOT 40)
#   qa context:    video | mandala_cell | mandala_mesh (NOT general)
#   PASS_THRESHOLD = 0.7; MIN_KEY_CONCEPTS=3, MIN_ACTIONABLES=3, MIN_QA_PAIRS_L1=5
# Drift prior to this fix caused completeness penalty + occasional 422 reject.
PROMPT_HEADER='You are a JSON authoring tool for Insighta. Author a strict v2 layered JSON for the YouTube video below from its transcript.

Schema (no extra keys, no markdown fences, JSON only):
{
  "core": {
    "one_liner": string (≤ 20 chars, in source language),
    "domain": "tech"|"learning"|"health"|"business"|"finance"|"social"|"creative"|"lifestyle"|"mind",
    "depth_level": "beginner"|"intermediate"|"advanced",
    "content_type": "tutorial"|"lecture"|"vlog"|"interview"|"documentary"|"review",
    "target_audience": string
  },
  "analysis": {
    "core_argument": string (2-3 sentences capturing the central thesis),
    "key_concepts": [{"term": string, "definition": string}, ... 3-5 entries],
    "actionables": [string, ... 3-5 entries, each a single imperative sentence],
    "mandala_fit": {"suggested_goals": [string, ... 2-4 phrases], "relevance_rationale": string},
    "bias_signals": {"has_ad": bool, "is_sponsored": bool, "subjectivity_level": "low"|"medium"|"high", "notes": string},
    "prerequisites": string
  },
  "segments": {
    "sections": [{"idx": int, "title": string, "from_sec": int, "to_sec": int, "summary": string}, ... 4+ entries],
    "atoms": [{"idx": int, "type": "fact"|"tip"|"argument", "text": string, "timestamp_sec": int}, ... 4+ entries]
  },
  "lora": {
    "qa_pairs": [{"level": 1, "q": string, "a": string, "context": "video"}, ... 5-7 entries, all level=1, all context="video"]
  }
}

Rules:
- core.one_liner: ≤ 20 chars, no quotes, no trailing punctuation.
- core.domain MUST be one of the 9 slugs above.
- core.content_type MUST be one of the 6 enum values above.
- analysis.actionables: each a single imperative sentence the viewer can do today.
- lora.qa_pairs: 5-7 entries, all level=1, all context="video".
- timestamp_sec / from_sec / to_sec are integers in seconds (NOT mm:ss).
- Use the source language consistently across every string field.
- Output JSON only — no preamble, no markdown fences, no commentary.
'

CLAUDE_BIN="${CLAUDE_BIN:-$(which claude 2>/dev/null || echo "$HOME/.npm-global/bin/claude")}"

# `claude -p` MUST authenticate via the user's CC subscription (OAuth in
# keychain). If ANTHROPIC_API_KEY is set in the environment, claude CLI
# uses that API key path instead — and the prod ANTHROPIC_API_KEY env on
# Mac Mini has no active billing → "Invalid API key · Fix external API
# key" returned and every call silently fails. Strip the env so OAuth
# wins (CP438 — 2026-04-30 batch incident: 1,527/1,540 invalid_json).
V2_JSON=$(printf '%s\n\nVideo: %s\nLanguage: %s\nTranscript:\n%s\n' "$PROMPT_HEADER" "$VID" "$LANG" "$TRANSCRIPT" \
  | env -u ANTHROPIC_API_KEY "$CLAUDE_BIN" -p 2>"$LOG_DIR/$VID.claude.err")

# Strip optional markdown fences if claude added them despite instructions.
V2_JSON=$(printf '%s' "$V2_JSON" | sed -e 's/^```json//' -e 's/^```//' -e 's/```$//' | sed '/^$/d')

if ! printf '%s' "$V2_JSON" | jq -e . >/dev/null 2>&1; then
  echo "[$VID] claude_invalid_json" | tee "$LOG_DIR/$VID.log"
  printf '%s' "$V2_JSON" | head -c 500 > "$LOG_DIR/$VID.invalid.json"
  mark_attempted "$VID"
  exit 2
fi

# 4. POST upsert-direct
PAYLOAD=$(printf '%s' "$V2_JSON" | jq -c \
  --arg vid "$VID" --arg lang "$LANG" \
  '{videoId: $vid, sourceLanguage: $lang, stampTranscriptFetchedAt: true, core, analysis, lora, segments}')

RESP=$(printf '%s' "$PAYLOAD" | curl -sS \
  -X POST "${INSIGHTA_API_URL%/}/api/v1/internal/v2-summary/upsert-direct" \
  -H "x-internal-token: ${INTERNAL_BATCH_TOKEN}" \
  -H 'content-type: application/json' \
  --data-binary @-)

if printf '%s' "$RESP" | jq -e '.kind == "pass"' >/dev/null 2>&1; then
  COMP=$(printf '%s' "$RESP" | jq -r '.completeness')
  echo "[$VID] pass completeness=$COMP" | tee "$LOG_DIR/$VID.log"
  exit 0
else
  ERR=$(printf '%s' "$RESP" | jq -r '.error // "unknown"' 2>/dev/null || echo "unparseable")
  echo "[$VID] upsert_failed err=$ERR" | tee "$LOG_DIR/$VID.log"
  printf '%s' "$RESP" | head -c 500 >> "$LOG_DIR/$VID.log"
  exit 3
fi
