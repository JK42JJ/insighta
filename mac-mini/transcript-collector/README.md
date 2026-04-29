# Mac Mini transcript-collector

Runs on the Mac Mini. Pulls candidate video IDs from EC2, fetches
auto-generated YouTube subtitles via `yt-dlp` (memory only — never written
to disk), POSTs the transcript to EC2 for v2 rich-summary generation,
and discards the transcript.

## Why Mac Mini

- Legal directive: raw transcripts must NOT be persisted in our DB. The
  transcript only lives in process memory on the Mac Mini for the duration
  of one HTTP round-trip to EC2.
- Mac Mini already hosts other yt-dlp / Ollama dependencies and has no
  prod DB credential — minimizes blast radius.

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

# 3. Run from the repo root (or anywhere with the file copied):
npx tsx mac-mini/transcript-collector/collect.ts
```

## Hard-rule compliance

- No DB connection. The script speaks HTTP only.
- No file persistence. `yt-dlp` is invoked with `-o -` (stdout pipe) and
  the captured buffer is converted to text + sent + dropped.
- No comment fetching. Per the 2026-04-29 directive, only auto-subs
  (transcript) flow through this pipeline.

## Production wiring

Recommended cron line on the Mac Mini (every day 02:00 KST = 17:00 UTC,
matching the `RICH_SUMMARY_V2_CRON_SCHEDULE` window so the EC2 generator
quota is not contested by the user-facing wizard):

```
0 17 * * * cd /Users/jeonhokim/insighta && /usr/bin/env -i \
  INSIGHTA_API_URL=https://insighta.one \
  INTERNAL_BATCH_TOKEN=$(cat ~/.insighta/internal-token) \
  /opt/homebrew/bin/npx tsx mac-mini/transcript-collector/collect.ts \
  >> ~/insighta-transcript.log 2>&1
```

(Adjust paths for your install. Operator must populate the token file
beforehand; never commit it.)
