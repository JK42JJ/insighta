/**
 * refresh-metadata — keep ACTIVE video_pool rows ToS-compliant AND usable.
 *
 * YouTube's 30-day metadata rule is refresh-OR-delete. The old design only did
 * the "delete" branch (pool-maintenance scrub → title=''), which emptied active
 * served rows and produced title-less cards (CP512 P0). The correct branch for a
 * row you keep serving is REFRESH: re-fetch its metadata via videos.list (1 unit
 * / 50 ids — cheap) and reset refreshed_at. Rows the API no longer returns
 * (deleted / private / region-blocked) can't be refreshed → retire them
 * (is_active=false) so the scrub op purges their metadata legitimately.
 */
import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
import {
  videosBatchFullMetadata,
  resolveVideosApiKeys,
  parseIsoDuration,
  type YouTubeVideoFullMetadata,
} from '@/skills/plugins/video-discover/v2/youtube-client';

const log = logger.child({ module: 'video-pool/refresh-metadata' });

/** Refresh this many days before the 30-day ToS TTL so a served row's metadata
 *  is never older than 30 days (10-day head-room before scrub would apply). */
export const REFRESH_AFTER_DAYS = 20;
/** Rows re-fetched per run — bounded so one run stays far under daily quota
 *  (500 / 50 = 10 videos.list calls = 10 units). */
export const REFRESH_BATCH_LIMIT = 500;

const TITLE_MAX = 5000;

export interface RefreshResult {
  candidates: number;
  refreshed: number;
  retired: number;
}

/** Minimal DB surface — satisfied by PrismaClient and by a test mock. */
export interface RefreshDb {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  video_pool: {
    update(args: { where: { video_id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface RefreshDeps {
  db: RefreshDb;
  /** Fetch full metadata for a list of video ids (videos.list, part=snippet…). */
  fetchMetadata: (videoIds: string[]) => Promise<YouTubeVideoFullMetadata[]>;
  now: Date;
  limit: number;
  afterDays: number;
}

const toInt = (v?: string): number => {
  const n = v ? parseInt(v, 10) : 0;
  return Number.isFinite(n) ? n : 0;
};

/**
 * Core logic — pure over injected deps (DB + fetcher + clock) so it is
 * unit-testable without a real DB or YouTube key.
 */
export async function refreshActivePoolMetadataCore(deps: RefreshDeps): Promise<RefreshResult> {
  const { db, fetchMetadata, now, limit, afterDays } = deps;

  const rows = await db.$queryRawUnsafe<{ video_id: string }[]>(
    `SELECT video_id FROM public.video_pool
      WHERE is_active = true
        AND refreshed_at < now() - interval '${afterDays} days'
      ORDER BY refreshed_at ASC
      LIMIT ${limit}`
  );
  const videoIds = rows.map((r) => r.video_id);
  if (videoIds.length === 0) return { candidates: 0, refreshed: 0, retired: 0 };

  let items: YouTubeVideoFullMetadata[];
  try {
    items = await fetchMetadata(videoIds);
  } catch (err) {
    log.error('refresh: videos.list failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { candidates: videoIds.length, refreshed: 0, retired: 0 };
  }

  const returned = new Set<string>();
  let refreshed = 0;
  for (const item of items) {
    const id = item.id;
    if (!id) continue;
    returned.add(id);
    const s = item.snippet ?? {};
    const title = (s.title ?? '').slice(0, TITLE_MAX);
    // Integrity guard — never write an empty title back onto a row.
    if (!title.trim()) continue;
    try {
      await db.video_pool.update({
        where: { video_id: id },
        data: {
          title,
          description: s.description ? s.description.slice(0, TITLE_MAX) : null,
          channel_name: s.channelTitle ? s.channelTitle.slice(0, 200) : null,
          channel_id: s.channelId ? s.channelId.slice(0, 30) : null,
          view_count: BigInt(toInt(item.statistics?.viewCount)),
          like_count: BigInt(toInt(item.statistics?.likeCount)),
          duration_seconds: parseIsoDuration(item.contentDetails?.duration),
          published_at: s.publishedAt ? new Date(s.publishedAt) : null,
          thumbnail_url: s.thumbnails?.high?.url ?? s.thumbnails?.default?.url ?? null,
          refreshed_at: now,
        },
      });
      refreshed += 1;
    } catch (err) {
      log.warn('refresh: update failed', {
        video_id: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Videos the API didn't return = unrefreshable (deleted/private/blocked) →
  // retire so the scrub op purges their metadata on schedule.
  const missing = videoIds.filter((id) => !returned.has(id));
  let retired = 0;
  if (missing.length > 0) {
    retired = Number(
      await db.$executeRawUnsafe(
        `UPDATE public.video_pool SET is_active = false WHERE video_id = ANY($1::text[])`,
        missing
      )
    );
  }

  log.info('refresh: done', { candidates: videoIds.length, refreshed, retired });
  return { candidates: videoIds.length, refreshed, retired };
}

/** Production entry — wires the real Prisma client + VIDEOS key pool. */
export async function runPoolMetadataRefresh(opts?: {
  limit?: number;
  afterDays?: number;
}): Promise<RefreshResult> {
  const apiKeys = resolveVideosApiKeys(process.env);
  if (apiKeys.length === 0) {
    log.warn('refresh: no VIDEOS api key — skipping');
    return { candidates: 0, refreshed: 0, retired: 0 };
  }
  return refreshActivePoolMetadataCore({
    db: getPrismaClient() as unknown as RefreshDb,
    fetchMetadata: (videoIds) => videosBatchFullMetadata({ videoIds, apiKey: apiKeys }),
    now: new Date(),
    limit: opts?.limit ?? REFRESH_BATCH_LIMIT,
    afterDays: opts?.afterDays ?? REFRESH_AFTER_DAYS,
  });
}
