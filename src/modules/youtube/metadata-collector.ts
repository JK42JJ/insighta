/**
 * YouTube metadata collector (CP437, 2026-04-29).
 *
 * Fetches full videos.list metadata (parts=snippet,contentDetails,
 * statistics,topicDetails) and upserts the new columns added to
 * `youtube_videos` in migration 001_add_fields.sql.
 *
 * Hard Rule note (2026-04-29 user directive):
 *   - Collects `comment_count` (numeric quality signal) only.
 *   - Does NOT call commentThreads.list / comments.list — comment text
 *     and pinned comments are out of scope. Transcript path
 *     (rich-summary v2) is the canonical text source.
 */

import { Prisma } from '@prisma/client';

import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import {
  videosBatchFullMetadata,
  topicCategoryUrlToSlug,
  type YouTubeVideoFullMetadata,
} from '@/skills/plugins/video-discover/v2/youtube-client';
import { resolveSearchApiKeys } from '@/skills/plugins/video-discover/v2/youtube-client';
import { isDomainSlug, type DomainSlug } from '@/config/domains';

const log = logger.child({ module: 'YouTubeMetadataCollector' });

export interface MetadataUpsertResult {
  videoIds: string[];
  fetched: number;
  upserted: number;
  errors: number;
}

/**
 * Fetch + upsert metadata for the given youtube_video_id list. Idempotent.
 * Returns counters for logging by callers (cron tick reporter).
 */
export async function collectAndUpsertMetadata(
  videoIds: string[],
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<MetadataUpsertResult> {
  if (videoIds.length === 0) {
    return { videoIds: [], fetched: 0, upserted: 0, errors: 0 };
  }
  const apiKeys = resolveSearchApiKeys(env);
  if (apiKeys.length === 0) {
    log.warn('No YouTube API key available — metadata collector aborting');
    return { videoIds, fetched: 0, upserted: 0, errors: videoIds.length };
  }

  let items: YouTubeVideoFullMetadata[];
  try {
    items = await videosBatchFullMetadata({ videoIds, apiKey: apiKeys });
  } catch (err) {
    log.error('videos.list batch failed', {
      videoIds: videoIds.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return { videoIds, fetched: 0, upserted: 0, errors: videoIds.length };
  }

  let upserted = 0;
  let errors = 0;
  const prisma = getPrismaClient();
  const now = new Date();

  for (const item of items) {
    if (!item.id) continue;
    try {
      const data = mapToColumns(item, now);
      await prisma.youtube_videos.update({
        where: { youtube_video_id: item.id },
        data,
      });
      upserted += 1;
    } catch (err) {
      errors += 1;
      log.warn('upsert failed (non-fatal)', {
        videoId: item.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info('metadata batch upserted', {
    requested: videoIds.length,
    fetched: items.length,
    upserted,
    errors,
  });
  return { videoIds, fetched: items.length, upserted, errors };
}

interface MetadataColumns {
  view_count: bigint | null;
  like_count: bigint | null;
  comment_count: bigint | null;
  tags: string[];
  topic_categories: string[];
  has_caption: boolean | null;
  default_language: string | null;
  metadata_fetched_at: Date;
  updated_at: Date;
}

function mapToColumns(item: YouTubeVideoFullMetadata, now: Date): Prisma.youtube_videosUpdateInput {
  const stats = item.statistics ?? {};
  const snippet = item.snippet ?? {};
  const cd = item.contentDetails ?? {};
  const td = item.topicDetails ?? {};

  const cols: MetadataColumns = {
    view_count: parseBigInt(stats.viewCount),
    like_count: parseBigInt(stats.likeCount),
    comment_count: parseBigInt(stats.commentCount),
    tags: Array.isArray(snippet.tags) ? snippet.tags.slice(0, 100) : [],
    topic_categories: extractTopicCategories(td.topicCategories ?? []),
    has_caption: typeof cd.caption === 'string' ? cd.caption.toLowerCase() === 'true' : null,
    default_language:
      typeof snippet.defaultLanguage === 'string'
        ? snippet.defaultLanguage.slice(0, 10)
        : typeof snippet.defaultAudioLanguage === 'string'
          ? snippet.defaultAudioLanguage.slice(0, 10)
          : null,
    metadata_fetched_at: now,
    updated_at: now,
  };
  return cols as unknown as Prisma.youtube_videosUpdateInput;
}

function parseBigInt(s: string | undefined): bigint | null {
  if (!s) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

/**
 * Extract slug-only categories from the topicCategories URL list. Keeps
 * the original URL list out of the column (decreases payload, normalizes
 * to lowercase slugs that align with `src/config/domains.ts`).
 *
 * Returns the union of Wikipedia URL slugs (lowercased + underscores
 * stripped). Output may include slugs that are NOT in `DOMAIN_SLUGS`
 * (e.g. 'sports', 'politics' from YouTube's topic taxonomy) — callers
 * that need strict mapping should filter via `isDomainSlug`.
 */
function extractTopicCategories(urls: string[]): string[] {
  const out: string[] = [];
  for (const u of urls) {
    if (typeof u !== 'string' || u.length === 0) continue;
    const slug = topicCategoryUrlToSlug(u);
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}

/**
 * Convenience: filter raw topic categories to only the 9 SSOT domain
 * slugs. Used by downstream consumers that want a strict domain mapping.
 */
export function filterTopicCategoriesToDomainSlugs(raw: string[]): DomainSlug[] {
  const out: DomainSlug[] = [];
  for (const s of raw) {
    if (isDomainSlug(s) && !out.includes(s)) out.push(s);
  }
  return out;
}
