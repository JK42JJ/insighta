# PR X3 — Search-Result Redis Cache

> Date: 2026-04-28
> Issue: #543 (Round 2 PR train, follow-on to PR X2)
> Status: spec — pending PR X1/X2 verification

## §0 Mission

Eliminate the cold-start cost of `searchMandalasByGoal` (≈ 1 LLM API call + 1 pgvector scan) on repeated queries by caching the result tuple in Redis with a 24h TTL. Re-issue of the same query within the window must respond in `< 100 ms` end-to-end.

**Don't touch**:
- `searchMandalasByGoal` SQL shape (PR #544 + PR X2 own this).
- Embedding generation (provider config owns this).
- Existing Redis keyspaces (`topic:*`, `video:*`, `whitelist:*`, `blacklist:*`).

## §1 Cache key + value shape

**Key namespace**: `search:mandala:` (new, no collision with §0 list).

**Key**:
```
search:mandala:<lang>:<sha1(normalized_query):0..15>:<threshold_x100>:<limit>
```

- `lang`: `ko` | `en` | `*` (no language filter).
- `sha1(...)0..15`: first 16 hex chars of SHA-1 of the **normalized** query (NFC + lowercase + collapse-whitespace). Collisions at this width are tolerable (~10⁻¹² for 10⁵ queries) and the eviction is bounded by TTL.
- `threshold_x100`: integer threshold × 100 (e.g. `40` for 0.4).
- `limit`: max results.

**Value**: gzip-compressed JSON of `MandalaSearchResult[]` (the exact return type of `searchMandalasByGoal`).

**TTL**: 86400 s (24 h) hard.

## §2 Invalidation strategy

- **No active invalidation**. Stale-tolerant by design — system-template embeddings are static (1306 rows, last ALTER 2026-04-22); user mandalas added to the index produce sub-24h staleness only for the specific query that would have surfaced them.
- **Future**: if user-mandala growth dominates template count, switch key to include `MAX(mandala_embeddings.created_at)::epoch` so any new row evicts the prefix. Out of scope until growth signal observed.
- **Operational kill switch**: `SEARCH_CACHE_ENABLED` runtime config. Default `true`. Setting `false` disables read+write (cache-bypass), no key cleanup needed (TTL handles it).

## §3 Code change locus

**Single file** (preferred): `src/modules/mandala/search.ts`.

```ts
export async function searchMandalasByGoal(
  goalText: string,
  options: MandalaSearchOptions = {}
): Promise<MandalaSearchResult[]> {
  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const language = options.language ?? '*';

  // ── NEW: cache lookup ──
  if (config.searchCache.enabled) {
    const key = buildSearchCacheKey({ goalText, threshold, limit, language });
    const cached = await tryReadFromCache(key);
    if (cached) {
      cacheMetrics.hit('mandala-search', { lang: language });
      return cached;
    }
    cacheMetrics.miss('mandala-search', { lang: language });
  }

  // ── existing path: embed → SQL → post-filter ──
  const result = await runUncachedSearch(goalText, { limit, threshold, language });

  // ── NEW: cache write (best-effort, no error propagation) ──
  if (config.searchCache.enabled) {
    void writeToCacheSafe(key, result, SEARCH_CACHE_TTL_S);
  }

  return result;
}
```

**Helper module**: `src/modules/redis/search-cache.ts` (NEW, ~80 lines).

```ts
export function buildSearchCacheKey(args): string;
export async function tryReadFromCache(key): Promise<MandalaSearchResult[] | null>;
export async function writeToCacheSafe(key, value, ttlS): Promise<void>;
```

- Reads use the existing `getInsightaRedisClient` (RO path).
- Writes use the existing `getInsightaUpsertRedisClient` (HSET capable on `video:*`; we add `search:mandala:*` to the same ACL pattern set, see §6).

## §4 Hit-rate observability

- `cacheMetrics.hit/miss` counters → `cache_metrics` table or Prometheus (whichever the codebase already exposes; `grep -rn "cacheMetrics" src/` to confirm).
- Optional: log every miss with `goalText:0..20 + duration_ms` for first 1k samples post-deploy, then drop log volume.
- Pass criteria post-deploy: hit rate ≥ 30% within first 24 h of warm traffic. Below 20% → re-evaluate key shape.

## §5 Latency target

- Cold (cache miss): unchanged from current `searchMandalasByGoal` (≈ 0.3-1 s on prod).
- Warm (cache hit): `< 100 ms` p99. Redis pipeline pull + JSON parse only.

Validation:
- Synthetic — `tests/perf/search-cache.bench.ts` (NEW), 100 queries × {cold, warm} pair, assert warm p99 < 100 ms locally.
- Prod — `cache_metrics` p99 panel (Grafana, if available; else CSV from log harvest).

## §6 Hard Rule compliance

- **DB work order**: no schema change.
- **`.env` immutable**: new env `SEARCH_CACHE_ENABLED` lives in `docker-compose.prod.yml` `environment:` block (per CP392 `Non-secret config 는 Secret 에 두지 않는다`). Default-in-code = `true`.
- **Redis ACL**: `insighta-upsert` ACL pattern needs `~search:mandala:*` added (same migration pattern as CP410 `~whitelist:* ~blacklist:*`). Single-line entrypoint script update.
- **No LLM API call from script**: §5 perf bench uses only stored Redis values + cosine SQL — no embedding regen.

## §7 Test plan

- Unit: `tests/unit/modules/redis/search-cache.test.ts` (NEW)
  - `buildSearchCacheKey` deterministic, normalised
  - `tryReadFromCache` returns null on parse error
  - `writeToCacheSafe` swallows Redis errors
- Integration: extend `tests/unit/modules/search-threshold.test.ts`
  - cache hit returns without `$queryRaw`
  - cache miss falls through to SQL
- Smoke (post-deploy):
  - First "수학" query → cold (latency > 200 ms)
  - Second within 5 min → warm (latency < 100 ms)

## §8 Sequence

1. PR X1 deploy verified (already in flight).
2. PR X2 §4 manual smoke — gate to start X3.
3. PR X3 implementation — one PR, scope §3 + §4 + §7 above.
4. Post-deploy: 24 h hit-rate observation, threshold tune if needed.
