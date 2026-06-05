/**
 * Promote youtube_videos rows into video_pool (CP494 ② supply bridge MVP).
 *
 * The Mac Mini collector (yt-dlp discovery = quota 0, videos.list enrich =
 * 1u/50 videos) sinks into `youtube_videos`, but the consumption pool
 * (`video_pool`, what v5 pool-first match reads) never saw those rows —
 * supply and consumption were two disconnected systems. This bridges them:
 *
 *   1. SELECT candidates: youtube_videos with usable metadata
 *      (title + view_count present) AND NOT already in video_pool.
 *   2. classifyQuality (batch-video-collector gate, same as reuse-from-v5):
 *      rejected OR bronze → skip. Consumers read gold/silver only, and the
 *      Free Plan 500MB budget shouldn't pay for rows nobody reads.
 *   3. shortGateFields → demote Shorts at promote (CP491 convention).
 *   4. INSERT video_pool with source='yt_promoted' — create-only (no UPDATE,
 *      no DELETE; NOT-EXISTS dedup makes re-runs no-ops).
 *   5. Embedding via Mac Mini Ollama, fail-open (mirrors promote-from-v2:
 *      unreachable/timeout → promote without embeddings, tsvector still
 *      matches immediately; dense rerank can backfill later).
 *
 * Flag: SUPPLY_YT_BRIDGE_ENABLED (default off) gates the write at the route
 * (video-pool-promote.ts) AND the read in v5 poolSources (v5/config.ts) —
 * one flag, write↔read pair, off = current behavior.
 *
 * Blast radius: video_pool + video_pool_embeddings INSERT only.
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
import { classifyQuality } from '@/skills/plugins/batch-video-collector/quality';
import { logger } from '@/utils/logger';
import { shortGateFields } from './is-short';

const log = logger.child({ module: 'modules/video-pool/promote-from-youtube-videos' });

export const YT_PROMOTED_SOURCE = 'yt_promoted';
const DEFAULT_BATCH_LIMIT = 100;
const TEXT_INPUT_MAX_CHARS = 2000;

export interface YtPromoteResult {
  candidates: number;
  promoted: number;
  embedded: number;
  gold: number;
  silver: number;
  /** classifyQuality accepted but tier=bronze — not pool-worthy (consumers read gold/silver). */
  skipped_bronze: number;
  /** classifyQuality rejected (view floor / duration / blocklist / missing metadata). */
  skipped_rejected: number;
  embeddings_skipped_unreachable: boolean;
  errors: { video_id: string; error: string }[];
}

interface CandidateRow {
  video_id: string;
  title: string;
  description: string | null;
  channel_title: string | null;
  channel_id: string | null;
  view_count: bigint;
  like_count: bigint | null;
  duration_seconds: number | null;
  published_at: Date | null;
  thumbnail_url: string | null;
  default_language: string | null;
}

function buildEmbedText(row: CandidateRow): string {
  // No v2 one_liner/core_argument here — title + description is the densest
  // signal youtube_videos carries (same fields the tsvector GIN indexes).
  const parts: string[] = [row.title];
  if (row.description) parts.push(row.description);
  return parts.join('\n').slice(0, TEXT_INPUT_MAX_CHARS);
}

export interface YtPromoteOptions {
  /** Max candidates to evaluate per call (default 100, cap 500 at the route). */
  limit?: number;
  /** When true, skip writes and return planned action counts only. */
  dryRun?: boolean;
  /** Override the Ollama URL (default Mac Mini Tailscale). */
  ollamaUrl?: string;
}

export async function promoteYoutubeVideosToPool(
  opts: YtPromoteOptions = {}
): Promise<YtPromoteResult> {
  const limit = Math.max(1, Math.min(500, opts.limit ?? DEFAULT_BATCH_LIMIT));
  const ollamaUrl = opts.ollamaUrl ?? MAC_MINI_OLLAMA_DEFAULT_URL;
  const prisma = getPrismaClient();

  // 1. Candidates: usable metadata + not already pooled. Recency-first so a
  // capped batch drains the freshest supply (collector runs daily).
  const candidates = await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
    SELECT
      yv.youtube_video_id   AS video_id,
      yv.title              AS title,
      yv.description        AS description,
      yv.channel_title      AS channel_title,
      yv.channel_id         AS channel_id,
      yv.view_count         AS view_count,
      yv.like_count         AS like_count,
      yv.duration_seconds   AS duration_seconds,
      yv.published_at       AS published_at,
      yv.thumbnail_url      AS thumbnail_url,
      yv.default_language   AS default_language
    FROM youtube_videos yv
    WHERE yv.title IS NOT NULL
      AND yv.view_count IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM video_pool vp WHERE vp.video_id = yv.youtube_video_id
      )
    ORDER BY yv.published_at DESC NULLS LAST
    LIMIT ${limit}
  `);

  const empty: YtPromoteResult = {
    candidates: 0,
    promoted: 0,
    embedded: 0,
    gold: 0,
    silver: 0,
    skipped_bronze: 0,
    skipped_rejected: 0,
    embeddings_skipped_unreachable: false,
    errors: [],
  };
  if (candidates.length === 0) return empty;

  // 2. Quality gate up-front (pure, no I/O) — dryRun shares the exact gate.
  const gated = candidates.map((c) => ({
    row: c,
    verdict: classifyQuality({
      title: c.title,
      viewCount: c.view_count != null ? Number(c.view_count) : null,
      durationSec: c.duration_seconds,
    }),
  }));
  const admissible = gated.filter(
    (g) => g.verdict.accepted && (g.verdict.tier === 'gold' || g.verdict.tier === 'silver')
  );
  const skippedBronze = gated.filter(
    (g) => g.verdict.accepted && g.verdict.tier === 'bronze'
  ).length;
  const skippedRejected = gated.filter((g) => !g.verdict.accepted).length;

  if (opts.dryRun) {
    return {
      ...empty,
      candidates: candidates.length,
      gold: admissible.filter((g) => g.verdict.tier === 'gold').length,
      silver: admissible.filter((g) => g.verdict.tier === 'silver').length,
      skipped_bronze: skippedBronze,
      skipped_rejected: skippedRejected,
    };
  }

  // 5(pre). Embeddings up-front, fail-open (promote-from-v2 mirror).
  const reachable = await isOllamaReachable({ baseUrl: ollamaUrl });
  let embeddings: (number[] | null)[] = [];
  if (reachable) {
    try {
      const inputs = admissible.map((g) => buildEmbedText(g.row));
      embeddings = await embedBatch(inputs, { baseUrl: ollamaUrl });
      if (embeddings.length !== admissible.length) {
        log.warn('embed_count_mismatch', {
          got: embeddings.length,
          expected: admissible.length,
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

  // 3+4+5. Insert video_pool (+embeddings) per admissible row.
  const errors: { video_id: string; error: string }[] = [];
  let promoted = 0;
  let embedded = 0;
  let gold = 0;
  let silver = 0;

  for (let i = 0; i < admissible.length; i += 1) {
    const { row: c, verdict } = admissible[i]!;
    const tier = verdict.tier!;
    try {
      const titleSafe = c.title.slice(0, 5000);
      const descSafe = c.description ? c.description.slice(0, 5000) : null;
      const channelSafe = c.channel_title ? c.channel_title.slice(0, 200) : null;
      const channelIdSafe = c.channel_id ? c.channel_id.slice(0, 30) : null;
      const langSafe = (c.default_language ?? 'ko').slice(0, 5);

      // CP491 — short gate (demote Shorts at promote; consumers filter is_active).
      const shortGate = await shortGateFields(c.video_id, c.duration_seconds);
      await prisma.video_pool.create({
        data: {
          ...shortGate,
          video_id: c.video_id,
          title: titleSafe,
          description: descSafe,
          channel_name: channelSafe,
          channel_id: channelIdSafe,
          view_count: c.view_count ?? BigInt(0),
          like_count: c.like_count ?? BigInt(0),
          duration_seconds: c.duration_seconds,
          published_at: c.published_at,
          thumbnail_url: c.thumbnail_url,
          language: langSafe,
          quality_tier: tier,
          source: YT_PROMOTED_SOURCE,
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

  log.info('promote-from-youtube-videos done', {
    candidates: candidates.length,
    promoted,
    embedded,
    gold,
    silver,
    skipped_bronze: skippedBronze,
    skipped_rejected: skippedRejected,
    errors: errors.length,
  });

  return {
    candidates: candidates.length,
    promoted,
    embedded,
    gold,
    silver,
    skipped_bronze: skippedBronze,
    skipped_rejected: skippedRejected,
    embeddings_skipped_unreachable: !reachable,
    errors,
  };
}
