/**
 * Channel-mode collection leg (P3).
 * Design: docs/design/curation-channel-subscription-2026-07-27.md §4.
 *
 * Reads what the followed channels uploaded this week. Two differences from the
 * discover path, both deliberate:
 *
 *   - Server API key, not the user's OAuth token. The uploads playlist is public
 *     and this runs unattended on a weekly cron; a build that dies because an
 *     access token expired overnight is a build that silently stops arriving.
 *   - No relevance scoring. The user picked the channel — that IS the relevance.
 *     CURATION_RELEVANCE_FLOOR is not applied here (§4 "품질"), and the stored
 *     relevance_pct is a constant so the feed's existing sort stays total.
 *
 * Cost: 1 unit per channel (playlistItems.list, 50 newest uploads) + 1 unit per
 * 50 videos (videos.list for duration). Ten channels ≈ 12-20 units a week.
 */

import { logger } from '@/utils/logger';
import { getPrismaClient } from '@/modules/database/client';
import {
  QUALITY_GOLD_VIEW_COUNT,
  QUALITY_SILVER_VIEW_COUNT,
} from '@/skills/plugins/batch-video-collector/manifest';
import {
  videosBatchFullMetadata,
  parseIsoDuration,
  isShortsByDuration,
} from '@/skills/plugins/video-discover/v2/youtube-client';

const log = logger.child({ module: 'channel-uploads' });

const API = 'https://www.googleapis.com/youtube/v3';

/** playlistItems.list page size — the newest 50 uploads cover a week for any
 *  realistic channel, so the leg never pages (1 unit per channel, flat). */
export const UPLOADS_PAGE_SIZE = 50;

/**
 * Displayed relevance for channel-mode items. The user chose the channel, so
 * every upload is equally on-topic; a varying percentage here would be theatre.
 */
export const CHANNEL_MODE_RELEVANCE_PCT = 100;

/** Provenance for pool rows that arrived because a user followed the channel. */
const POOL_SOURCE = 'user_channel';

/**
 * Tier by view count, matching the collector's thresholds.
 *
 * Deliberately NOT classifyQuality(): that decides ADMISSIBILITY too, and would
 * reject a video for being under the view floor. A channel the user chose to
 * follow does not get its uploads turned away for being unpopular -- that is
 * the whole point of following it. Tier stays for diagnostics only.
 */
function tierByViews(views: number): string {
  if (views >= QUALITY_GOLD_VIEW_COUNT) return 'gold';
  if (views >= QUALITY_SILVER_VIEW_COUNT) return 'silver';
  return 'bronze';
}

export interface ChannelUpload {
  videoId: string;
  channelId: string;
  publishedAt: Date;
  title: string;
}

interface PlaylistItemsResponse {
  items?: Array<{
    snippet?: { title?: string; resourceId?: { videoId?: string } };
    contentDetails?: { videoId?: string; videoPublishedAt?: string };
  }>;
}

/**
 * Newest uploads for one channel, filtered to those published at or after
 * `since`. Returns [] (never throws) on an API failure: one unreachable channel
 * must not empty the whole week.
 */
export async function fetchChannelUploads(
  channelId: string,
  uploadsPlaylistId: string,
  since: Date,
  apiKeys: string[],
  fetchImpl: typeof fetch = fetch
): Promise<ChannelUpload[]> {
  const key = apiKeys[0];
  if (!key) return [];
  const url =
    `${API}/playlistItems?part=snippet,contentDetails` +
    `&playlistId=${encodeURIComponent(uploadsPlaylistId)}` +
    `&maxResults=${UPLOADS_PAGE_SIZE}&key=${key}`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) {
      log.warn('playlistItems.list failed', { status: res.status, channelId });
      return [];
    }
    const json = (await res.json()) as PlaylistItemsResponse;
    const out: ChannelUpload[] = [];
    for (const item of json.items ?? []) {
      const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
      const publishedRaw = item.contentDetails?.videoPublishedAt;
      if (!videoId || !publishedRaw) continue;
      const publishedAt = new Date(publishedRaw);
      if (Number.isNaN(publishedAt.getTime()) || publishedAt < since) continue;
      out.push({ videoId, channelId, publishedAt, title: item.snippet?.title ?? '' });
    }
    return out;
  } catch (err) {
    log.warn('playlistItems.list threw', { channelId, error: (err as Error).message });
    return [];
  }
}

/**
 * Persist what videos.list just told us. Keyed by video_id and deliberately
 * conservative on update: `source` is never overwritten, so a row that arrived
 * through a more authoritative path keeps its provenance and only gets its
 * freshness and (possibly scrubbed) display fields restored.
 *
 * Failures are logged, never thrown: a pool write must not cost the user their
 * week.
 */
async function storeUploadsInPool(
  meta: Array<{
    id?: string;
    snippet?: {
      title?: string;
      description?: string;
      channelTitle?: string;
      channelId?: string;
      publishedAt?: string;
      thumbnails?: Record<string, { url?: string } | undefined>;
    };
    contentDetails?: { duration?: string };
    statistics?: { viewCount?: string; likeCount?: string };
  }>
): Promise<void> {
  if (meta.length === 0) return;
  const prisma = getPrismaClient();
  let stored = 0;
  for (const m of meta) {
    if (!m.id || !m.snippet?.title) continue;
    const views = Number(m.statistics?.viewCount ?? 0) || 0;
    const likes = Number(m.statistics?.likeCount ?? 0) || 0;
    const thumbs = m.snippet.thumbnails ?? {};
    const shared = {
      title: m.snippet.title,
      description: m.snippet.description ?? null,
      channel_name: m.snippet.channelTitle ?? null,
      channel_id: m.snippet.channelId ?? null,
      view_count: BigInt(views),
      like_count: BigInt(likes),
      duration_seconds: parseIsoDuration(m.contentDetails?.duration),
      published_at: m.snippet.publishedAt ? new Date(m.snippet.publishedAt) : null,
      thumbnail_url: thumbs['high']?.url ?? thumbs['medium']?.url ?? thumbs['default']?.url ?? null,
      is_active: true,
      refreshed_at: new Date(),
    };
    try {
      await prisma.video_pool.upsert({
        where: { video_id: m.id },
        create: {
          video_id: m.id,
          language: 'ko',
          quality_tier: tierByViews(views),
          source: POOL_SOURCE,
          ...shared,
        },
        update: shared, // source and language stay as first written
      });
      stored += 1;
    } catch (err) {
      log.warn('pool write failed', { videoId: m.id, error: (err as Error).message });
    }
  }
  log.info('channel uploads stored in pool', { stored, of: meta.length });
}

export interface ChannelPick {
  videoId: string;
  relevancePct: number;
}

export interface CollectChannelUploadsArgs {
  channels: Array<{ channel_id: string; uploads_playlist_id: string | null }>;
  since: Date;
  limit: number;
  apiKeys: string[];
  fetchImpl?: typeof fetch;
}

/**
 * Collect this week's uploads across every followed channel, drop Shorts, and
 * order newest-first.
 *
 * Interleaved round-robin by channel so one prolific uploader cannot fill the
 * whole week: take each channel's newest, then each channel's second-newest, and
 * so on. Within a round, newer wins.
 *
 * An empty result is a legitimate outcome (§2-d): a week where nothing was
 * uploaded shows an honest empty week, not filler from somewhere else.
 */
export async function collectChannelUploads(
  args: CollectChannelUploadsArgs
): Promise<ChannelPick[]> {
  const { channels, since, limit, apiKeys, fetchImpl = fetch } = args;
  const usable = channels.filter((c) => c.uploads_playlist_id);
  if (usable.length === 0 || limit <= 0) return [];

  const perChannel = await Promise.all(
    usable.map((c) =>
      fetchChannelUploads(c.channel_id, c.uploads_playlist_id as string, since, apiKeys, fetchImpl)
    )
  );

  const all = perChannel.flat();
  if (all.length === 0) return [];

  // Shorts are excluded the same way the rest of the product excludes them —
  // by measured duration, not by title heuristics.
  //
  // Two kinds of "no duration" that must not be conflated:
  //   the call failed        -> nothing was measured, keep everything. An API
  //                             blip must not silently empty someone's week.
  //   the call returned but
  //   this video has none    -> treat as Shorts, per isShortsByDuration: videos.list
  //                             omits contentDetails.duration for Shorts specifically.
  let measured = true;
  const meta = await videosBatchFullMetadata({
    videoIds: [...new Set(all.map((u) => u.videoId))],
    apiKey: apiKeys,
    fetchFn: fetchImpl,
  }).catch((err: unknown) => {
    log.warn('videos.list failed, shorts filter unavailable this run', {
      error: (err as Error).message,
    });
    measured = false;
    return [];
  });
  const durationById = new Map(
    meta.map((m) => [m.id, parseIsoDuration(m.contentDetails?.duration)])
  );

  // The deck reads title, channel, duration and thumbnail from video_pool, and
  // nothing else puts a channel upload there -- the discover path only ever
  // stores what it found in the pool to begin with. Without this the week's
  // cards render blank: the item exists, its metadata does not.
  //
  // We already hold that metadata; it was fetched for the Shorts filter above.
  await storeUploadsInPool(meta);

  const eligible = measured
    ? all.filter((u) => !isShortsByDuration(durationById.get(u.videoId) ?? null))
    : all;

  const byChannel = new Map<string, ChannelUpload[]>();
  for (const u of eligible) {
    const list = byChannel.get(u.channelId) ?? [];
    list.push(u);
    byChannel.set(u.channelId, list);
  }
  for (const list of byChannel.values()) {
    list.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  }

  const picked: ChannelPick[] = [];
  const seen = new Set<string>();
  const lists = [...byChannel.values()];
  const deepest = Math.max(...lists.map((l) => l.length));
  for (let round = 0; round < deepest && picked.length < limit; round++) {
    const thisRound = lists
      .map((l) => l[round])
      .filter((u): u is ChannelUpload => Boolean(u))
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    for (const u of thisRound) {
      if (picked.length >= limit) break;
      if (seen.has(u.videoId)) continue;
      seen.add(u.videoId);
      picked.push({ videoId: u.videoId, relevancePct: CHANNEL_MODE_RELEVANCE_PCT });
    }
  }
  return picked;
}
