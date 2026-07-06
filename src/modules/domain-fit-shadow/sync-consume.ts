/**
 * Domain-fit SYNC-path cache-consume (supervisor spec — sync add-cards/v5
 * serving path deboost WITHOUT any synchronous Ollama call).
 *
 * Unlike `./serve-enforce.ts` (AWAITS a classifier call on cache miss, safe
 * only inside the already-async pg-boss pool-serve-fill job), this module
 * runs in the synchronous HTTP request path (`src/api/routes/add-cards.ts`)
 * where a 1-2s-per-candidate Ollama round trip is forbidden (hot path,
 * p95<200ms budget). Contract:
 *   - cache HIT → apply the cached multiplier (same demote-only stable sort
 *     as serve-enforce, via the shared `reorderByMultiplier` helper).
 *   - cache MISS → multiplier 1 (untouched, no reorder effect) AND a
 *     fire-and-forget cache-warm classify+persist is scheduled
 *     (`setImmediate`, never awaited by the request) so the NEXT request for
 *     the same (video, mandala) pair is a cache hit. Errors are swallowed +
 *     logged; a classifier failure is never cached (same fail-open contract
 *     as `scoreAndCacheDomainFit`).
 *
 * `cfg.syncConsumeEnabled` gates everything: off (default) is a synchronous
 * zero-cost no-op — same array reference returned, zero cache reads, zero
 * warm scheduling.
 */

import { logger } from '@/utils/logger';
import type { DomainFitShadowConfig } from '@/config/domain-fit-shadow';
import {
  reorderByMultiplier,
  scoreAndCacheDomainFit,
  type DomainFitServeCandidate,
  type DomainFitServeCacheEntry,
} from './serve-enforce';

const log = logger.child({ module: 'domain-fit-shadow/sync-consume' });

/** Batch-read + single-write cache surface for the sync-consume path — a
 *  SEPARATE shape from `DomainFitServeCache` (get is single-video) because
 *  the sync path needs exactly ONE SQL round trip for the whole candidate
 *  set (hot-path latency budget), not N sequential single-video reads. */
export interface DomainFitSyncConsumeCache {
  getMany(youtubeVideoIds: string[]): Promise<Map<string, DomainFitServeCacheEntry>>;
  set(youtubeVideoId: string, entry: DomainFitServeCacheEntry): Promise<void>;
}

/** Every call is a miss; `set` is a no-op — mirrors `createNoopDomainFitServeCache`. */
export function createNoopDomainFitSyncConsumeCache(): DomainFitSyncConsumeCache {
  return {
    getMany: async () => new Map(),
    set: async () => {},
  };
}

export interface DomainFitSyncConsumeResult<T> {
  /** Same length as input, ALWAYS — DEMOTE only, never drop (card-floor invariant). */
  reordered: T[];
  /** Count of candidates whose multiplier < 1 (i.e. actually demoted). */
  demoted: number;
  cacheHits: number;
  /** Uncached candidates enqueued for async cache-warm classification (NOT scored synchronously). */
  enqueued: number;
}

/**
 * Bursted (bounded by `cfg.concurrency`) fire-and-forget cache warm — awaits
 * internally so Ollama is never hammered with an unbounded fan-out, but the
 * CALLER never awaits this function itself (see `applyDomainFitSyncConsume`'s
 * `setImmediate` scheduling). Every candidate error is swallowed + logged;
 * a classifier failure is never cached (fail-open, self-heals next request).
 */
async function warmDomainFitSyncCache<T extends DomainFitServeCandidate>(
  candidates: T[],
  centerGoal: string,
  cfg: DomainFitShadowConfig,
  cache: Pick<DomainFitSyncConsumeCache, 'set'>
): Promise<void> {
  for (let i = 0; i < candidates.length; i += cfg.concurrency) {
    const burst = candidates.slice(i, i + cfg.concurrency);
    await Promise.all(
      burst.map((c) =>
        scoreAndCacheDomainFit(c, centerGoal, cfg, cache).catch((err: unknown) => {
          log.debug(
            `domain-fit sync-consume warm candidate failed (swallowed): ${err instanceof Error ? err.message : String(err)}`
          );
        })
      )
    );
  }
}

/**
 * Schedules the cache warm OFF the request's synchronous path via
 * `setImmediate` — the request returns before this even starts running.
 * Exported separately so tests can assert it was invoked without needing a
 * real event-loop tick.
 */
export function scheduleDomainFitSyncWarm<T extends DomainFitServeCandidate>(
  uncached: T[],
  centerGoal: string,
  cfg: DomainFitShadowConfig,
  cache: Pick<DomainFitSyncConsumeCache, 'set'>
): void {
  if (uncached.length === 0) return;
  setImmediate(() => {
    void warmDomainFitSyncCache(uncached, centerGoal, cfg, cache).catch((err: unknown) => {
      log.warn(
        `domain-fit sync-consume warm batch failed (swallowed): ${err instanceof Error ? err.message : String(err)}`
      );
    });
  });
}

/**
 * Sync-path pure reorder — CACHE READ ONLY, zero synchronous classifier
 * calls. See module docstring for the full contract.
 */
export async function applyDomainFitSyncConsume<T extends DomainFitServeCandidate>(
  candidates: T[],
  centerGoal: string,
  cfg: DomainFitShadowConfig,
  cache: DomainFitSyncConsumeCache
): Promise<DomainFitSyncConsumeResult<T>> {
  if (!cfg.syncConsumeEnabled || candidates.length === 0) {
    return { reordered: candidates, demoted: 0, cacheHits: 0, enqueued: 0 };
  }

  // Bounded cap — anything beyond stays untouched, appended at the tail
  // (never dropped; just not reordered) — same posture as serve-enforce.
  const capped = candidates.slice(0, cfg.maxCandidates);
  const overflow = candidates.slice(cfg.maxCandidates);

  const cached = await cache.getMany(capped.map((c) => c.youtubeVideoId)).catch((err: unknown) => {
    log.debug(
      `domain-fit sync-consume cache read failed (treated as all-miss): ${err instanceof Error ? err.message : String(err)}`
    );
    return new Map<string, DomainFitServeCacheEntry>();
  });

  const uncached: T[] = [];
  const withMultiplier = capped.map((c) => {
    const entry = cached.get(c.youtubeVideoId);
    if (entry) return { c, multiplier: entry.multiplier };
    uncached.push(c);
    return { c, multiplier: 1 };
  });

  scheduleDomainFitSyncWarm(uncached, centerGoal, cfg, cache);

  const demoted = withMultiplier.filter((r) => r.multiplier < 1).length;
  const reordered: T[] = [...reorderByMultiplier(withMultiplier), ...overflow];

  return { reordered, demoted, cacheHits: cached.size, enqueued: uncached.length };
}
