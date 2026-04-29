# Mac Mini transcript-collector

Runs on the Mac Mini. Pulls candidate video IDs from EC2, fetches
auto-generated YouTube subtitles via `yt-dlp`, strips VTT timing, and
**writes the cleaned transcript to a local staging directory for CC review.
NO POST to EC2.** CC reads the transcript file, authors a v2 layered JSON,
and POSTs to `/api/v1/internal/v2-summary/upsert-direct` manually
(Hard Rule: no LLM API call from any auto path).

## Why fetch-only

- **Hard Rule (2026-04-29)**: any LLM API call is forbidden. The previous
  collector's `POST /transcript/summarize` call triggered a server-side
  OpenRouter generation, which is not permitted. Removing that POST is the
  only way the collector can run without violating the rule.
- **CC drives the v2 generation loop**: CC reads the staged transcript,
  authors the layered v2 JSON (core/analysis/segments/lora) using its
  own context, and POSTs to `upsert-direct`. The 1,507-video Round 2
  expansion uses the same workflow proven on the 20-sample Round 1.

## Why Mac Mini

- The Mac Mini has `yt-dlp` + outbound network and no prod DB credential
  — minimum blast radius for transcript fetching.
- Local-only staging means the transcript text never crosses the EC2
  trust boundary in raw form. Only the CC-authored v2 JSON does.

## Usage

```bash
# 1. Install yt-dlp (homebrew works on macOS):
brew install yt-dlp

# 2. Configure env (DO NOT commit):
export INSIGHTA_API_URL="https://insighta.one"
export INTERNAL_BATCH_TOKEN="<value from credentials.md §INTERNAL_BATCH_TOKEN>"
# Optional knobs:
export TRANSCRIPT_BATCH_SIZE=50
export TRANSCRIPT_YTDLP_TIMEOUT_MS=60000
export YTDLP_BIN=/opt/homebrew/bin/yt-dlp  # if PATH-resolution fails
export TRANSCRIPT_OUTPUT_DIR=/tmp/insighta-transcripts  # default location

# 3. Run from the repo root (or anywhere with the file copied):
npx tsx mac-mini/transcript-collector/collect.ts
```

After a run, `${TRANSCRIPT_OUTPUT_DIR}/<video_id>.txt` files contain
plain-text transcripts. `${TRANSCRIPT_OUTPUT_DIR}/_index.csv` is a
per-attempt log line:

```
<iso8601_ts>,<video_id>,<lang>,saved,<chars>
<iso8601_ts>,<video_id>,<lang>,no_captions
<iso8601_ts>,<video_id>,<lang>,error
```

## CC consumption flow

1. Operator (or cron) runs `collect.ts` on the Mac Mini.
2. CC `scp`s `<video_id>.txt` to its workstation.
3. CC reads the transcript, authors a v2 layered JSON.
4. CC POSTs the JSON to `/api/v1/internal/v2-summary/upsert-direct`.
5. Operator removes the consumed `.txt` from the staging dir.

## Hard-rule compliance

- **No LLM API call**: this script does not POST transcripts to any
  generation endpoint. The only HTTP call it makes is the
  `GET /transcript/candidates` candidate-list fetch.
- **No DB connection**: the script speaks HTTP only.
- **No comment fetching**: per the 2026-04-29 directive, only auto-subs
  (transcript) flow through this pipeline.

## Production wiring

Recommended cron line on the Mac Mini (every day 02:00 KST = 17:00 UTC):

```
0 17 * * * cd /Users/jeonhokim/insighta && /usr/bin/env -i \
  INSIGHTA_API_URL=https://insighta.one \
  INTERNAL_BATCH_TOKEN=$(cat ~/.insighta/internal-token) \
  TRANSCRIPT_OUTPUT_DIR=/tmp/insighta-transcripts \
  /opt/homebrew/bin/npx tsx mac-mini/transcript-collector/collect.ts \
  >> ~/insighta-transcript.log 2>&1
```

(Adjust paths for your install. Operator must populate the token file
beforehand; never commit it.)
