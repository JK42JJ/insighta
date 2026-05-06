# Transcript Cache Policy (CP438+2 / PR #604)

**Status**: Active since 2026-05-06.
**Scope**: Mac Mini v2-author batch (`mac-mini/v2-author/`). No server-side / cloud component.

## Why this exists

Prior to PR #604 the v2 batch fetched a YouTube transcript, fed it to `claude -p`, then discarded the transcript text. Two consequences:

1. **Re-processing was expensive.** PR #603 fixed atom timestamp hallucination (471 / 897 v2 rows contaminated, 14.7% over-duration atoms). The fix required re-running `claude -p` with the timestamp-marker-preserving prompt — but that meant re-fetching every transcript, burning WebShare quota / triggering YouTube IpBlocked.
2. **Future schema/prompt fixes** would face the same penalty.

Caching the transcript locally on Mac Mini makes re-processing free.

## Legal boundary

The codebase directive (`src/api/routes/internal/transcript.ts:16-17`) prohibits **persistent storage of transcript text in the DB or in cloud services**. This policy does NOT violate it because:

- The cache lives on the Mac Mini local disk only — never synced, never uploaded.
- Cache directory is `chmod 700`; cache files `chmod 600`.
- Files are deleted automatically on validation success (kind=pass + completeness ≥ 0.7).
- A 30-day TTL fail-safe (`cleanup-transcript-cache.sh`) bounds retention even for failed re-processing candidates.

A short-lived bounded local cache with explicit deletion semantics is not "persistence" in the directive's sense.

## Mechanism

| Stage | File | Action |
|---|---|---|
| `process-one.sh` start | `$TRANSCRIPT_CACHE_DIR/<vid>.txt` | If exists & ≥ 200 chars → use, skip YouTube fetch (`CACHE_HIT=1`) |
| Fresh fetch success | `$TRANSCRIPT_CACHE_DIR/<vid>.txt` | Write transcript, `chmod 600` |
| `upsert-direct` returns `kind=pass` & `completeness ≥ 0.7` | cache file | **Delete** (validation event) |
| Any failure (`no_caption`, `claude_invalid_json`, `upsert_failed`) | cache file | **Retain** for free re-run |
| Daily cron 03:00 | `cleanup-transcript-cache.sh` | Delete files older than `TRANSCRIPT_CACHE_TTL_DAYS` (default 30) |

### Environment knobs

| Var | Default | Purpose |
|---|---|---|
| `TRANSCRIPT_CACHE_DIR` | `$HOME/.insighta/transcript-cache` | Cache root |
| `TRANSCRIPT_CACHE_TTL_DAYS` | `30` | TTL for `cleanup-transcript-cache.sh` |
| `KEEP_UNTIL_M3` | `0` | If `1`, retain even on pass — wait for manual `M3='real'` review before delete |

## Operational tasks

### One-time setup on Mac Mini

```bash
# 1. Pull PR #604
cd ~/insighta && git pull

# 2. Verify cache dir auto-creates on next batch run
ls -la ~/.insighta/transcript-cache 2>/dev/null || echo "(will be created by next batch.sh)"

# 3. Install LaunchAgent for daily cleanup (see template below)
launchctl load ~/Library/LaunchAgents/com.insighta.transcript-cache-cleanup.plist
```

### LaunchAgent template

`~/Library/LaunchAgents/com.insighta.transcript-cache-cleanup.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.insighta.transcript-cache-cleanup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/insighta/insighta/mac-mini/v2-author/cleanup-transcript-cache.sh</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/tmp/insighta-cache-cleanup.log</string>
  <key>StandardErrorPath</key><string>/tmp/insighta-cache-cleanup.err</string>
</dict></plist>
```

### Manual ops

| Task | Command |
|---|---|
| Inspect cache size | `du -sh ~/.insighta/transcript-cache && ls ~/.insighta/transcript-cache | wc -l` |
| Dry-run TTL cleanup | `bash mac-mini/v2-author/cleanup-transcript-cache.sh --dry-run` |
| Force purge (e.g. legal request) | `rm -rf ~/.insighta/transcript-cache/* && echo purged` |
| Re-process N videos using cache | reset `template_version='v1'` + `transcript_attempted_at=NULL` for target ids → cron picks up → cache hits skip fetch |

## Capacity planning

- Average transcript: ~10-15 KB (30k char cap, after dedup).
- 1000 cached transcripts ≈ 15 MB. Negligible for Mac Mini.
- TTL 30d + delete-on-pass keeps steady-state count near "currently failing" videos.
