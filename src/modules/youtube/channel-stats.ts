/**
 * Channel statistics fetcher (D-06 2026-07-03 — trust-axis subscriber shadow).
 *
 * James's insight, validated by the floor incident: subscriber count separates
 * "niche but legit" (MS/AWS official lectures: hundreds of views, hundreds of
 * thousands of subscribers) from "3-subscriber scam farms" — exactly where the
 * view-count floor failed. This module only MEASURES (channels.list, 1u/50
 * channels); gating decisions stay with the shadow-distribution pipeline.
 *
 * In-memory TTL cache (1h): channel stats drift slowly, and the shadow path
 * re-sees the same channels every round — steady-state quota cost ≈ 0.
 */

import { logger } from '@/utils/logger';
import { MS_PER_HOUR } from '@/utils/time-constants';

const log = logger.child({ module: 'channel-stats' });

const CACHE_TTL_MS = MS_PER_HOUR;
const BATCH_SIZE = 50;

export interface ChannelStats {
  subscriberCount: number | null;
  videoCount: number | null;
  publishedAt: string | null;
}

const cache = new Map<string, { stats: ChannelStats; at: number }>();

export function resetChannelStatsCacheForTest(): void {
  cache.clear();
}

/**
 * Batch-fetch statistics for the given channelIds. Unknown/failed channels
 * are simply absent from the result map (callers treat missing as null —
 * measurement gaps must never gate anything).
 */
export async function fetchChannelStats(
  channelIds: string[],
  apiKeys: string[]
): Promise<Map<string, ChannelStats>> {
  const out = new Map<string, ChannelStats>();
  const now = Date.now();
  const misses: string[] = [];
  for (const id of new Set(channelIds)) {
    const hit = cache.get(id);
    if (hit && now - hit.at < CACHE_TTL_MS) {
      out.set(id, hit.stats);
    } else {
      misses.push(id);
    }
  }
  if (misses.length === 0 || apiKeys.length === 0) return out;

  for (let i = 0; i < misses.length; i += BATCH_SIZE) {
    const batch = misses.slice(i, i + BATCH_SIZE);
    const url =
      `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet` +
      `&id=${batch.join(',')}&key=${apiKeys[0]}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        log.warn(`channels.list ${res.status} (batch skipped, stats absent)`);
        continue;
      }
      const json = (await res.json()) as {
        items?: Array<{
          id: string;
          snippet?: { publishedAt?: string };
          statistics?: {
            subscriberCount?: string;
            videoCount?: string;
            hiddenSubscriberCount?: boolean;
          };
        }>;
      };
      for (const item of json.items ?? []) {
        const stats: ChannelStats = {
          subscriberCount: item.statistics?.hiddenSubscriberCount
            ? null
            : item.statistics?.subscriberCount != null
              ? Number(item.statistics.subscriberCount)
              : null,
          videoCount:
            item.statistics?.videoCount != null ? Number(item.statistics.videoCount) : null,
          publishedAt: item.snippet?.publishedAt ?? null,
        };
        cache.set(item.id, { stats, at: now });
        out.set(item.id, stats);
      }
    } catch (err) {
      log.warn(
        `channels.list failed (batch skipped): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return out;
}
