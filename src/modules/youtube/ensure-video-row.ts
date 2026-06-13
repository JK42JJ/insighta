/**
 * ensureYoutubeVideoRow — chokepoint guarantee that a youtube_videos row exists
 * for a videoId (CP500+ H fix).
 *
 * Why: any card-inflow path (wizard / add-cards / pool-serve / IdeaSpot D&D)
 * may place a card whose youtube_videos row was never ingested. The IdeaSpot
 * D&D path (local-cards Edge Function) in particular never produced a row
 * (source='user-d-and-d' rows = 0 ever). rich-summary generation re-reads
 * youtube_videos for title/description, so an absent row silently yields no v2
 * (the enrich job completes without writing). Rather than replicate metadata
 * ingest on every inflow path, this single chokepoint — called from the
 * enrich-rich-summary handler — fetches and creates the row on demand.
 *
 * Reuse: videosBatchFullMetadata (API-key path, background-safe) +
 * VideoManager.upsertVideo (validated column mapping + ISO duration parse +
 * create-or-update). No new mapping invented.
 *
 * Fail-open: returns false (never throws) when no API key is configured, the
 * YouTube lookup fails, or the video is unavailable — the caller proceeds and
 * the existing no-metadata behavior applies.
 */

import { youtube_v3 } from 'googleapis';
import { logger } from '@/utils/logger';
import { getPrismaClient } from '@/modules/database';
import {
  videosBatchFullMetadata,
  resolveVideosApiKeys,
} from '@/skills/plugins/video-discover/v2/youtube-client';
import { VideoManager } from '@/modules/video/manager';

const log = logger.child({ module: 'ensure-youtube-video-row' });

/**
 * Ensure a youtube_videos row exists for `videoId`. Returns true when the row
 * exists (already present or freshly created), false when it could not be
 * created. Never throws.
 */
export async function ensureYoutubeVideoRow(
  videoId: string,
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<boolean> {
  const prisma = getPrismaClient();
  try {
    const existing = await prisma.youtube_videos.findUnique({
      where: { youtube_video_id: videoId },
      select: { youtube_video_id: true },
    });
    if (existing) return true;

    const apiKeys = resolveVideosApiKeys(env);
    if (apiKeys.length === 0) {
      log.warn('no YouTube API key — cannot create missing youtube_videos row', { videoId });
      return false;
    }

    const [meta] = await videosBatchFullMetadata({ videoIds: [videoId], apiKey: apiKeys });
    if (!meta?.id) {
      log.warn('videos.list returned no item — youtube_videos row not created', { videoId });
      return false;
    }

    // YouTubeVideoFullMetadata shares the snippet/contentDetails/statistics
    // shape upsertVideo reads; the cast is structural, not a behavior change.
    await new VideoManager().upsertVideo(meta as unknown as youtube_v3.Schema$Video);
    log.info('created missing youtube_videos row (chokepoint)', { videoId });
    return true;
  } catch (err) {
    log.warn('ensure youtube_videos row failed (non-fatal)', {
      videoId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
