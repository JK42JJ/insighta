/**
 * batch-video-collector — executor
 *
 * PR2 scope: Source A (trend keywords). See manifest.ts + plan file at
 * /Users/jeonhokim/.claude/plans/linked-beaming-mccarthy.md.
 *
 * Flow (execute):
 *   1. INSERT video_pool_collection_runs (status='running')
 *   2. loadTrendKeywords(limit)
 *   3. For each keyword (parallel chunks) → searchVideos
 *   4. dedupe by video_id
 *   5. videosBatch → view/like/duration
 *   6. classifyQuality (gate + tier)
 *   7. embedBatch (title + desc[:200])
 *   8. Upsert video_pool / video_pool_embeddings / video_pool_domain_tags
 *   9. Soft-expire (is_active=false where expires_at<now())
 *  10. UPDATE runs row with stats
 */

import { logger } from '@/utils/logger';
import { getPrismaClient } from '@/modules/database';
import { Prisma } from '@prisma/client';
import { enqueueEnrichVideo } from '@/modules/queue/handlers/enrich-video';
import { loadRichSummaryConfig } from '@/config/rich-summary';
import type {
  SkillExecutor,
  PreflightContext,
  PreflightResult,
  ExecuteContext,
  ExecuteResult,
} from '@/skills/_shared/types';
import { checkRequiredDependencies } from '@/skills/_shared/runtime';

import {
  manifest,
  BATCH_COLLECTOR_DAILY_KEYWORD_LIMIT,
  BATCH_COLLECTOR_ROTATION_DAYS,
  BATCH_COLLECTOR_SEARCH_MAX_RESULTS,
  BATCH_COLLECTOR_SEARCH_PARALLELISM,
} from './manifest';
import { loadTrendKeywords, type TrendKeyword } from './sources/trend-source';
import { classifyQuality, type QualityTier } from './quality';
import {
  searchVideos,
  videosBatch,
  parseIsoDuration,
  VIDEOS_LIST_MAX_IDS_PER_CALL,
  type YouTubeSearchItem,
  type YouTubeVideoStatsItem,
} from '../video-discover/v2/youtube-client';
import {
  embedBatch,
  isOllamaReachable,
  MAC_MINI_OLLAMA_DEFAULT_URL,
  QWEN3_EMBED_MODEL,
  vectorToLiteral,
} from '../iks-scorer/embedding';

const log = logger.child({ module: 'batch-video-collector' });

const DESC_SNIPPET_LEN = 200;
const DEFAULT_RUN_TYPE = 'daily_trend';

interface HydratedState {
  apiKey: string;
  ollamaUrl: string;
  limit: number;
  offset: number;
  runType: string;
}

/**
 * Compute keyword window offset for daily rotation.
 *
 * Day-of-epoch modulo rotation = deterministic 3-day cycle independent
 * of process restarts or GHA timing. Same UTC day = same window.
 */
export function computeRotationOffset(nowMs: number, limit: number, rotationDays: number): number {
  const dayOfEpoch = Math.floor(nowMs / 86_400_000);
  return (dayOfEpoch % Math.max(1, rotationDays)) * limit;
}

interface SearchHit {
  videoId: string;
  title: string;
  description: string;
  channelName: string | null;
  channelId: string | null;
  thumbnail: string | null;
  publishedAt: string | null;
  language: string;
  domains: Set<string>; // all domains that surfaced this video via their keywords
}

interface EnrichedVideo extends SearchHit {
  viewCount: number | null;
  likeCount: number | null;
  durationSec: number | null;
  tier: QualityTier;
}

export const executor: SkillExecutor = {
  manifest,

  async preflight(ctx: PreflightContext): Promise<PreflightResult> {
    const missing = checkRequiredDependencies(manifest, ctx.env);
    if (missing.length > 0) {
      return { ok: false, reason: `Missing required env: ${missing.join(', ')}` };
    }

    const apiKey = ctx.env['YOUTUBE_API_KEY_SEARCH'] ?? '';
    if (!apiKey) {
      return {
        ok: false,
        reason: 'YOUTUBE_API_KEY_SEARCH is required (server API key only, not user OAuth)',
      };
    }

    const ollamaUrl = ctx.env['OLLAMA_URL'] ?? MAC_MINI_OLLAMA_DEFAULT_URL;

    // Optional env-driven overrides. The SkillRegistry adapter intentionally
    // does not forward ad-hoc params so callers (GHA, admin tools) set
    // env vars on the process or use defaults.
    const limit = normalizeLimit(ctx.env['BATCH_COLLECTOR_LIMIT']);
    const runType = ctx.env['BATCH_COLLECTOR_RUN_TYPE'] ?? DEFAULT_RUN_TYPE;
    // 3-day rotation keeps daily quota under budget while covering the
    // full pool every cycle. Tests can override via BATCH_COLLECTOR_OFFSET.
    const envOffset = ctx.env['BATCH_COLLECTOR_OFFSET'];
    const offset =
      envOffset && /^\d+$/.test(envOffset)
        ? parseInt(envOffset, 10)
        : computeRotationOffset(Date.now(), limit, BATCH_COLLECTOR_ROTATION_DAYS);

    const state: HydratedState = { apiKey, ollamaUrl, limit, offset, runType };
    return { ok: true, hydrated: state as unknown as Record<string, unknown> };
  },

  async execute(ctx: ExecuteContext): Promise<ExecuteResult> {
    const t0 = Date.now();
    const state = ctx.state as unknown as HydratedState;
    const db = getPrismaClient();

    // 1. Create run row
    const run = await db.video_pool_collection_runs.create({
      data: { run_type: state.runType, status: 'running' },
      select: { id: true },
    });

    let videosFound = 0;
    let videosNew = 0;
    let videosUpdated = 0;
    let videosExpired = 0;
    let quotaUsed = 0;
    let quotaExhausted = false;

    try {
      // 2. Load trend keywords
      const keywords = await loadTrendKeywords(db, state.limit, { offset: state.offset });
      if (keywords.length === 0) {
        await finalizeRun(db, run.id, {
          status: 'failed',
          error: 'No trend keywords available (trend_signals empty or all expired)',
          queriesExecuted: 0,
          videosFound: 0,
          videosNew: 0,
          videosUpdated: 0,
          videosExpired: 0,
          quotaUsed: 0,
        });
        return {
          status: 'failed',
          data: { reason: 'empty_trend_signals' },
          error: 'trend_signals is empty — run trend-collector first',
          metrics: { duration_ms: Date.now() - t0 },
        };
      }

      // 3. YouTube search per keyword (bounded parallelism)
      const hitsByVideoId = new Map<string, SearchHit>();
      const queriesExecuted = await searchAllKeywords(
        keywords,
        state.apiKey,
        hitsByVideoId,
        (units) => {
          quotaUsed += units;
        },
        () => {
          quotaExhausted = true;
        }
      );
      videosFound = hitsByVideoId.size;
      log.info(`search phase done: ${queriesExecuted} queries, ${videosFound} unique candidates`);

      if (hitsByVideoId.size === 0) {
        const err = quotaExhausted
          ? 'YouTube quota exhausted before any video was fetched'
          : 'YouTube search returned 0 candidates across all keywords';
        await finalizeRun(db, run.id, {
          status: 'failed',
          error: err,
          queriesExecuted,
          videosFound: 0,
          videosNew: 0,
          videosUpdated: 0,
          videosExpired: 0,
          quotaUsed,
        });
        return {
          status: 'failed',
          data: { reason: 'empty_candidates', quota_exhausted: quotaExhausted },
          error: err,
          metrics: { duration_ms: Date.now() - t0 },
        };
      }

      // 5. videos.list — stats + duration (chunked internally by 50)
      const allIds = Array.from(hitsByVideoId.keys());
      let stats: YouTubeVideoStatsItem[] = [];
      try {
        stats = await videosBatch({ videoIds: allIds, apiKey: state.apiKey });
        quotaUsed += Math.ceil(allIds.length / VIDEOS_LIST_MAX_IDS_PER_CALL);
      } catch (err) {
        log.warn(
          `videos.list failed — continuing without stats: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
      const statsById = new Map<string, YouTubeVideoStatsItem>();
      for (const s of stats) {
        if (s.id) statsById.set(s.id, s);
      }

      // 6. Quality gate → enriched
      const enriched: EnrichedVideo[] = [];
      for (const [videoId, hit] of hitsByVideoId) {
        const s = statsById.get(videoId);
        const viewCount = s?.statistics?.viewCount ? parseInt(s.statistics.viewCount, 10) : null;
        const likeCount = s?.statistics?.likeCount ? parseInt(s.statistics.likeCount, 10) : null;
        const durationSec = parseIsoDuration(s?.contentDetails?.duration);

        const verdict = classifyQuality({
          title: hit.title,
          viewCount: Number.isFinite(viewCount) ? viewCount : null,
          durationSec,
        });
        if (!verdict.accepted || !verdict.tier) continue;

        enriched.push({
          ...hit,
          viewCount: Number.isFinite(viewCount) ? viewCount : null,
          likeCount: Number.isFinite(likeCount) ? likeCount : null,
          durationSec,
          tier: verdict.tier,
        });
      }
      log.info(`quality gate: ${enriched.length}/${videosFound} accepted`);

      // 7. Embeddings (Qwen3 via Mac Mini Ollama) — optional
      const embedReachable = await isOllamaReachable({ baseUrl: state.ollamaUrl });
      let embeddings: number[][] = [];
      if (embedReachable && enriched.length > 0) {
        try {
          const inputs = enriched.map((v) => buildEmbedText(v));
          embeddings = await embedBatch(inputs, { baseUrl: state.ollamaUrl });
          if (embeddings.length !== enriched.length) {
            log.warn(
              `embed vector count ${embeddings.length} != enriched ${enriched.length} — dropping embedding rows`
            );
            embeddings = [];
          }
        } catch (err) {
          log.warn(
            `embedBatch failed (continuing without embeddings): ${
              err instanceof Error ? err.message : String(err)
            }`
          );
          embeddings = [];
        }
      } else if (!embedReachable) {
        log.warn(`Ollama (${state.ollamaUrl}) unreachable — skipping embedding writes`);
      }

      // 8. Upserts
      const upsertStats = await upsertAll(enriched, embeddings);
      videosNew = upsertStats.videosNew;
      videosUpdated = upsertStats.videosUpdated;

      // 9. Soft-expire old rows
      const expiredResult = await db.$executeRawUnsafe<number>(
        `UPDATE public.video_pool SET is_active = false WHERE is_active = true AND expires_at < now()`
      );
      videosExpired = typeof expiredResult === 'number' ? expiredResult : 0;

      // 10. Finalize
      const finalStatus = quotaExhausted ? 'partial' : 'success';
      await finalizeRun(db, run.id, {
        status: finalStatus,
        error: quotaExhausted ? 'YouTube quota exhausted mid-run' : null,
        queriesExecuted,
        videosFound,
        videosNew,
        videosUpdated,
        videosExpired,
        quotaUsed,
      });

      return {
        status: finalStatus === 'partial' ? 'partial' : 'success',
        data: {
          queries_executed: queriesExecuted,
          videos_found: videosFound,
          videos_accepted: enriched.length,
          videos_new: videosNew,
          videos_updated: videosUpdated,
          videos_expired: videosExpired,
          embeddings_written: embeddings.length,
          quota_used: quotaUsed,
          quota_exhausted: quotaExhausted,
        },
        metrics: {
          duration_ms: Date.now() - t0,
          rows_written: {
            video_pool: upsertStats.videosNew + upsertStats.videosUpdated,
            video_pool_embeddings: embeddings.length,
            video_pool_domain_tags: upsertStats.domainTagsWritten,
            video_pool_collection_runs: 1,
          },
        },
        error: quotaExhausted ? 'YouTube quota exhausted mid-run' : undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`batch-video-collector failed: ${msg}`);
      await finalizeRun(db, run.id, {
        status: 'failed',
        error: msg,
        queriesExecuted: 0,
        videosFound,
        videosNew,
        videosUpdated,
        videosExpired,
        quotaUsed,
      });
      return {
        status: 'failed',
        data: { reason: 'exception', message: msg },
        error: msg,
        metrics: { duration_ms: Date.now() - t0 },
      };
    }
  },
};

// ============================================================================
// Helpers
// ============================================================================

function normalizeLimit(raw: unknown): number {
  const parsed = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return BATCH_COLLECTOR_DAILY_KEYWORD_LIMIT;
  return Math.min(parsed, 500);
}

function buildEmbedText(v: EnrichedVideo): string {
  const desc = (v.description ?? '').slice(0, DESC_SNIPPET_LEN);
  return desc ? `${v.title}\n${desc}` : v.title;
}

async function searchAllKeywords(
  keywords: TrendKeyword[],
  apiKey: string,
  hitsByVideoId: Map<string, SearchHit>,
  onQuotaUsed: (units: number) => void,
  onQuotaExhausted: () => void
): Promise<number> {
  let executed = 0;
  // Bounded parallelism — chunk the keyword list and await each chunk.
  for (let i = 0; i < keywords.length; i += BATCH_COLLECTOR_SEARCH_PARALLELISM) {
    const chunk = keywords.slice(i, i + BATCH_COLLECTOR_SEARCH_PARALLELISM);
    const results = await Promise.all(
      chunk.map(async (kw) => {
        try {
          const items = await searchVideos({
            query: kw.keyword,
            apiKey,
            maxResults: BATCH_COLLECTOR_SEARCH_MAX_RESULTS,
            relevanceLanguage: kw.language || 'ko',
            regionCode: (kw.language || 'ko') === 'en' ? 'US' : 'KR',
          });
          onQuotaUsed(100); // search.list cost
          return { kw, items, error: null as string | null };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn(`search.list failed for "${kw.keyword}": ${msg}`);
          if (/quota/i.test(msg) || /403/.test(msg)) onQuotaExhausted();
          return { kw, items: [] as YouTubeSearchItem[], error: msg };
        }
      })
    );

    for (const { kw, items } of results) {
      executed += 1;
      for (const item of items) {
        const id = item.id?.videoId;
        if (!id) continue;
        const existing = hitsByVideoId.get(id);
        if (existing) {
          existing.domains.add(kw.domain);
          continue;
        }
        hitsByVideoId.set(id, {
          videoId: id,
          title: item.snippet?.title ?? '',
          description: item.snippet?.description ?? '',
          channelName: item.snippet?.channelTitle ?? null,
          channelId: item.snippet?.channelId ?? null,
          thumbnail: item.snippet?.thumbnails?.high?.url ?? null,
          publishedAt: item.snippet?.publishedAt ?? null,
          language: kw.language || 'ko',
          domains: new Set([kw.domain]),
        });
      }
    }
  }
  return executed;
}

async function upsertAll(
  enriched: EnrichedVideo[],
  embeddings: number[][]
): Promise<{ videosNew: number; videosUpdated: number; domainTagsWritten: number }> {
  const db = getPrismaClient();
  let videosNew = 0;
  let videosUpdated = 0;
  let domainTagsWritten = 0;

  for (let idx = 0; idx < enriched.length; idx++) {
    const v = enriched[idx]!;
    try {
      // video_pool UPSERT — detect new vs updated via prior lookup
      const prior = await db.video_pool.findUnique({
        where: { video_id: v.videoId },
        select: { video_id: true },
      });
      await db.video_pool.upsert({
        where: { video_id: v.videoId },
        create: {
          video_id: v.videoId,
          title: v.title.slice(0, 5000),
          description: v.description?.slice(0, 5000) ?? null,
          channel_name: v.channelName?.slice(0, 200) ?? null,
          channel_id: v.channelId?.slice(0, 30) ?? null,
          view_count: BigInt(v.viewCount ?? 0),
          like_count: BigInt(v.likeCount ?? 0),
          duration_seconds: v.durationSec,
          published_at: v.publishedAt ? new Date(v.publishedAt) : null,
          thumbnail_url: v.thumbnail,
          language: v.language.slice(0, 5),
          quality_tier: v.tier,
          source: 'batch_trend',
        },
        update: {
          title: v.title.slice(0, 5000),
          description: v.description?.slice(0, 5000) ?? null,
          channel_name: v.channelName?.slice(0, 200) ?? null,
          channel_id: v.channelId?.slice(0, 30) ?? null,
          view_count: BigInt(v.viewCount ?? 0),
          like_count: BigInt(v.likeCount ?? 0),
          duration_seconds: v.durationSec,
          published_at: v.publishedAt ? new Date(v.publishedAt) : null,
          thumbnail_url: v.thumbnail,
          language: v.language.slice(0, 5),
          quality_tier: v.tier,
          refreshed_at: new Date(),
          is_active: true,
        },
      });
      if (prior) videosUpdated += 1;
      else videosNew += 1;

      // CP422 P1: eager enrich for new gold-tier videos (flag-gated).
      //   Skips when RICH_SUMMARY_ENABLED=false OR RICH_SUMMARY_POOL_GOLD_EAGER=false.
      //   Non-fatal — pool upsert must not block on queue enqueue.
      if (!prior && v.tier === 'gold') {
        const rsConfig = loadRichSummaryConfig();
        if (rsConfig.enabled && rsConfig.poolGoldEager) {
          try {
            await enqueueEnrichVideo({
              videoId: v.videoId,
              title: v.title,
              url: `https://www.youtube.com/watch?v=${v.videoId}`,
              source: 'batch',
            });
          } catch (err) {
            log.warn(
              `pool eager enrich enqueue failed for video=${v.videoId}: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      }

      // embedding (optional — only if we have a matching vector)
      const vec = embeddings[idx];
      if (vec && vec.length > 0) {
        await db.$executeRaw(
          Prisma.sql`INSERT INTO public.video_pool_embeddings (video_id, embedding, text_input, model_version)
                     VALUES (${v.videoId}, ${vectorToLiteral(vec)}::vector, ${buildEmbedText(v)}, ${QWEN3_EMBED_MODEL})
                     ON CONFLICT (video_id, model_version) DO NOTHING`
        );
      }

      // domain tags
      for (const domain of v.domains) {
        if (!domain) continue;
        await db.video_pool_domain_tags.upsert({
          where: {
            video_id_domain: { video_id: v.videoId, domain: domain.slice(0, 50) },
          },
          create: {
            video_id: v.videoId,
            domain: domain.slice(0, 50),
            relevance_score: 0.5,
            source: 'batch_trend',
          },
          update: {},
        });
        domainTagsWritten += 1;
      }
    } catch (err) {
      log.warn(
        `upsert failed for video=${v.videoId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return { videosNew, videosUpdated, domainTagsWritten };
}

async function finalizeRun(
  db: ReturnType<typeof getPrismaClient>,
  runId: string,
  stats: {
    status: 'success' | 'partial' | 'failed';
    error: string | null;
    queriesExecuted: number;
    videosFound: number;
    videosNew: number;
    videosUpdated: number;
    videosExpired: number;
    quotaUsed: number;
  }
): Promise<void> {
  await db.video_pool_collection_runs.update({
    where: { id: runId },
    data: {
      ended_at: new Date(),
      status: stats.status,
      error: stats.error ?? null,
      queries_executed: stats.queriesExecuted,
      videos_found: stats.videosFound,
      videos_new: stats.videosNew,
      videos_updated: stats.videosUpdated,
      videos_expired: stats.videosExpired,
      quota_used: stats.quotaUsed,
    },
  });
}
