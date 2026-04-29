/**
 * Promote v2 layered summaries to video_pool (CP438, 2026-04-29).
 *
 * After CC authors a v2 layered JSON via `/internal/v2-summary/upsert-direct`,
 * the row sits in `video_rich_summaries` with `template_version='v2'` but
 * is NOT yet in `video_pool` (the table the recommender reads from).
 * This module promotes those v2-summaries into video_pool in batches:
 *
 *   1. SELECT 100 candidates: video_rich_summaries WHERE template_version='v2'
 *      AND video_id NOT IN (SELECT video_id FROM video_pool)
 *   2. JOIN youtube_videos for the canonical metadata (title, channel, ...)
 *   3. INSERT video_pool with quality_tier from completeness:
 *        completeness >= 0.9 → 'gold'
 *        else                → 'silver'
 *      source = 'v2_promoted'
 *   4. Generate embedding via Mac Mini Ollama (qwen3-embedding:8b) over
 *      a compact text_input (one_liner + analysis.core_argument + title).
 *   5. INSERT video_pool_embeddings on success; DO NOTHING on conflict.
 *
 * Filter strategy (CP438 spec, this iteration):
 *   - **No filter**: every v2 row is promoted regardless of completeness
 *     band. Future iterations will gate on user-action signals
 *     (dismiss/bookmark/watch dwell-time) — see `quality_tier` redefinition
 *     plan in the CP438 handoff.
 *
 * Blast radius: video_pool + video_pool_embeddings INSERT only. No
 * UPDATE, no DELETE, no impact on existing rows.
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
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'modules/video-pool/promote-from-v2' });

const SOURCE_TAG = 'v2_promoted';
const COMPLETENESS_GOLD_THRESHOLD = 0.9;
const DEFAULT_BATCH_LIMIT = 100;
const TEXT_INPUT_MAX_CHARS = 2000;

export interface PromoteResult {
  candidates: number;
  promoted: number;
  embedded: number;
  gold: number;
  silver: number;
  embeddings_skipped_unreachable: boolean;
  errors: { video_id: string; error: string }[];
}

interface CandidateRow {
  video_id: string;
  one_liner: string | null;
  completeness: number | null;
  source_language: string | null;
  core: unknown;
  analysis: unknown;
  // joined from youtube_videos
  yv_title: string | null;
  yv_description: string | null;
  yv_channel_title: string | null;
  yv_channel_id: string | null;
  yv_view_count: bigint | null;
  yv_like_count: bigint | null;
  yv_duration_seconds: number | null;
  yv_published_at: Date | null;
  yv_thumbnail_url: string | null;
  yv_default_language: string | null;
}

function quality(completeness: number | null): 'gold' | 'silver' {
  return (completeness ?? 0) >= COMPLETENESS_GOLD_THRESHOLD ? 'gold' : 'silver';
}

function buildEmbedText(row: CandidateRow): string {
  const parts: string[] = [];
  if (row.yv_title) parts.push(row.yv_title);
  if (row.one_liner) parts.push(row.one_liner);
  // analysis.core_argument is a hand-authored summary sentence; useful
  // for embedding-based retrieval. Other analysis fields tend to be
  // bullet lists which dilute the embedding signal.
  if (row.analysis && typeof row.analysis === 'object') {
    const argument = (row.analysis as { core_argument?: unknown }).core_argument;
    if (typeof argument === 'string' && argument.length > 0) {
      parts.push(argument);
    }
  }
  return parts.join('\n').slice(0, TEXT_INPUT_MAX_CHARS);
}

export interface PromoteOptions {
  /** Max candidates to promote per call (default 100). */
  limit?: number;
  /** When true, skip writes and return planned action counts only. */
  dryRun?: boolean;
  /** Override the Ollama URL (default Mac Mini Tailscale). */
  ollamaUrl?: string;
}

export async function promoteV2ToVideoPool(opts: PromoteOptions = {}): Promise<PromoteResult> {
  const limit = Math.max(1, Math.min(500, opts.limit ?? DEFAULT_BATCH_LIMIT));
  const ollamaUrl = opts.ollamaUrl ?? MAC_MINI_OLLAMA_DEFAULT_URL;
  const prisma = getPrismaClient();

  // 1+2. Fetch candidates joined with youtube_videos metadata.
  const candidates = await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
    SELECT
      vrs.video_id          AS video_id,
      vrs.one_liner         AS one_liner,
      vrs.completeness      AS completeness,
      vrs.source_language   AS source_language,
      vrs.core              AS core,
      vrs.analysis          AS analysis,
      yv.title              AS yv_title,
      yv.description        AS yv_description,
      yv.channel_title      AS yv_channel_title,
      yv.channel_id         AS yv_channel_id,
      yv.view_count         AS yv_view_count,
      yv.like_count         AS yv_like_count,
      yv.duration_seconds   AS yv_duration_seconds,
      yv.published_at       AS yv_published_at,
      yv.thumbnail_url      AS yv_thumbnail_url,
      yv.default_language   AS yv_default_language
    FROM video_rich_summaries vrs
    LEFT JOIN youtube_videos yv ON yv.youtube_video_id = vrs.video_id
    WHERE vrs.template_version = 'v2'
      AND NOT EXISTS (
        SELECT 1 FROM video_pool vp WHERE vp.video_id = vrs.video_id
      )
    ORDER BY vrs.updated_at DESC
    LIMIT ${limit}
  `);

  if (candidates.length === 0) {
    return {
      candidates: 0,
      promoted: 0,
      embedded: 0,
      gold: 0,
      silver: 0,
      embeddings_skipped_unreachable: false,
      errors: [],
    };
  }

  if (opts.dryRun) {
    let gold = 0;
    let silver = 0;
    for (const c of candidates) {
      if (quality(c.completeness) === 'gold') gold += 1;
      else silver += 1;
    }
    return {
      candidates: candidates.length,
      promoted: 0,
      embedded: 0,
      gold,
      silver,
      embeddings_skipped_unreachable: false,
      errors: [],
    };
  }

  // 4. Generate embeddings up-front via Mac Mini Ollama (parallel batch).
  const reachable = await isOllamaReachable({ baseUrl: ollamaUrl });
  let embeddings: number[][] = [];
  if (reachable) {
    try {
      const inputs = candidates.map(buildEmbedText);
      embeddings = await embedBatch(inputs, { baseUrl: ollamaUrl });
      if (embeddings.length !== candidates.length) {
        log.warn('embed_count_mismatch', {
          got: embeddings.length,
          expected: candidates.length,
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

  // 3+5. Insert video_pool + video_pool_embeddings.
  const errors: { video_id: string; error: string }[] = [];
  let promoted = 0;
  let embedded = 0;
  let gold = 0;
  let silver = 0;

  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i]!;
    if (!c.yv_title) {
      // No matching youtube_videos row — skip with explicit error so we
      // don't insert an orphan pool row that the recommender can't show.
      errors.push({ video_id: c.video_id, error: 'youtube_videos missing' });
      continue;
    }
    const tier = quality(c.completeness);
    try {
      // Cap title/description column lengths to match existing schema use
      // (batch-video-collector slices to 5000).
      const titleSafe = c.yv_title.slice(0, 5000);
      const descSafe = c.yv_description ? c.yv_description.slice(0, 5000) : null;
      const channelSafe = c.yv_channel_title ? c.yv_channel_title.slice(0, 200) : null;
      const channelIdSafe = c.yv_channel_id ? c.yv_channel_id.slice(0, 30) : null;
      const langSafe = (c.yv_default_language ?? c.source_language ?? 'ko').slice(0, 5);

      await prisma.video_pool.create({
        data: {
          video_id: c.video_id,
          title: titleSafe,
          description: descSafe,
          channel_name: channelSafe,
          channel_id: channelIdSafe,
          view_count: c.yv_view_count ?? BigInt(0),
          like_count: c.yv_like_count ?? BigInt(0),
          duration_seconds: c.yv_duration_seconds,
          published_at: c.yv_published_at,
          thumbnail_url: c.yv_thumbnail_url,
          language: langSafe,
          quality_tier: tier,
          source: SOURCE_TAG,
        },
      });
      promoted += 1;
      if (tier === 'gold') gold += 1;
      else silver += 1;

      const vec = embeddings[i];
      if (vec && vec.length > 0) {
        await prisma.$executeRaw(Prisma.sql`
          INSERT INTO public.video_pool_embeddings (video_id, embedding, text_input, model_version)
          VALUES (${c.video_id}, ${vectorToLiteral(vec)}::vector, ${buildEmbedText(c)}, ${QWEN3_EMBED_MODEL})
          ON CONFLICT (video_id, model_version) DO NOTHING
        `);
        embedded += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ video_id: c.video_id, error: msg.slice(0, 200) });
    }
  }

  log.info('promote-from-v2 done', {
    candidates: candidates.length,
    promoted,
    embedded,
    gold,
    silver,
    errors: errors.length,
  });

  return {
    candidates: candidates.length,
    promoted,
    embedded,
    gold,
    silver,
    embeddings_skipped_unreachable: !reachable,
    errors,
  };
}
