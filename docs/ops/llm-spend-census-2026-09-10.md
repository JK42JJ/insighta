# What spends money, measured

2026-09-10. Every LLM call in production for the preceding thirty days, taken
from `llm_call_logs` — the ledger the API writes on each OpenRouter call, with
the billed amount in `cost_usd`.

## The finding

Three GitHub Actions workflows were calling the same endpoint on a schedule,
and they accounted for **87% of all LLM spend** while producing nothing anyone
consumed.

| module | calls (30d) | cost | last call (KST) |
|---|---|---|---|
| `topic-judge` | 265 | **$3.2973** | 09-09 21:27 |
| `trend-extract` | 363 | **$0.7780** | 09-09 21:25 |
| `openrouter` (generic label) | 473 | $0.5025 | 09-02 22:59 |
| `chapter_weave` | 4 | $0.2619 | 09-07 12:30 |
| `card_relevance` | 64 | $0.1112 | 09-07 08:19 |
| `cell_synthesis` | 6 | $0.0849 | 09-07 12:25 |
| `card_cell_judge` | 84 | $0.0551 | 09-07 22:29 |
| `mandala_with_queries` | 11 | $0.0442 | 09-07 22:29 |
| `book_*` (4 modules) | 8 | $0.0892 | 09-07 12:31 |

Everything below `openrouter` last fired on 09-07 — a person using the product.
`topic-judge` and `trend-extract` fired every day since, on their own.

Hourly, the automated spend lands in exactly three slots per day:

    09-09 06:00  topic-judge 10 · trend-extract 14
    09-09 14:00  topic-judge 12 · trend-extract 14
    09-09 21:00  topic-judge 22 · trend-extract 28   → $0.722/day

Three slots, three workflows. The clock drift from their cron lines is the
known GitHub Actions schedule delay, measured separately at a median of about
two and a half hours.

## Why it produced nothing

    trend-collector → trend_signals → iks-scorer → keyword_scores
      → video-discover → youtube_videos → [transcript, summary] → video_summaries

The head of that chain ran daily. The tail has been stopped since 2026-07-22:
`video_summaries` and `pipeline_events` both took **zero rows in fourteen days**.
So the spend bought raw material for a pipeline that could not finish it.

## Disabled

All three POST to `/api/v1/internal/skills/trend-collector/run`. Disabling only
the first would have left two runs a day.

| workflow | schedule | why it spent |
|---|---|---|
| `trend-collector.yml` | `30 7`, `30 19` UTC | its whole purpose |
| `batch-video-collector.yml` | `30 7` UTC | posts to the trend-collector endpoint too |
| `batch-video-collector-watchdog.yml` | `30 0` UTC | same |

    gh workflow disable trend-collector.yml
    gh workflow disable batch-video-collector.yml
    gh workflow disable batch-video-collector-watchdog.yml

State confirmed `disabled_manually` for all three. No code changed; `gh workflow
enable <name>` restores them when the transcript pipeline can consume what they
produce.

## Still running, and free

Checked rather than assumed — each of these appears in the worker log or the
chart, and none appears in the ledger:

- **AutoSyncScheduler** — playlist sync at 06:00 and 12:00 KST, three playlists.
  YouTube Data API quota, not money.
- **V2QualityAuditCron** — ran 09-09 04:01, scored 5,000 videos in 86s,
  `enqueuedForRegen: 0`. Database scoring, no model call.
- **V2QualityRegenCron** — this is the one that would spend if the audit
  enqueued anything. `regenEnabled: false` by default and no chart override.
- **RichSummaryV2Cron**, **YouTubeMetadataCron** — no ledger rows in thirty days.
- `keel.yml`, `backup.yml`, `db-integrity-check.yml`, `pool-maintenance.yml`,
  `terraform.yml`, `hardcode-audit-weekly.yml`, `stale-pr-triage.yml` — no LLM.

## Two things worth fixing separately

**`topic-judge` costs six times what `trend-extract` does per call** —
$0.0124 against $0.0021. Any future saving is concentrated there.

**Prompt caching is not in use.** `cached_input_tokens` is empty across the
whole ledger, and the dashboard's cache column renders blank. The judge sends
the same instruction block on every call.

Also: `user_id` is null on every row, so the ledger cannot distinguish a person
from a scheduler by itself. The distinction above comes from call timing and
from which code path owns each module name.

## How to confirm this worked

The ledger is the check. After a full day with the workflows off:

```sql
SELECT to_char(date_trunc('day', created_at) AT TIME ZONE 'Asia/Seoul','MM-DD') AS day,
       module, count(*), round(sum(cost_usd)::numeric, 4) AS usd
  FROM llm_call_logs
 WHERE created_at > now() - interval '3 days'
 GROUP BY 1, 2 ORDER BY 1 DESC, 4 DESC;
```

`topic-judge` and `trend-extract` should not appear for any day after 09-10.
Keel's `llm-spend` check reads the same table, so the dashboard's daily spend
panel shows it without running the query.
