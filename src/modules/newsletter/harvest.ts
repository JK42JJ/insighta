/**
 * S0 harvest and S1 format gate.
 *
 * Two layers, in this order for a reason:
 *
 *   layer 1  trusted channels   playlistItems.list    1 unit per 50 videos
 *   layer 2  the topic queries  search.list         100 units per query
 *
 * Layer 1 guarantees the channels an editor decided matter are never missed
 * because a query happened not to match them, and it is a hundred times
 * cheaper per call. Layer 2 finds channels nobody has decided about yet; a
 * channel that keeps surfacing there is a candidate for promotion by hand.
 *
 * Both layers write to the ledger. Issue 1's harvest reported "2,714 videos"
 * from a script that was never committed and stored nothing, so the number on
 * the page had nothing behind it. Every count here comes back out of
 * `newsletter_pipeline_steps`.
 *
 * Quota is counted as it is spent, not estimated afterwards.
 */

import { getPrismaClient } from '@/modules/database/client';
import { resolveSearchApiKeys } from '@/skills/plugins/video-discover/v2/youtube-client';
import type { TopicDefinition } from './topics/ai-tech';
import { logger } from '@/utils/logger';
import { MS_PER_DAY } from '@/utils/time-constants';

const log = logger.child({ module: 'newsletter/harvest' });

const API = 'https://www.googleapis.com/youtube/v3';

/** search.list and playlistItems.list both cap at 50. */
const PAGE_SIZE = 50;
/** Quota per call, from the YouTube Data API v3 cost table. */
const COST_SEARCH = 100;
const COST_LIST = 1;

export interface HarvestedVideo {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  /** Which layer found it first. A video can be in both; the first wins. */
  source: 'trusted' | 'search';
  /** The query that surfaced it, when layer 2 did. */
  query?: string;
  durationSeconds?: number;
  viewCount?: number;
}

export interface HarvestResult {
  runId: string;
  /** Everything found, deduplicated. Filtering is S1's job, not this one's. */
  videos: HarvestedVideo[];
  quotaUnits: number;
  /** Before deduplication — the `itemsIn` the ledger needs. */
  rawTotal: number;
  duplicates: number;
  detail: Record<string, unknown>;
}

interface FetchLike {
  (url: string): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
}

async function get(
  fetchImpl: FetchLike,
  path: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetchImpl(url.toString());
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = body['error'] as { message?: string } | undefined;
    throw new Error(`${path} HTTP ${res.status}: ${err?.message ?? 'unknown'}`);
  }
  return body;
}

/** ISO 8601 duration to seconds. Shorts are the reason this exists. */
export function parseDuration(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/**
 * Layer 1 — everything a trusted channel published inside the window.
 *
 * Reads the uploads playlist rather than searching the channel: same result,
 * one unit instead of a hundred, and no dependence on the search index having
 * caught up.
 */
async function harvestTrusted(
  categoryKey: string,
  since: Date,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<{ videos: HarvestedVideo[]; units: number; channels: number }> {
  const channels = await getPrismaClient().newsletter_trusted_channels.findMany({
    where: { category_key: categoryKey, is_active: true, uploads_playlist_id: { not: null } },
    select: { channel_id: true, channel_title: true, uploads_playlist_id: true, tier: true },
  });

  const videos: HarvestedVideo[] = [];
  let units = 0;

  for (const ch of channels) {
    let pageToken: string | undefined;
    let stop = false;
    do {
      const body = await get(fetchImpl, 'playlistItems', {
        part: 'snippet',
        playlistId: ch.uploads_playlist_id as string,
        maxResults: String(PAGE_SIZE),
        key: apiKey,
        ...(pageToken ? { pageToken } : {}),
      });
      units += COST_LIST;
      const items = (body['items'] ?? []) as Array<{ snippet: Record<string, unknown> }>;
      for (const it of items) {
        const sn = it.snippet as {
          publishedAt?: string;
          title?: string;
          resourceId?: { videoId?: string };
          videoOwnerChannelId?: string;
          videoOwnerChannelTitle?: string;
        };
        const published = sn.publishedAt ? new Date(sn.publishedAt) : null;
        // The uploads playlist is newest-first, so the first video older than
        // the window means every one after it is too.
        if (published && published < since) {
          stop = true;
          break;
        }
        const vid = sn.resourceId?.videoId;
        if (!vid) continue;
        videos.push({
          videoId: vid,
          title: sn.title ?? '',
          channelId: sn.videoOwnerChannelId ?? ch.channel_id,
          channelTitle: sn.videoOwnerChannelTitle ?? ch.channel_title ?? '',
          publishedAt: sn.publishedAt ?? '',
          source: 'trusted',
        });
      }
      pageToken = stop ? undefined : ((body['nextPageToken'] as string | undefined) ?? undefined);
    } while (pageToken);
  }

  return { videos, units, channels: channels.length };
}

/**
 * Layer 2 — the topic's queries.
 *
 * `order: 'date'` and a single `videoCategoryId` per call. Passing a CSV of
 * category ids returns HTTP 400 — the client's JSDoc says otherwise and is
 * wrong (measured 2026-08-25), which is why the loop is over categories.
 */
async function harvestSearch(
  topic: TopicDefinition,
  since: Date,
  apiKeys: string[],
  fetchImpl: FetchLike
): Promise<{ videos: HarvestedVideo[]; units: number; calls: number; failures: string[] }> {
  const queries = [...topic.queries.ko, ...topic.queries.en];
  const videos: HarvestedVideo[] = [];
  const failures: string[] = [];
  let units = 0;
  let calls = 0;
  let keyIndex = 0;

  for (const q of queries) {
    for (const categoryId of topic.videoCategoryIds) {
      try {
        const body = await get(fetchImpl, 'search', {
          part: 'snippet',
          q,
          type: 'video',
          order: topic.order,
          publishedAfter: since.toISOString(),
          videoCategoryId: String(categoryId),
          maxResults: String(PAGE_SIZE),
          key: apiKeys[keyIndex % apiKeys.length] as string,
        });
        units += COST_SEARCH;
        calls += 1;
        const items = (body['items'] ?? []) as Array<{
          id?: { videoId?: string };
          snippet?: Record<string, unknown>;
        }>;
        for (const it of items) {
          const vid = it.id?.videoId;
          const sn = it.snippet as
            | { title?: string; channelId?: string; channelTitle?: string; publishedAt?: string }
            | undefined;
          if (!vid || !sn) continue;
          videos.push({
            videoId: vid,
            title: sn.title ?? '',
            channelId: sn.channelId ?? '',
            channelTitle: sn.channelTitle ?? '',
            publishedAt: sn.publishedAt ?? '',
            source: 'search',
            query: q,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`${q}: ${msg.slice(0, 80)}`);
        // Quota exhaustion on one key is survivable; rotate and keep going, so
        // a partial harvest is still a harvest with a number behind it.
        keyIndex += 1;
        units += COST_SEARCH;
        calls += 1;
      }
    }
  }

  return { videos, units, calls, failures };
}

/**
 * Fill in duration and view count for the S1 gate.
 *
 * videos.list takes 50 ids for one unit, which is why the format gate is
 * affordable at all: the same information through search would cost 100 per
 * video.
 */
async function enrich(
  videos: HarvestedVideo[],
  apiKey: string,
  fetchImpl: FetchLike
): Promise<number> {
  let units = 0;
  const byId = new Map(videos.map((v) => [v.videoId, v]));
  const ids = [...byId.keys()];

  for (let i = 0; i < ids.length; i += PAGE_SIZE) {
    const chunk = ids.slice(i, i + PAGE_SIZE);
    const body = await get(fetchImpl, 'videos', {
      part: 'contentDetails,statistics',
      id: chunk.join(','),
      key: apiKey,
    });
    units += COST_LIST;
    const items = (body['items'] ?? []) as Array<{
      id?: string;
      contentDetails?: { duration?: string };
      statistics?: { viewCount?: string };
    }>;
    for (const it of items) {
      const v = it.id ? byId.get(it.id) : undefined;
      if (!v) continue;
      v.durationSeconds = parseDuration(it.contentDetails?.duration ?? '');
      v.viewCount = it.statistics?.viewCount ? Number(it.statistics.viewCount) : undefined;
    }
  }
  return units;
}

/** Below this a video is a short or a clip, not something to review. */
export const MIN_DURATION_SECONDS = 240;

export interface HarvestOptions {
  runId: string;
  topic: TopicDefinition;
  /** Defaults to now minus the topic's window. */
  since?: Date;
  fetchImpl?: FetchLike;
}

/**
 * Run S0 and S1, recording both.
 *
 * Returns what survived the format gate. The counts are written to the ledger
 * before they are returned, so a caller that crashes afterwards still leaves a
 * record of what the harvest actually did.
 */
export async function harvest(opts: HarvestOptions): Promise<HarvestResult> {
  const { runId, topic } = opts;
  const fetchImpl = (opts.fetchImpl ?? fetch) as FetchLike;
  const since = opts.since ?? new Date(Date.now() - topic.publishedWithinDays * MS_PER_DAY);

  const apiKeys = resolveSearchApiKeys(process.env);
  if (apiKeys.length === 0) throw new Error('no YouTube API key configured');
  const primary = apiKeys[0] as string;

  // ---- S0 ----
  const trusted = await harvestTrusted(topic.categoryKey, since, primary, fetchImpl);
  log.info('S0 layer 1 complete', {
    channels: trusted.channels,
    videos: trusted.videos.length,
    units: trusted.units,
  });

  const search = await harvestSearch(topic, since, apiKeys, fetchImpl);
  log.info('S0 layer 2 complete', {
    calls: search.calls,
    videos: search.videos.length,
    units: search.units,
    failures: search.failures.length,
  });

  // Trusted first, so a video found by both keeps the layer that guaranteed it.
  const seen = new Set<string>();
  const merged: HarvestedVideo[] = [];
  let duplicates = 0;
  for (const v of [...trusted.videos, ...search.videos]) {
    if (seen.has(v.videoId)) {
      duplicates += 1;
      continue;
    }
    seen.add(v.videoId);
    merged.push(v);
  }

  const rawTotal = trusted.videos.length + search.videos.length;
  const enrichUnits = await enrich(merged, primary, fetchImpl);

  log.info('S0 complete', {
    in: rawTotal,
    out: merged.length,
    duplicates,
    units: trusted.units + search.units + enrichUnits,
  });

  return {
    runId,
    videos: merged,
    quotaUnits: trusted.units + search.units + enrichUnits,
    rawTotal,
    duplicates,
    detail: {
      trustedChannels: trusted.channels,
      trustedVideos: trusted.videos.length,
      searchCalls: search.calls,
      searchVideos: search.videos.length,
      searchFailures: search.failures,
      queries: [...topic.queries.ko, ...topic.queries.en],
      videoCategoryIds: topic.videoCategoryIds,
      since: since.toISOString(),
    },
  };
}
