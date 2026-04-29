#!/bin/bash
# Process ONE video: yt-dlp transcript → claude -p (v2 schema) → POST upsert-direct.
# Args: $1 = youtube_video_id  $2 = source_language (ko|en)
# Env: INSIGHTA_API_URL / INTERNAL_BATCH_TOKEN / WEBSHARE_* (sourced by caller)
# Exit 0 = pass, 1 = no_caption, 2 = claude_invalid_json, 3 = upsert_failed
# stdout: single line "[<vid>] <result>" suitable for batch.sh aggregation.

set -uo pipefail

VID="$1"
LANG="${2:-ko}"
LOG_DIR="${V2_LOG_DIR:-/tmp/insighta-v2-batch}"
mkdir -p "$LOG_DIR"

YTDLP_BIN="${YTDLP_BIN:-/opt/homebrew/bin/yt-dlp}"
PROXY="http://${WEBSHARE_USERNAME}:${WEBSHARE_PASSWORD}@${WEBSHARE_HOST}:${WEBSHARE_PORT}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 1. yt-dlp auto-subs
"$YTDLP_BIN" \
  --write-auto-subs --sub-format vtt --sub-lang "$LANG" --skip-download \
  --proxy "$PROXY" --socket-timeout 20 \
  -o "$TMP/%(id)s.%(ext)s" \
  "https://www.youtube.com/watch?v=$VID" >"$TMP/ytdlp.log" 2>&1 || true

VTT=$(ls "$TMP"/*.vtt 2>/dev/null | head -1)
if [ -z "$VTT" ]; then
  echo "[$VID] no_caption" | tee "$LOG_DIR/$VID.log"
  exit 1
fi

# 2. Strip VTT timing → plain text. Dedupe consecutive identical lines (auto-caps cue artifacts).
TRANSCRIPT=$(awk '
  /^WEBVTT/ || /^Kind:/ || /^Language:/ || /^[0-9]+:[0-9]+/ || /-->/ || /^align:/ || /^position:/ { next }
  /^$/ { next }
  { gsub(/<[^>]*>/, ""); gsub(/&nbsp;/, " "); print }
' "$VTT" | awk '!seen[$0]++' | head -c 30000)

if [ ${#TRANSCRIPT} -lt 200 ]; then
  echo "[$VID] no_caption (transcript too short: ${#TRANSCRIPT} chars)" | tee "$LOG_DIR/$VID.log"
  exit 1
fi

# 3. Build prompt + invoke claude -p
PROMPT_HEADER='You are a JSON authoring tool for Insighta. Author a strict v2 layered JSON for the YouTube video below from its transcript.

Schema (no extra keys, no markdown fences, JSON only):
{
  "core": {
    "one_liner": string (under 40 chars, ko or en),
    "domain": "tech"|"learning"|"health"|"business"|"finance"|"social"|"creative"|"lifestyle"|"mind",
    "depth_level": "beginner"|"intermediate"|"advanced",
    "content_type": "tutorial"|"explainer"|"case_study"|"review"|"discussion"|"vlog"|"news",
    "target_audience": string
  },
  "analysis": {
    "core_argument": string (1 sentence, hand-authored summary),
    "key_concepts": [{"term": string, "definition": string}, ...],
    "actionables": [string, ...],
    "mandala_fit": {"suggested_goals": [string, ...], "relevance_rationale": string},
    "bias_signals": {"has_ad": bool, "is_sponsored": bool, "subjectivity_level": "low"|"medium"|"high", "notes": string},
    "prerequisites": string
  },
  "segments": {
    "sections": [{"idx": int, "title": string, "from_sec": int, "to_sec": int, "summary": string}, ...],
    "atoms": [{"idx": int, "type": "fact"|"tip"|"argument", "text": string, "timestamp_sec": int}, ...]
  },
  "lora": {
    "qa_pairs": [{"level": 1|2|3, "q": string, "a": string, "context": "video"|"general"}, ...]
  }
}

Rules:
- completeness must be ≥0.9: 4+ key_concepts, 4+ actionables, 4+ sections, 4+ atoms, 4+ qa_pairs.
- timestamp_sec / from_sec / to_sec are integers in seconds (NOT mm:ss).
- Output JSON only — no preamble, no markdown.
'

CLAUDE_BIN="${CLAUDE_BIN:-$(which claude 2>/dev/null || echo "$HOME/.npm-global/bin/claude")}"

V2_JSON=$(printf '%s\n\nVideo: %s\nLanguage: %s\nTranscript:\n%s\n' "$PROMPT_HEADER" "$VID" "$LANG" "$TRANSCRIPT" \
  | "$CLAUDE_BIN" -p 2>"$LOG_DIR/$VID.claude.err")

# Strip optional markdown fences if claude added them despite instructions.
V2_JSON=$(printf '%s' "$V2_JSON" | sed -e 's/^```json//' -e 's/^```//' -e 's/```$//' | sed '/^$/d')

if ! printf '%s' "$V2_JSON" | jq -e . >/dev/null 2>&1; then
  echo "[$VID] claude_invalid_json" | tee "$LOG_DIR/$VID.log"
  printf '%s' "$V2_JSON" | head -c 500 > "$LOG_DIR/$VID.invalid.json"
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
