# Mac Mini OpenClaw handlers (CP438)

Shell scripts invoked by the OpenClaw main agent on the Mac Mini in
response to Telegram commands (`/collect`, `/stats`, `/v2 N`) or
scheduled cron jobs.

The OpenClaw agent reads each Telegram message, decides which handler
to run via shell tool, and announces the stdout back to Telegram.

## Files

| Script              | Trigger                  | Purpose                                                                 |
|---------------------|--------------------------|-------------------------------------------------------------------------|
| `_bootstrap.sh`     | sourced by others        | Common env load + PATH + cd to `~/code/insighta`                        |
| `run-collect.sh`    | `/collect` (default 1000)| Runs `mac-mini/video-collector/collect-trending.ts` + tees timestamped log |
| `run-stats.sh`      | `/stats`                 | Composes Telegram-friendly summary from latest collect log              |
| `run-v2.sh`         | `/v2 N`                  | (Phase 1 only) fetch transcript candidates + yt-dlp staging. CC v2 authoring is a manual follow-up step |

## Required Mac Mini env (`~/code/video-dictionary/.env`)

CP438 onboarding adds these atomically; verify with `_bootstrap.sh`
output if anything fails.

- `INSIGHTA_API_URL=https://insighta.one`
- `INTERNAL_BATCH_TOKEN=...`
- `YOUTUBE_API_KEY=...`
- `NAVER_CLIENT_ID=...` / `NAVER_CLIENT_SECRET=...`
- `WEBSHARE_HOST` / `WEBSHARE_PORT` / `WEBSHARE_USERNAME` / `WEBSHARE_PASSWORD`

## Manual smoke (operator)

```bash
ssh macmini bash ~/code/insighta/mac-mini/openclaw-handlers/run-collect.sh 50
ssh macmini bash ~/code/insighta/mac-mini/openclaw-handlers/run-stats.sh
```

## OpenClaw cron registration

```bash
# Mac Mini, twice-daily 09:00 + 20:00 KST (post-stable, after manual smoke):
openclaw cron add \
  --name insighta-collect-am \
  --schedule "0 9 * * *" \
  --tz Asia/Seoul \
  --message "Run ~/code/insighta/mac-mini/openclaw-handlers/run-collect.sh 1000 then post the [done] line to Telegram. After that, run run-stats.sh and post that report too." \
  --delivery telegram

openclaw cron add \
  --name insighta-collect-pm \
  --schedule "0 20 * * *" \
  --tz Asia/Seoul \
  --message "Same as insighta-collect-am — twice-daily for trending freshness." \
  --delivery telegram
```

(Confirm the exact `openclaw cron add` flags via `openclaw cron add --help` —
this README assumes the documented flag names; the agent prompt is the
load-bearing piece either way.)

## Telegram → handler routing

The OpenClaw main agent on the Mac Mini reads incoming messages. Add a
note to `~/clawd/AGENTS.md` (Mac Mini's workspace) like:

```markdown
## Insighta toolkit (CP438)

Telegram commands route to these handlers:
- `/collect` or `/collect 500` → bash ~/code/insighta/mac-mini/openclaw-handlers/run-collect.sh [N]
- `/stats`   → bash ~/code/insighta/mac-mini/openclaw-handlers/run-stats.sh
- `/v2 N`    → bash ~/code/insighta/mac-mini/openclaw-handlers/run-v2.sh N

Always quote the [done] / [aggregate] / 📊 lines back to Telegram.
Long stdout: paste only the last 30 lines.
```

## Hard Rules

- **NO LLM API call** from these handlers (or anything they invoke).
- **yt-dlp via WebShare proxy ONLY** — `WEBSHARE_*` env enforced by
  `collect-trending.ts` at startup; the bootstrap fails fast if missing.
- **No direct DB access from Mac Mini** — all writes go through
  `/api/v1/internal/videos/bulk-upsert` (CP438 PR #580).
- Mandala-derived collection is permanently excluded server-side.
