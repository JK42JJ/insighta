# Channel Whitelist Seed

Seed data for `whitelist:channels` Redis SET (consumed by
`src/modules/video-dictionary/whitelist.ts:26`). Acts as the allow-list for the
Phase B dual-whitelist gate.

## Files

- `channels-seed.jsonl` — JSONL, one row per channel. Schema below.
- `README.md` (this file) — sync workflow + curation rules.

## Row schema

```jsonl
{"channel_id":"UC...","channel_name":"...","domain":"tech","language":"ko","reason":"...","verify_confidence":"high|mid|low|placeholder"}
```

| field | required | notes |
| --- | --- | --- |
| `channel_id` | yes | `UC` prefix + 22 alphanumeric chars. `UC__REVIEW_*__` = placeholder, **must** be replaced before sync. |
| `channel_name` | yes | Display name (latest public name). |
| `domain` | yes | One of: `tech`, `learning`, `finance`, `business`, `mind`, `health`, `lifestyle`, `social`, `creative` (CP438 v2-author 9 domains). |
| `language` | yes | `ko` or `en`. Primary content language. |
| `reason` | yes | 1-line learning-value rationale. |
| `verify_confidence` | yes | `high` = canonical ID published by the channel / referenced in YouTube dev docs. `mid` = widely-known public channel, ID format-checked but not URL-tested. `low` = best-effort. `placeholder` = needs human review before sync. |

## Curation rules (CP457 carryover T3-1, sparse-domain boost)

- **Channel ID accuracy is non-negotiable.** A wrong ID = dead row + dictionary
  noise. When in doubt, ship a placeholder, not a guess (CLAUDE.md "추측 전 소스
  읽기" hard rule).
- **Learning value first** — education / how-to / explainer / lecture / podcast.
  Pure entertainment / vlog / reaction channels are out of scope.
- **Domain balance target**: 6-8 channels per domain (9 × 7 ~= 63). Sparse
  domains (`social`, `creative`) get priority because the v2-author corpus
  (CP438+1) was thin there.
- **Language mix target**: ko 60-70%, en 30-40%.
- **Subscriber floor**: prefer 100K+ for stability. Smaller niche channels OK
  only with `verify_confidence: high`.

## Sync workflow

1. Edit `channels-seed.jsonl` locally. Run JSONL lint:
   ```bash
   while IFS= read -r line; do echo "$line" | jq -e . > /dev/null || echo "BAD: $line"; done < data/whitelists/channels-seed.jsonl
   ```
2. Replace any `verify_confidence: "placeholder"` rows with verified IDs or
   remove them before sync.
3. Mac Mini collector picks up the file via `collector whitelist-sync --apply`
   (separate ops repo). The collector:
   - Reads this JSONL.
   - Validates each `channel_id` against YouTube Data API.
   - SADD's verified IDs to Redis key `whitelist:channels` on the Insighta
     Redis (ACL user `insighta`, read-only for the app).
4. App-side cache TTL is 5 min (`WHITELIST_CACHE_TTL_MS`) — propagation is
   automatic after sync.
5. Empty whitelist → app falls open (`emptyWhitelistInclusiveFallback: true`,
   see `whitelist.ts:135`). No blackhole risk during seeding.

## Verification helper (optional)

A given `channel_id` resolves at `https://www.youtube.com/channel/<channel_id>`.
Reviewers should spot-check a sample (especially `verify_confidence: mid`)
before the first `--apply`. The Mac Mini collector also rejects 404 IDs at sync
time and logs them to its run report — those rows should be deleted from this
file, not silently retried.

## Provenance

- Initial seed: 2026-05-14, Launch D-1, CP457 carryover T3-1.
- All `verify_confidence: high` rows are channels whose IDs are widely
  published in YouTube developer documentation or the channels' own About
  pages.
- All `verify_confidence: mid` / `low` rows need a human review pass before
  the first `--apply`.
