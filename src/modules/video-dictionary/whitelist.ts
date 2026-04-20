/**
 * video-dictionary — channel whitelist consumer
 *
 * Reads `whitelist:channels` from the Insighta Redis (ACL user `insighta`,
 * read-only) and filters assembled recommendation slots. Design doc:
 * `/cursor/video-dictionary/docs/design/dual-whitelist.md` §3.2, §4.2.
 *
 * Contract:
 *  - `getChannelWhitelist()` returns a `Set<string>` — empty on Redis
 *    unavailability (fail-open Q2) or when the key has no members.
 *  - In-memory TTL cache (5 min) — collision-free across callers in the
 *    same Node process; admin promotions become visible within one TTL.
 *  - `filterByWhitelist(slots, whitelist, opts)` is a pure function. It
 *    short-circuits to passthrough when the gate is disabled OR when the
 *    whitelist is empty with `emptyWhitelistInclusiveFallback=true`
 *    (Q1) — this prevents accidental prod blackhole if the flag is
 *    flipped before the whitelist is seeded.
 */

import { getInsightaRedisClient } from '@/modules/redis';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'video-dictionary/whitelist' });

/** Canonical Redis SET key — mirrors video-dict `WHITELIST_CHANNELS_KEY`. */
export const WHITELIST_CHANNELS_KEY = 'whitelist:channels';

/** Cache TTL — admin promotions propagate within this window. */
export const WHITELIST_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  members: Set<string>;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;

/**
 * Return the current channel whitelist as a `Set`. Uses an in-memory TTL
 * cache; returns an empty set when Redis is unavailable.
 */
export async function getChannelWhitelist(now: number = Date.now()): Promise<Set<string>> {
  if (cache && now - cache.fetchedAt < WHITELIST_CACHE_TTL_MS) {
    return cache.members;
  }

  const client = await getInsightaRedisClient();
  if (!client) {
    log.warn('whitelist.redis_unavailable — returning empty set (fail-open)');
    const empty = new Set<string>();
    cache = { members: empty, fetchedAt: now };
    return empty;
  }

  try {
    const raw = await client.sMembers(WHITELIST_CHANNELS_KEY);
    const members = new Set<string>(raw);
    cache = { members, fetchedAt: now };
    return members;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`whitelist.smembers_failed — returning empty set (fail-open): ${msg}`);
    const empty = new Set<string>();
    cache = { members: empty, fetchedAt: now };
    return empty;
  }
}

/** Reset the in-memory cache — test-only. */
export function resetWhitelistCacheForTesting(): void {
  cache = null;
}

/** Minimal slot shape consumed by `filterByWhitelist`. */
export interface WhitelistGateSlot {
  videoId: string;
  channelId: string;
  [key: string]: unknown;
}

export interface WhitelistGateOptions {
  /** Hard kill switch — `false` short-circuits to passthrough. */
  enabled: boolean;
  /**
   * When `true` (default) AND the whitelist is empty, treat as passthrough
   * with a warn log. Prevents accidental blackhole when the flag is
   * enabled before the whitelist is seeded (dual-whitelist.md §3.2 Q1).
   */
  emptyWhitelistInclusiveFallback?: boolean;
}

export interface WhitelistGateTrace {
  inputCount: number;
  keptCount: number;
  droppedCount: number;
  /** `null` when the gate passed through without consulting the whitelist. */
  reason: 'applied' | 'disabled' | 'empty_whitelist_inclusive_fallback' | 'empty_slots';
}

export interface WhitelistGateResult<S extends WhitelistGateSlot> {
  slots: S[];
  trace: WhitelistGateTrace;
}

/**
 * Pure filter — drops slots whose `channelId` is not in the whitelist.
 *
 * Does NOT read Redis; callers pass the fetched whitelist. Keeps this
 * function trivially testable and side-effect free.
 */
export function filterByWhitelist<S extends WhitelistGateSlot>(
  slots: readonly S[],
  whitelist: ReadonlySet<string>,
  opts: WhitelistGateOptions
): WhitelistGateResult<S> {
  if (!opts.enabled) {
    return {
      slots: [...slots],
      trace: {
        inputCount: slots.length,
        keptCount: slots.length,
        droppedCount: 0,
        reason: 'disabled',
      },
    };
  }

  if (slots.length === 0) {
    return {
      slots: [],
      trace: { inputCount: 0, keptCount: 0, droppedCount: 0, reason: 'empty_slots' },
    };
  }

  if (whitelist.size === 0) {
    const fallback = opts.emptyWhitelistInclusiveFallback ?? true;
    if (fallback) {
      log.warn(
        'whitelist.empty_inclusive_fallback input_count=%d — flag enabled but whitelist has zero members; treating as passthrough. Seed data/whitelists/channels-seed.jsonl and run `collector whitelist-sync --apply` before Phase B transition.',
        slots.length
      );
      return {
        slots: [...slots],
        trace: {
          inputCount: slots.length,
          keptCount: slots.length,
          droppedCount: 0,
          reason: 'empty_whitelist_inclusive_fallback',
        },
      };
    }
  }

  const kept: S[] = [];
  for (const slot of slots) {
    if (whitelist.has(slot.channelId)) kept.push(slot);
  }
  return {
    slots: kept,
    trace: {
      inputCount: slots.length,
      keptCount: kept.length,
      droppedCount: slots.length - kept.length,
      reason: 'applied',
    },
  };
}
