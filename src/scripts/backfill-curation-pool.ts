/**
 * Make the weeks that are already on screen renderable again.
 *
 * The deck reads title, channel, duration and thumbnail from video_pool. An
 * item whose video is absent there, or present but inactive, renders as
 * nothing: the count says 20, the screen shows 3. Measured on prod 2026-07-28,
 * across the last two weeks of active subscriptions:
 *
 *   renderable   112
 *   inactive     191 items /  27 distinct videos
 *   absent       179 items /  48 distinct videos
 *
 * Two different faults, so two different fixes, and neither is "flip is_active
 * to true and hope":
 *
 *   absent    the channel path stored ids without metadata (fixed forward in
 *             channel-uploads.ts). These rows need fetching once.
 *   inactive  something deactivated them — TTL, a scrub, or the video really
 *             did go away. YouTube is asked; only what still exists comes back.
 *
 * A video videos.list no longer returns has been deleted or made private. It
 * stays inactive, and this says how many, because silently reviving a dead row
 * would put a broken embed in someone's week.
 *
 *   docker exec -i insighta-api node dist/scripts/backfill-curation-pool.js [--dry]
 */

import { getPrismaClient } from '@/modules/database/client';
import {
  videosBatchFullMetadata,
  parseIsoDuration,
  resolveVideosApiKeys,
} from '@/skills/plugins/video-discover/v2/youtube-client';
import {
  QUALITY_GOLD_VIEW_COUNT,
  QUALITY_SILVER_VIEW_COUNT,
} from '@/skills/plugins/batch-video-collector/manifest';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'backfill-curation-pool' });

/** How far back to repair. Older weeks are history nobody is looking at. */
const WINDOW_DAYS = 14;

/** Provenance for rows this repair creates. Distinct so the reuse it produces
 *  stays measurable and is never confused with a collector row. */
const POOL_SOURCE = 'curation_repair';

function tierByViews(views: number): string {
  if (views >= QUALITY_GOLD_VIEW_COUNT) return 'gold';
  if (views >= QUALITY_SILVER_VIEW_COUNT) return 'silver';
  return 'bronze';
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const prisma = getPrismaClient();

  const broken = await prisma.$queryRawUnsafe<Array<{ video_id: string; state: string }>>(`
    SELECT DISTINCT ci.video_id,
           CASE WHEN vp.video_id IS NULL THEN 'absent' ELSE 'inactive' END AS state
      FROM curation_items ci
      JOIN curation_subscriptions s ON s.id = ci.subscription_id AND s.is_active
      LEFT JOIN video_pool vp ON vp.video_id = ci.video_id
     WHERE ci.week_of >= (CURRENT_DATE - INTERVAL '${WINDOW_DAYS} days')
       AND (vp.video_id IS NULL OR NOT vp.is_active)
  `);

  const absent = broken.filter((b) => b.state === 'absent').map((b) => b.video_id);
  const inactive = broken.filter((b) => b.state === 'inactive').map((b) => b.video_id);
  const ids = [...new Set([...absent, ...inactive])];

  log.info('backfill scope', {
    absent: absent.length,
    inactive: inactive.length,
    total: ids.length,
  });
  if (ids.length === 0) {
    log.info('nothing to repair');
    return;
  }
  if (dry) {
    log.info('dry run — stopping before any write');
    return;
  }

  // One videos.list call per 50 ids. Whatever comes back still exists.
  const meta = await videosBatchFullMetadata({
    videoIds: ids,
    apiKey: resolveVideosApiKeys(process.env),
  });
  const alive = new Set(meta.map((m) => m.id).filter(Boolean) as string[]);
  const gone = ids.filter((id) => !alive.has(id));

  let created = 0;
  let revived = 0;
  let failed = 0;

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
      const existed = inactive.includes(m.id);
      await prisma.video_pool.upsert({
        where: { video_id: m.id },
        create: {
          video_id: m.id,
          language: 'ko',
          quality_tier: tierByViews(views),
          source: POOL_SOURCE,
          ...shared,
        },
        // source and language stay as first written: a row that arrived through
        // a more authoritative path keeps its provenance.
        update: shared,
      });
      if (existed) revived++;
      else created++;
    } catch (err) {
      failed++;
      log.warn('pool write failed', { videoId: m.id, error: (err as Error).message });
    }
  }

  log.info('backfill complete', {
    created,
    revived,
    failed,
    // Deleted or made private. Left inactive on purpose — a revived dead row is
    // a broken embed in someone's week.
    goneForever: gone.length,
    goneIds: gone.slice(0, 20),
  });

  const after = await prisma.$queryRawUnsafe<Array<{ items: bigint; renderable: bigint }>>(`
    SELECT COUNT(*) AS items,
           COUNT(*) FILTER (WHERE vp.is_active) AS renderable
      FROM curation_items ci
      JOIN curation_subscriptions s ON s.id = ci.subscription_id AND s.is_active
      LEFT JOIN video_pool vp ON vp.video_id = ci.video_id
     WHERE ci.week_of >= (CURRENT_DATE - INTERVAL '${WINDOW_DAYS} days')
  `);
  const items = Number(after[0]?.items ?? 0);
  const renderable = Number(after[0]?.renderable ?? 0);
  log.info('renderable after repair', {
    renderable,
    items,
    pct: items === 0 ? 0 : Math.round((renderable / items) * 100),
  });

  await prisma.$disconnect();
}

main().catch((err) => {
  log.error('backfill failed', { error: (err as Error).message });
  process.exit(1);
});
