# Mac Mini video-collector (CP438, 2026-04-29)

Pulls trending YouTube videos from 4 sources and POSTs metadata in batches
to Insighta's `/api/v1/internal/videos/bulk-upsert`. The endpoint applies
a server-side quality gate (duration / title length / blocklist) and
dedupes via `ON CONFLICT (youtube_video_id) DO NOTHING`.

## Source mix (default target = 1000 videos/run)

| Slot | Pct | Source                                   | Output    |
|------|-----|------------------------------------------|-----------|
| S1   | 40% | YT Data API `mostPopular` per `videoCategoryId` (10 cats × KR/US) | full meta |
| S2   | 25% | Naver DataLab (split 5+4 groups) → keywords → yt-dlp search (concurrency=10) | bare IDs |
| S3   | 20% | YT Data API `chart=mostPopular` generic (KR + US, max 50/region) | full meta |
| S4   | 15% | 9-domain × 5 trendy keywords, top 50% per cell (concurrency=10) | bare IDs |

**Note (CP438 smoke 2026-04-29)**: yt-dlp `/feed/trending` was retired
because YouTube discontinued the public trending URL (now redirects to
home). Google Trends fallback was retired because pytrends
`trending_searches()` returns 404. Both source slots are absorbed into
the YT Data API path.

Bare IDs are enriched via YouTube Data API `videos.list` (50/call,
1 quota/call). 1000-video run consumes ~20 quota + WebShare proxy
calls. With concurrency=10 the wall-clock is **~3 min/run** (vs ~10 min
sequential). YouTube hard-caps `chart=mostPopular` at 50 results per
region, so S3 returns ≤100 per run regardless of budget; the rest of
the slot is absorbed by upstream sources via dedupe.

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
COLLECT_TARGET_TOTAL=1000      # default (was 175 before CP438 phase 2)
COLLECT_DRY_RUN=1              # set to skip POST (debug)
S2_CONCURRENCY=10              # parallel yt-dlp search for Naver keywords
S4_CONCURRENCY=10              # parallel yt-dlp search for 9-domain × 5 keywords
YTDLP_BIN=/opt/homebrew/bin/yt-dlp
```

## Manual run (CP438 phase 1 — pre-cron)

```bash
# scp the script tree to Mac Mini, OR clone Insighta repo there.
# Then from the repo root:
cd /path/to/insighta-repo
set -a && source /Users/jamesjk/code/video-dictionary/.env && set +a
npx tsx mac-mini/video-collector/collect-trending.ts
```

Expected output (target=1000, concurrency=10, truncated):

```
[collect-trending] target=1000 s2_conc=10 s4_conc=10 budgets={ ytdlpTrending: 400, naverGT: 250, mostPopular: 200, domainKeywords: 150 }
[s1 ytdlp_trending] { kr_count: 200, us_count: 200, dedup_count: 380, errors: [] }
[s2 naver+gt] keywords=14 ids=240 (dedup) { naver: { ... } }
[s3 mostPopular] { per_region: { KR: 50, US: 50 }, dedup_count: 95, errors: [] }
[s4 domain_keywords] { keywords_total: 45, results_pre_dedup: 225, results_post_dedup: 180, concurrency: 10 }
[aggregate] s1=400 s2=250 s3=95 s4=150 → enrich_input=800 enriched=780 total=875
[post] batch 0 { received: 200, inserted: 165, skipped_duplicate: 0, skipped_filter: 35, ... }
[post] batch 1 { received: 200, inserted: 168, skipped_duplicate: 0, skipped_filter: 32, ... }
[post] batch 2 { received: 200, inserted: 162, skipped_duplicate: 5, skipped_filter: 33, ... }
[post] batch 3 { received: 200, inserted: 160, skipped_duplicate: 8, skipped_filter: 32, ... }
[post] batch 4 { received: 75, inserted: 60, skipped_duplicate: 3, skipped_filter: 12, ... }
[done] { posted: 875, inserted: 715, skipped_filter: 144, skipped_duplicate: 16, db_errors: 0 }
```

## Cron (CP438 phase 2 — after stable)

Twice-daily schedule (08:00 + 20:00 KST) reaches ~2000 unique videos
in ~1-2 days; after that the trending feed dedup ratio rises and
yields drop. Use `StartCalendarInterval` array for two daily fires:

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
  <array>
    <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>20</integer><key>Minute</key><integer>0</integer></dict>
  </array>
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
