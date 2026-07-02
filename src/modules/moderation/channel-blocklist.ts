/**
 * Channel blocklist (P0 scam-inflow, 2026-07-03).
 *
 * A 3-subscriber impersonation channel's 5-view crypto-scam video reached the
 * add-cards candidate list. Title blocklists cannot catch channel-level abuse,
 * so this bars channels from EVERY discovery surface:
 *   - v5 live search candidates (executor)
 *   - pool recruit / cosine match (SQL-side callers use isChannelBlocked on rows)
 *   - user_curated ingest (Heart → pool)
 *   - placement chokepoint (place-auto-added-cards)
 *
 * Matching: channel_id when present, exact channel_name otherwise — the two
 * seed scam channels shipped with channel_id NULL, so name matching is not
 * optional. In-memory cache (60s TTL) keeps the hot path DB-free; a stale
 * entry only delays a NEW block by up to a minute.
 */

import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'channel-blocklist' });

const CACHE_TTL_MS = 60_000;

interface BlocklistSnapshot {
  ids: Set<string>;
  names: Set<string>;
  loadedAt: number;
}

let cache: BlocklistSnapshot | null = null;

export function resetChannelBlocklistCacheForTest(): void {
  cache = null;
}

async function loadSnapshot(): Promise<BlocklistSnapshot> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache;
  try {
    const rows = await getPrismaClient().channel_blocklist.findMany({
      select: { channel_id: true, channel_name: true },
    });
    cache = {
      ids: new Set(rows.map((r) => r.channel_id).filter((x): x is string => !!x)),
      names: new Set(rows.map((r) => r.channel_name).filter((x): x is string => !!x)),
      loadedAt: now,
    };
  } catch (err) {
    // Fail-open on infra errors: an unreadable blocklist must not take the
    // whole discovery pipeline down. Log loudly; keep last snapshot if any.
    log.error('channel_blocklist load failed (serving continues with last snapshot)', {
      error: err instanceof Error ? err.message : String(err),
    });
    if (!cache) cache = { ids: new Set(), names: new Set(), loadedAt: now };
  }
  return cache;
}

/** True when the channel is barred from discovery surfaces. */
export async function isChannelBlocked(
  channelId: string | null | undefined,
  channelName: string | null | undefined
): Promise<boolean> {
  if (!channelId && !channelName) return false;
  const snap = await loadSnapshot();
  if (channelId && snap.ids.has(channelId)) return true;
  if (channelName && snap.names.has(channelName)) return true;
  return false;
}

/** Bulk variant for candidate arrays — one snapshot load per call. */
export async function filterBlockedChannels<T>(
  items: T[],
  pick: (item: T) => { channelId?: string | null; channelName?: string | null }
): Promise<{ kept: T[]; blockedCount: number }> {
  if (items.length === 0) return { kept: items, blockedCount: 0 };
  const snap = await loadSnapshot();
  const kept = items.filter((it) => {
    const { channelId, channelName } = pick(it);
    if (channelId && snap.ids.has(channelId)) return false;
    if (channelName && snap.names.has(channelName)) return false;
    return true;
  });
  return { kept, blockedCount: items.length - kept.length };
}
