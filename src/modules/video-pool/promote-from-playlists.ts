/**
 * Promote user's curated YouTube playlists into video_pool (CP458).
 *
 * Analogous to promote-from-v2.ts but the source is the user's own
 * YouTube playlists rather than v2 layered summaries.  Every video in
 * every playlist is considered "quality-guaranteed by the curator", so
 * we unconditionally set quality_tier='gold' and source='user_playlist'.
 *
 * Pipeline:
 *   1. getUserPlaylists (paginated) → all playlist IDs.
 *   2. Per playlist: getPlaylistItems (paginated) → unique video IDs.
 *   3. Filter: NOT EXISTS in video_pool.
 *   4. Take first `limit` pending IDs (default 200, max 500).
 *   5. getVideosMetadata for those IDs.
 *   6. Build embed text (title + description, cap 2000 chars).
 *   7. embedBatch via Mac Mini Ollama (fail-open if unreachable).
 *   8. INSERT video_pool + video_pool_embeddings.
 *
 * Blast radius: video_pool + video_pool_embeddings INSERT only.
 * No UPDATE, no DELETE, no impact on existing rows.
 */

import { Prisma } from '@prisma/client';

import { getPrismaClient } from '@/modules/database/client';
import {
  embedBatch,
  isOllamaReachable,
  vectorToLiteral,
  QWEN3_EMBED_MODEL,
  MAC_MINI_OLLAMA_DEFAULT_URL,
} from '@/skills/plugins/iks-scorer/embedding';
import {
  getUserPlaylists,
  getPlaylistItems,
  getVideosMetadata,
  VideoMetadata,
} from '@/modules/youtube/api';
import { logger } from '@/utils/logger';
import { shortGateFields } from './is-short';

const log = logger.child({ module: 'modules/video-pool/promote-from-playlists' });

const SOURCE_TAG = 'user_playlist';
const QUALITY_TIER = 'gold';
const DEFAULT_BATCH_LIMIT = 200;
const MAX_BATCH_LIMIT = 500;
const TEXT_INPUT_MAX_CHARS = 2000;
const TITLE_MAX_CHARS = 5000;
const DESCRIPTION_MAX_CHARS = 5000;
const CHANNEL_NAME_MAX_CHARS = 200;
const LANGUAGE_MAX_CHARS = 5;
const DEFAULT_LANGUAGE = 'ko';

export interface PromoteResult {
  playlists_scanned: number;
  candidates: number;
  promoted: number;
  embedded: number;
  embeddings_skipped_unreachable: boolean;
  errors: { video_id: string; error: string }[];
}

export interface PromotePlaylistsOptions {
  /** Which user's playlists to import (must have YouTube connected). */
  userId: string;
  /** Max candidates to promote per call (default 200, max 500). */
  limit?: number;
  /** When true, skip writes and return planned action counts only. */
  dryRun?: boolean;
  /** Override the Ollama URL (default Mac Mini Tailscale). */
  ollamaUrl?: string;
}

function buildEmbedText(meta: VideoMetadata): string {
  const parts: string[] = [];
  if (meta.title) parts.push(meta.title);
  if (meta.description) parts.push(meta.description);
  return parts.join('\n').slice(0, TEXT_INPUT_MAX_CHARS);
}

export async function promotePlaylistsToVideoPool(
  opts: PromotePlaylistsOptions
): Promise<PromoteResult> {
  const limit = Math.max(1, Math.min(MAX_BATCH_LIMIT, opts.limit ?? DEFAULT_BATCH_LIMIT));
  const ollamaUrl = opts.ollamaUrl ?? MAC_MINI_OLLAMA_DEFAULT_URL;
  const { userId } = opts;
  const prisma = getPrismaClient();

  // 1. Collect all playlist IDs (paginated).
  const allPlaylistIds: string[] = [];
  let playlistPageToken: string | undefined;
  do {
    const page = await getUserPlaylists(userId, playlistPageToken);
    for (const pl of page.items) {
      if (pl.playlistId) allPlaylistIds.push(pl.playlistId);
    }
    playlistPageToken = page.nextPageToken;
  } while (playlistPageToken);

  const playlists_scanned = allPlaylistIds.length;
  log.info('playlists_scanned', { userId, playlists_scanned });

  if (playlists_scanned === 0) {
    return {
      playlists_scanned: 0,
      candidates: 0,
      promoted: 0,
      embedded: 0,
      embeddings_skipped_unreachable: false,
      errors: [],
    };
  }

  // 2. Collect unique video IDs from all playlists (paginated per playlist).
  const seenVideoIds = new Set<string>();
  for (const playlistId of allPlaylistIds) {
    let itemPageToken: string | undefined;
    do {
      const page = await getPlaylistItems(userId, playlistId, itemPageToken);
      for (const item of page.items) {
        if (item.videoId) seenVideoIds.add(item.videoId);
      }
      itemPageToken = page.nextPageToken;
    } while (itemPageToken);
  }

  const allVideoIds = Array.from(seenVideoIds);
  log.info('video_ids_collected', { userId, total: allVideoIds.length });

  // 3. Filter to IDs not already in video_pool.
  // Batch the NOT EXISTS check in chunks to avoid huge IN() clauses.
  const FILTER_CHUNK = 500;
  const pendingIds: string[] = [];
  for (let i = 0; i < allVideoIds.length; i += FILTER_CHUNK) {
    const chunk = allVideoIds.slice(i, i + FILTER_CHUNK);
    const existing = await prisma.$queryRaw<{ video_id: string }[]>(Prisma.sql`
      SELECT video_id FROM video_pool WHERE video_id = ANY(${chunk}::text[])
    `);
    const existingSet = new Set(existing.map((r) => r.video_id));
    for (const vid of chunk) {
      if (!existingSet.has(vid)) pendingIds.push(vid);
    }
  }

  log.info('pending_after_filter', { userId, pending: pendingIds.length });

  // 4. Take first `limit` pending IDs.
  const toImport = pendingIds.slice(0, limit);

  if (toImport.length === 0) {
    return {
      playlists_scanned,
      candidates: 0,
      promoted: 0,
      embedded: 0,
      embeddings_skipped_unreachable: false,
      errors: [],
    };
  }

  const candidates = toImport.length;

  if (opts.dryRun) {
    return {
      playlists_scanned,
      candidates,
      promoted: 0,
      embedded: 0,
      embeddings_skipped_unreachable: false,
      errors: [],
    };
  }

  // 5. Fetch video metadata.
  const metaList = await getVideosMetadata(userId, toImport);
  const metaByVideoId = new Map<string, VideoMetadata>(metaList.map((m) => [m.videoId, m]));

  // 6. Build embed texts.
  const validMeta: VideoMetadata[] = [];
  const errors: { video_id: string; error: string }[] = [];

  for (const videoId of toImport) {
    const meta = metaByVideoId.get(videoId);
    // CP512 — reject blank/whitespace titles too (insertion integrity guard):
    // an empty-title pool row can't be served and reads as a title-loss defect.
    if (!meta || !meta.title || !meta.title.trim()) {
      errors.push({ video_id: videoId, error: 'metadata missing or no title' });
      continue;
    }
    validMeta.push(meta);
  }

  // 7. Generate embeddings (fail-open if Ollama unreachable).
  const reachable = await isOllamaReachable({ baseUrl: ollamaUrl });
  let embeddings: (number[] | null)[] = [];
  if (reachable) {
    try {
      const inputs = validMeta.map(buildEmbedText);
      embeddings = await embedBatch(inputs, { baseUrl: ollamaUrl });
      if (embeddings.length !== validMeta.length) {
        log.warn('embed_count_mismatch', {
          got: embeddings.length,
          expected: validMeta.length,
        });
        embeddings = [];
      }
    } catch (err) {
      log.warn('embedBatch failed — continuing without embeddings', {
        err: err instanceof Error ? err.message : String(err),
      });
      embeddings = [];
    }
  } else {
    log.warn('Ollama unreachable — promoting without embeddings');
  }

  // 8. INSERT video_pool + video_pool_embeddings.
  let promoted = 0;
  let embedded = 0;

  for (let i = 0; i < validMeta.length; i += 1) {
    const meta = validMeta[i]!;
    try {
      const titleSafe = meta.title.slice(0, TITLE_MAX_CHARS);
      const descSafe = meta.description ? meta.description.slice(0, DESCRIPTION_MAX_CHARS) : null;
      const channelSafe = meta.channelTitle
        ? meta.channelTitle.slice(0, CHANNEL_NAME_MAX_CHARS)
        : null;
      const langSafe = (meta.defaultLanguage ?? DEFAULT_LANGUAGE).slice(0, LANGUAGE_MAX_CHARS);

      // CP491 step 4 — short gate (demote Shorts at promote).
      const shortGate = await shortGateFields(meta.videoId, meta.durationSeconds ?? null);
      await prisma.video_pool.create({
        data: {
          ...shortGate,
          video_id: meta.videoId,
          title: titleSafe,
          description: descSafe,
          channel_name: channelSafe,
          channel_id: meta.channelId || null,
          view_count: BigInt(meta.viewCount),
          like_count: BigInt(meta.likeCount),
          duration_seconds: meta.durationSeconds || null,
          published_at: meta.publishedAt ? new Date(meta.publishedAt) : null,
          thumbnail_url: meta.thumbnailUrl || null,
          language: langSafe,
          quality_tier: QUALITY_TIER,
          source: SOURCE_TAG,
        },
      });
      promoted += 1;

      const vec = embeddings[i];
      if (vec && vec.length > 0) {
        await prisma.$executeRaw(Prisma.sql`
          INSERT INTO public.video_pool_embeddings (video_id, embedding, text_input, model_version)
          VALUES (${meta.videoId}, ${vectorToLiteral(vec)}::vector, ${buildEmbedText(meta)}, ${QWEN3_EMBED_MODEL})
          ON CONFLICT (video_id, model_version) DO NOTHING
        `);
        embedded += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ video_id: meta.videoId, error: msg.slice(0, 200) });
    }
  }

  log.info('promote-from-playlists done', {
    userId,
    playlists_scanned,
    candidates,
    promoted,
    embedded,
    errors: errors.length,
  });

  return {
    playlists_scanned,
    candidates,
    promoted,
    embedded,
    embeddings_skipped_unreachable: !reachable,
    errors,
  };
}
