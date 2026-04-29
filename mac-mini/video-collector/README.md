# Mac Mini video-collector (CP438, 2026-04-29)

Pulls trending YouTube videos from 4 sources and POSTs metadata in batches
to Insighta's `/api/v1/internal/videos/bulk-upsert`. The endpoint applies
a server-side quality gate (duration / title length / blocklist) and
dedupes via `ON CONFLICT (youtube_video_id) DO NOTHING`.

## Source mix (default target = 175 videos/run)

| Slot | Pct | Source                                   | Output    |
|------|-----|------------------------------------------|-----------|
| S1   | 40% | yt-dlp trending feed (KR + US)           | bare IDs  |
| S2   | 25% | Naver DataLab → keywords → yt-dlp search | bare IDs  |
| S2b  |  -  | Google Trends (pytrends) fallback when Naver < 8 keywords | bare IDs |
| S3   | 20% | YouTube Data API `chart=mostPopular`     | full meta |
| S4   | 15% | 9-domain × 5 trendy keywords (top 50% per cell) | bare IDs |

Bare IDs are enriched via YouTube Data API `videos.list` (50/call,
1 quota/call). 175-video run consumes ~3-4 quota plus the per-source
calls.

## Hard Rules

- **NO LLM API call** anywhere in this script.
- yt-dlp **MUST** route through the WebShare rotating proxy. Direct
  YouTube traffic bot-gates the IP within minutes (CP401/CP411 LEVEL-2).
- Mandala-derived collection is permanently excluded — this collector is
  the source-of-truth for new pool entries.

## Setup

```bash
# 1. Install yt-dlp (homebrew on macOS)
brew install yt-dlp

# 2. Ensure pytrends is available via uv (already installed in
#    /Users/jamesjk/code/video-dictionary). The orchestrator spawns
#    `uv run --with pytrends python sources/google-trends.py`.

# 3. Configure env (Mac Mini ~/code/video-dictionary/.env already has
#    these from CP438 onboarding):
INSIGHTA_API_URL=https://insighta.one
INTERNAL_BATCH_TOKEN=<from credentials.md>
YOUTUBE_API_KEY=<server key>
NAVER_CLIENT_ID=<from credentials.md>
NAVER_CLIENT_SECRET=<from credentials.md>
WEBSHARE_HOST=...
WEBSHARE_PORT=...
WEBSHARE_USERNAME=...
WEBSHARE_PASSWORD=...

# Optional knobs:
COLLECT_TARGET_TOTAL=175       # default
COLLECT_DRY_RUN=1              # set to skip POST (debug)
YTDLP_BIN=/opt/homebrew/bin/yt-dlp
UV_BIN=/opt/homebrew/bin/uv
UV_PROJECT_DIR=/Users/jamesjk/code/video-dictionary
```

## Manual run (CP438 phase 1 — pre-cron)

```bash
# scp the script tree to Mac Mini, OR clone Insighta repo there.
# Then from the repo root:
cd /path/to/insighta-repo
set -a && source /Users/jamesjk/code/video-dictionary/.env && set +a
npx tsx mac-mini/video-collector/collect-trending.ts
```

Expected output (truncated):

```
[collect-trending] target=175 budgets={ ytdlpTrending: 70, naverGT: 44, mostPopular: 35, domainKeywords: 26 }
[s1 ytdlp_trending] { kr_count: 50, us_count: 50, dedup_count: 95, errors: [] }
[s2 naver+gt] keywords=12 ids=44 (dedup) { naver: { groups_returned: 9, top_groups: [...] } }
[s3 mostPopular] { per_region: { KR: 50, US: 50 }, dedup_count: 88, errors: [] }
[s4 domain_keywords] { keywords_total: 45, results_pre_dedup: 90, results_post_dedup: 78, ... }
[aggregate] s1=70 s2=44 s3=35 s4=26 → enrich_input=140 enriched=138 total=173
[post] batch 0 { received: 173, inserted: 145, skipped_duplicate: 0, skipped_filter: 28, db_errors: 0, filter_breakdown: {...} }
[done] { posted: 173, inserted: 145, skipped_filter: 28, skipped_duplicate: 0, db_errors: 0 }
```

## Cron (CP438 phase 2 — after stable)

Once the manual flow is stable, schedule via launchd:

```xml
<!-- ~/Library/LaunchAgents/com.insighta.video-collector.plist -->
<plist version="1.0">
<dict>
  <key>Label</key><string>com.insighta.video-collector</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>set -a; source /Users/jamesjk/code/video-dictionary/.env; set +a; cd /Users/jamesjk/code/insighta && npx tsx mac-mini/video-collector/collect-trending.ts >> /Users/jamesjk/Library/Logs/insighta-video-collector.log 2>&1</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>
</dict>
</plist>
```

## Quality gate (server-side, CP438 spec §2)

The endpoint silently filters and reports counts in `filter_breakdown`:

| Reason key            | Filter                                                |
|-----------------------|-------------------------------------------------------|
| `no_video_id`         | missing or empty `youtube_video_id`                  |
| `duplicate_in_batch`  | same id seen earlier in the same POST                |
| `title_too_short`     | `title.length < 5`                                    |
| `blocklist:<token>`   | title contains 광고 / PPL / 협찬 / sponsored / 드라마 / 팬편집 |
| `too_short`           | `duration_seconds < 180`                             |
| `too_long`            | `duration_seconds > 3600`                            |

`null` duration passes the gate (yt-dlp's `--print id` does not return
duration; the server intentionally does not reject these).

## Files

- `collect-trending.ts` — orchestrator entry point.
- `keyword-templates.json` — 9 × 5 trendy seed keywords (CC initial draft, user reviewable).
- `sources/types.ts` — shared types.
- `sources/youtube-metadata.ts` — bulk metadata enrichment (videos.list).
- `sources/ytdlp-trending.ts` — Source 1.
- `sources/naver-datalab.ts` — Source 2 primary.
- `sources/google-trends.py` — Source 2 fallback (Python).
- `sources/google-trends-spawn.ts` — TS spawn helper for the .py.
- `sources/youtube-mostpopular.ts` — Source 3.
- `sources/domain-keywords.ts` — Source 4.
