/**
 * video-discover — executor (Phase 3, #358 / #361)
 *
 * Pipeline:
 *   1. Validate mandalaId and load the user's sub_goal embeddings (8 cells)
 *   2. Verify the user has a fresh YouTube OAuth token (skip if not connected)
 *   3. Load top-N keyword_scores rows with embeddings (Phase 2b cache)
 *   4. For each cell:
 *      a. Compute per_mandala_relevance (cosine sim) for every keyword
 *      b. Pick top KEYWORDS_PER_CELL keyword(s) by per_mandala_relevance × iks_total
 *      c. Call YouTube search.list with the user's OAuth token
 *      d. Compute Rec Score per video (IKS + freshness + diversity + per_mandala_relevance)
 *      e. Pick top RECS_PER_CELL by Rec Score
 *   5. Batch fetch video statistics via videos.list (1 quota unit, all video IDs)
 *   6. Upsert all recommendations to recommendation_cache
 *
 * Quota cost (per execute()):
 *   8 cells × 1 search.list (100 units) + 1 videos.list (1 unit) = 801 units
 *   against the USER's quota (OAuth Bearer), NOT Insighta's API key.
 */

import type {
  SkillExecutor,
  PreflightContext,
  PreflightResult,
  ExecuteContext,
  ExecuteResult,
} from '@/skills/_shared/types';
import { getPrismaClient } from '@/modules/database';
import { Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';
import {
  manifest,
  VIDEO_DISCOVER_RECS_PER_CELL,
  VIDEO_DISCOVER_KEYWORDS_PER_CELL,
  VIDEO_DISCOVER_SEARCH_RESULTS_PER_CELL,
  VIDEO_DISCOVER_TTL_DAYS,
  VIDEO_DISCOVER_KEYWORD_POOL_SIZE,
} from './manifest';

const log = logger.child({ module: 'video-discover' });
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

// Rec Score weights (design doc §5)
const REC_WEIGHT_IKS = 0.35;
const REC_WEIGHT_VIDEO_QUALITY = 0.25;
const REC_WEIGHT_FRESHNESS = 0.2;
const REC_WEIGHT_DIVERSITY = 0.1;
const REC_WEIGHT_HISTORICAL = 0.1; // 0.5 placeholder until Layer 4 ships

/** Days after which freshness drops to 0. */
const FRESHNESS_HORIZON_DAYS = 90;

interface SubGoalCell {
  cellIndex: number;
  text: string;
  embedding: number[];
}

interface KeywordRow {
  keyword: string;
  iksTotal: number; // 0-100
  embedding: number[];
  domain: string | null;
}

interface HydratedState {
  mandalaId: string;
  userId: string;
  oauthToken: string;
  subGoals: SubGoalCell[];
  keywords: KeywordRow[];
  fetchImpl?: typeof fetch;
}

interface YouTubeSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    channelId?: string;
    publishedAt?: string;
    thumbnails?: { high?: { url?: string } };
  };
}

interface YouTubeSearchResponse {
  items?: YouTubeSearchItem[];
  error?: { code: number; message: string };
}

interface YouTubeVideoStatsItem {
  id?: string;
  statistics?: {
    viewCount?: string;
    likeCount?: string;
  };
  contentDetails?: { duration?: string };
}

interface YouTubeVideosResponse {
  items?: YouTubeVideoStatsItem[];
  error?: { code: number; message: string };
}

interface RecommendationCandidate {
  cellIndex: number;
  keyword: string;
  iksTotal: number;
  perMandalaRelevance: number;
  videoId: string;
  title: string;
  channel: string;
  channelId: string;
  publishedAt: string;
  thumbnail: string;
  // Filled in after batch videos.list
  viewCount: number | null;
  likeCount: number | null;
  // Computed Rec Score components
  recScore?: number;
  videoQuality?: number;
  freshness?: number;
}

export const executor: SkillExecutor = {
  manifest,

  async preflight(ctx: PreflightContext): Promise<PreflightResult> {
    const mandalaId = ctx.mandalaId;
    if (!mandalaId) {
      return { ok: false, reason: 'mandala_id is required' };
    }
    if (!ctx.userId) {
      return { ok: false, reason: 'userId is required' };
    }

    const db = getPrismaClient();

    // 1. Verify mandala exists and belongs to the user
    const mandala = await db.user_mandalas.findFirst({
      where: { id: mandalaId, user_id: ctx.userId },
      select: { id: true },
    });
    if (!mandala) {
      return { ok: false, reason: `Mandala ${mandalaId} not found or not owned by user` };
    }

    // 2. Verify YouTube OAuth token (skip if not connected — preflight FAIL)
    const oauth = await db.youtube_sync_settings.findUnique({
      where: { user_id: ctx.userId },
      select: {
        youtube_access_token: true,
        youtube_token_expires_at: true,
      },
    });
    if (!oauth?.youtube_access_token) {
      return {
        ok: false,
        reason:
          'YouTube account not connected. Please connect YouTube to enable video recommendations.',
      };
    }
    if (oauth.youtube_token_expires_at && new Date(oauth.youtube_token_expires_at) < new Date()) {
      return {
        ok: false,
        reason: 'YouTube OAuth token expired. Please reconnect YouTube.',
      };
    }

    // 3. Load 8 sub_goal embeddings for this mandala (level=1, 4096d)
    const subGoalRows = await db.$queryRaw<
      { sub_goal_index: number; sub_goal: string | null; text: string | null; embedding: string }[]
    >(
      Prisma.sql`SELECT sub_goal_index, sub_goal, text, embedding::text AS embedding
                 FROM mandala_embeddings
                 WHERE mandala_id = ${mandalaId} AND level = 1 AND embedding IS NOT NULL
                 ORDER BY sub_goal_index NULLS LAST`
    );
    if (subGoalRows.length === 0) {
      return {
        ok: false,
        reason: `Mandala ${mandalaId} has no level=1 sub_goal embeddings yet. Generate the mandala first.`,
      };
    }

    const subGoals: SubGoalCell[] = subGoalRows
      .map((row, idx) => {
        const text = row.sub_goal ?? row.text ?? '';
        const embedding = parseVectorLiteral(row.embedding);
        if (embedding.length === 0) return null;
        return {
          cellIndex: row.sub_goal_index ?? idx,
          text,
          embedding,
        };
      })
      .filter((s): s is SubGoalCell => s !== null);

    if (subGoals.length === 0) {
      return { ok: false, reason: 'All mandala sub_goal embeddings parsed as empty' };
    }

    // 4. Load top-N keyword_scores with embeddings
    const keywordRows = await db.$queryRaw<
      { keyword: string; iks_total: number; domain: string | null; embedding: string }[]
    >(
      Prisma.sql`SELECT keyword, iks_total, domain, embedding::text AS embedding
                 FROM keyword_scores
                 WHERE embedding IS NOT NULL
                 ORDER BY iks_total DESC
                 LIMIT ${VIDEO_DISCOVER_KEYWORD_POOL_SIZE}`
    );
    if (keywordRows.length === 0) {
      return {
        ok: false,
        reason: 'No keyword_scores rows with embeddings. Run trend-collector + iks-scorer first.',
      };
    }

    const keywords: KeywordRow[] = keywordRows
      .map((row) => {
        const embedding = parseVectorLiteral(row.embedding);
        if (embedding.length === 0) return null;
        return {
          keyword: row.keyword,
          iksTotal: row.iks_total,
          embedding,
          domain: row.domain,
        };
      })
      .filter((k): k is KeywordRow => k !== null);

    const hydrated: HydratedState = {
      mandalaId,
      userId: ctx.userId,
      oauthToken: oauth.youtube_access_token,
      subGoals,
      keywords,
    };
    return { ok: true, hydrated: hydrated as unknown as Record<string, unknown> };
  },

  async execute(ctx: ExecuteContext): Promise<ExecuteResult> {
    const t0 = Date.now();
    const state = ctx.state as unknown as HydratedState;
    const fetchFn = state.fetchImpl ?? fetch;
    const db = getPrismaClient();

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + VIDEO_DISCOVER_TTL_DAYS * MS_PER_DAY);

    // ── Step 1: For each cell, pick top keyword(s) by per_mandala_relevance ─
    const cellSelections: {
      cell: SubGoalCell;
      keyword: KeywordRow;
      perMandalaRelevance: number;
    }[] = [];
    for (const cell of state.subGoals) {
      const scored = state.keywords
        .map((kw) => {
          const cos = dot(cell.embedding, kw.embedding);
          // Combine cosine sim (per_mandala) with global IKS to break ties
          const combined = cos * 0.7 + (kw.iksTotal / 100) * 0.3;
          return { kw, cos, combined };
        })
        .sort((a, b) => b.combined - a.combined);
      const top = scored.slice(0, VIDEO_DISCOVER_KEYWORDS_PER_CELL);
      for (const t of top) {
        cellSelections.push({ cell, keyword: t.kw, perMandalaRelevance: t.cos });
      }
    }

    log.info(`Selected ${cellSelections.length} (cell × keyword) pairs to search`);

    // ── Step 2: YouTube search.list per cell × keyword (user OAuth) ────
    const allCandidates: RecommendationCandidate[] = [];
    let searchCalls = 0;
    let searchFailures = 0;
    for (const sel of cellSelections) {
      try {
        const items = await youtubeSearch({
          query: `${sel.cell.text} ${sel.keyword.keyword}`,
          oauthToken: state.oauthToken,
          maxResults: VIDEO_DISCOVER_SEARCH_RESULTS_PER_CELL,
          fetchFn,
        });
        searchCalls += 1;
        for (const item of items) {
          const videoId = item.id?.videoId;
          if (!videoId) continue;
          allCandidates.push({
            cellIndex: sel.cell.cellIndex,
            keyword: sel.keyword.keyword,
            iksTotal: sel.keyword.iksTotal,
            perMandalaRelevance: sel.perMandalaRelevance,
            videoId,
            title: item.snippet?.title ?? '(untitled)',
            channel: item.snippet?.channelTitle ?? '',
            channelId: item.snippet?.channelId ?? '',
            publishedAt: item.snippet?.publishedAt ?? new Date().toISOString(),
            thumbnail: item.snippet?.thumbnails?.high?.url ?? '',
            viewCount: null,
            likeCount: null,
          });
        }
      } catch (err) {
        searchFailures += 1;
        log.warn(
          `YouTube search failed for cell ${sel.cell.cellIndex} kw="${sel.keyword.keyword}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    if (allCandidates.length === 0) {
      return {
        status: 'failed',
        data: {
          search_calls: searchCalls,
          search_failures: searchFailures,
          candidates: 0,
        },
        error: 'YouTube search returned 0 candidate videos',
        metrics: { duration_ms: Date.now() - t0 },
      };
    }

    // ── Step 3: Batch videos.list to fetch view + like counts (1 quota unit) ─
    const uniqueVideoIds = Array.from(new Set(allCandidates.map((c) => c.videoId)));
    try {
      const stats = await youtubeVideosBatch({
        videoIds: uniqueVideoIds,
        oauthToken: state.oauthToken,
        fetchFn,
      });
      const statsById = new Map(stats.map((s) => [s.id ?? '', s]));
      for (const cand of allCandidates) {
        const stat = statsById.get(cand.videoId);
        if (stat?.statistics) {
          cand.viewCount = parseInt(stat.statistics.viewCount ?? '0', 10) || 0;
          cand.likeCount = stat.statistics.likeCount
            ? parseInt(stat.statistics.likeCount, 10) || 0
            : null;
        }
      }
    } catch (err) {
      log.warn(
        `videos.list batch failed (continuing without stats): ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // ── Step 4: Compute Rec Score + pick top RECS_PER_CELL per cell ────
    const now = Date.now();
    for (const cand of allCandidates) {
      cand.videoQuality = computeVideoQuality(cand);
      cand.freshness = computeFreshness(cand.publishedAt, now);
      cand.recScore = computeRecScore(cand);
    }

    const byCell = new Map<number, RecommendationCandidate[]>();
    for (const cand of allCandidates) {
      const arr = byCell.get(cand.cellIndex);
      if (arr) arr.push(cand);
      else byCell.set(cand.cellIndex, [cand]);
    }

    const finalRecommendations: RecommendationCandidate[] = [];
    for (const [, cands] of byCell) {
      cands.sort((a, b) => (b.recScore ?? 0) - (a.recScore ?? 0));
      // Apply diversity: drop duplicate channels within the same cell
      const seenChannels = new Set<string>();
      const cellTop: RecommendationCandidate[] = [];
      for (const c of cands) {
        if (cellTop.length >= VIDEO_DISCOVER_RECS_PER_CELL) break;
        if (seenChannels.has(c.channelId)) continue;
        seenChannels.add(c.channelId);
        cellTop.push(c);
      }
      finalRecommendations.push(...cellTop);
    }

    // ── Step 5: Upsert to recommendation_cache ─────────────────────────
    let upserted = 0;
    let upsertErrors = 0;
    for (const rec of finalRecommendations) {
      try {
        await db.recommendation_cache.upsert({
          where: {
            user_id_mandala_id_video_id: {
              user_id: state.userId,
              mandala_id: state.mandalaId,
              video_id: rec.videoId,
            },
          },
          create: {
            user_id: state.userId,
            mandala_id: state.mandalaId,
            cell_index: rec.cellIndex,
            keyword: rec.keyword,
            domain: null,
            video_id: rec.videoId,
            title: rec.title,
            thumbnail: rec.thumbnail || null,
            channel: rec.channel || null,
            channel_subs: null,
            view_count: rec.viewCount,
            like_ratio:
              rec.viewCount && rec.viewCount > 0 && rec.likeCount !== null
                ? rec.likeCount / rec.viewCount
                : null,
            duration_sec: null,
            rec_score: rec.recScore ?? 0,
            iks_score: rec.iksTotal,
            trend_keywords: [
              {
                keyword: rec.keyword,
                iks_total: rec.iksTotal,
                per_mandala_relevance: rec.perMandalaRelevance,
              },
            ] as Prisma.InputJsonValue,
            rec_reason: buildRecReason(rec),
            status: 'pending',
            weight_version: 1,
            expires_at: expiresAt,
          },
          update: {
            cell_index: rec.cellIndex,
            keyword: rec.keyword,
            title: rec.title,
            thumbnail: rec.thumbnail || null,
            channel: rec.channel || null,
            view_count: rec.viewCount,
            like_ratio:
              rec.viewCount && rec.viewCount > 0 && rec.likeCount !== null
                ? rec.likeCount / rec.viewCount
                : null,
            rec_score: rec.recScore ?? 0,
            iks_score: rec.iksTotal,
            trend_keywords: [
              {
                keyword: rec.keyword,
                iks_total: rec.iksTotal,
                per_mandala_relevance: rec.perMandalaRelevance,
              },
            ] as Prisma.InputJsonValue,
            rec_reason: buildRecReason(rec),
            expires_at: expiresAt,
          },
        });
        upserted += 1;
      } catch (err) {
        upsertErrors += 1;
        log.warn(
          `recommendation_cache upsert failed for video ${rec.videoId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const status: ExecuteResult['status'] =
      upsertErrors === 0 && upserted > 0 ? 'success' : upserted > 0 ? 'partial' : 'failed';

    return {
      status,
      data: {
        cells: state.subGoals.length,
        keyword_pool_size: state.keywords.length,
        cell_keyword_pairs: cellSelections.length,
        search_calls: searchCalls,
        search_failures: searchFailures,
        candidates_total: allCandidates.length,
        candidates_unique_videos: uniqueVideoIds.length,
        recommendations_upserted: upserted,
        upsert_errors: upsertErrors,
        sample_recs: finalRecommendations.slice(0, 5).map((r) => ({
          cell: r.cellIndex,
          keyword: r.keyword,
          title: r.title,
          rec_score: Math.round((r.recScore ?? 0) * 1000) / 1000,
          per_mandala_relevance: Math.round(r.perMandalaRelevance * 1000) / 1000,
        })),
      },
      metrics: {
        duration_ms: Date.now() - t0,
        rows_written: { recommendation_cache: upserted },
      },
    };
  },
};

// ============================================================================
// YouTube API helpers (user OAuth Bearer)
// ============================================================================

interface YouTubeSearchOpts {
  query: string;
  oauthToken: string;
  maxResults: number;
  fetchFn: typeof fetch;
}

async function youtubeSearch(opts: YouTubeSearchOpts): Promise<YouTubeSearchItem[]> {
  const url = new URL(`${YOUTUBE_API_BASE}/search`);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('q', opts.query);
  url.searchParams.set('maxResults', String(opts.maxResults));
  url.searchParams.set('relevanceLanguage', 'ko');
  url.searchParams.set('regionCode', 'KR');
  url.searchParams.set('safeSearch', 'moderate');

  const res = await opts.fetchFn(url.toString(), {
    headers: { Authorization: `Bearer ${opts.oauthToken}` },
  });
  if (!res.ok) {
    let msg = '';
    try {
      const body = (await res.json()) as YouTubeSearchResponse;
      msg = body.error?.message ?? '';
    } catch {
      // ignore
    }
    throw new Error(`search.list HTTP ${res.status}${msg ? ` — ${msg}` : ''}`);
  }
  const body = (await res.json()) as YouTubeSearchResponse;
  if (body.error) throw new Error(`search.list error: ${body.error.message}`);
  return body.items ?? [];
}

interface YouTubeVideosBatchOpts {
  videoIds: string[];
  oauthToken: string;
  fetchFn: typeof fetch;
}

async function youtubeVideosBatch(opts: YouTubeVideosBatchOpts): Promise<YouTubeVideoStatsItem[]> {
  if (opts.videoIds.length === 0) return [];
  const url = new URL(`${YOUTUBE_API_BASE}/videos`);
  url.searchParams.set('part', 'statistics,contentDetails');
  url.searchParams.set('id', opts.videoIds.join(','));
  url.searchParams.set('maxResults', String(opts.videoIds.length));

  const res = await opts.fetchFn(url.toString(), {
    headers: { Authorization: `Bearer ${opts.oauthToken}` },
  });
  if (!res.ok) throw new Error(`videos.list HTTP ${res.status}`);
  const body = (await res.json()) as YouTubeVideosResponse;
  if (body.error) throw new Error(`videos.list error: ${body.error.message}`);
  return body.items ?? [];
}

// ============================================================================
// Rec Score components
// ============================================================================

function computeVideoQuality(cand: RecommendationCandidate): number {
  // Without videos.list: defaults to 0.5 neutral.
  // With stats: use like_ratio with 4% anchor, same as iks-scorer/scoring.ts.
  if (cand.viewCount === null || cand.viewCount === 0 || cand.likeCount === null) {
    return 0.5;
  }
  const ratio = cand.likeCount / cand.viewCount;
  const LIKE_RATIO_TOP = 0.08;
  const v = ratio / LIKE_RATIO_TOP;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function computeFreshness(publishedAt: string, nowMs: number): number {
  const publishedMs = Date.parse(publishedAt);
  if (Number.isNaN(publishedMs)) return 0.5;
  const ageDays = (nowMs - publishedMs) / MS_PER_DAY;
  if (ageDays < 0) return 1.0;
  if (ageDays > FRESHNESS_HORIZON_DAYS) return 0.0;
  return 1 - ageDays / FRESHNESS_HORIZON_DAYS;
}

function computeRecScore(cand: RecommendationCandidate): number {
  const iksNorm = cand.iksTotal / 100;
  return (
    iksNorm * REC_WEIGHT_IKS +
    (cand.videoQuality ?? 0.5) * REC_WEIGHT_VIDEO_QUALITY +
    (cand.freshness ?? 0.5) * REC_WEIGHT_FRESHNESS +
    0.5 * REC_WEIGHT_DIVERSITY + // diversity is enforced by per-channel dedup, not the score
    0.5 * REC_WEIGHT_HISTORICAL // Layer 4 placeholder
  );
}

function buildRecReason(cand: RecommendationCandidate): string {
  const rel = Math.round(cand.perMandalaRelevance * 100);
  return `Matches your goal "${cand.keyword}" (relevance ${rel}%, IKS ${Math.round(cand.iksTotal)})`;
}

// ============================================================================
// Math helpers (duplicated from iks-scorer per plugin §6 cross-import rule)
// ============================================================================

function dot(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
}

function parseVectorLiteral(literal: string): number[] {
  if (!literal || literal.length < 2) return [];
  const inner = literal.startsWith('[') && literal.endsWith(']') ? literal.slice(1, -1) : literal;
  const parts = inner.split(',');
  const out = new Array<number>(parts.length);
  for (let i = 0; i < parts.length; i++) {
    out[i] = parseFloat(parts[i] ?? '0');
  }
  return out;
}
