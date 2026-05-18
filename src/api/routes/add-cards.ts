/**
 * Add Cards Routes (CP466 Phase 2)
 *
 * `POST /api/v1/mandalas/:mandalaId/add-cards`
 *
 * Slide-in panel candidate fetcher. Returns up to N (default 40) video
 * candidates the user can Pick into their mandala, with:
 *   - Layer 1 Coverage: Tier 1 video_pool_embeddings cosine vs centerGoal
 *   - Layer 4 Feedback bias multiplier (channel match, drift-guarded)
 *   - Echo-chamber caps (channel ≤ N, sub_goal ≤ N)
 *   - Exclude lists: own user_local_cards + own user_video_states (this
 *     mandala) + card_interactions(signal='delete', global) +
 *     card_interactions(signal='archive', this mandala) + request body
 *     excludeVideoIds.
 *
 * Spec: docs/design/add-cards-2026-05-18.md §5.
 * Decisions: CP466 C1~C11 (single source of truth in spec doc).
 *
 * Hard Rule compliance:
 *   - 하드코딩 금지 — every knob via `getAddCardsConfig()` (zod schema +
 *     env override).
 *   - 추측 전 소스 읽기 — every helper signature read before use:
 *     `matchFromVideoPoolByCenterGoal`, `embedBatch`,
 *     `getMandalaManager().getMandalaById`, `card_interactions` Prisma
 *     model. See `src/skills/plugins/video-discover/v3/cache-matcher.ts`,
 *     `src/skills/plugins/iks-scorer/embedding.ts`,
 *     `src/modules/mandala/manager.ts`,
 *     `prisma/migrations/card-interactions/001_create_table.sql`.
 */

import { FastifyPluginCallback } from 'fastify';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
import { getMandalaManager } from '@/modules/mandala/manager';
import { embedBatch } from '@/skills/plugins/iks-scorer/embedding';
import {
  matchFromVideoPoolByCenterGoal,
  type CachedMatch,
} from '@/skills/plugins/video-discover/v3/cache-matcher';
import { getAddCardsConfig } from '@/config/add-cards';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const MAX_EXTRA_KEYWORDS = 10;
const MAX_EXCLUDE_IDS = 500;
const MAX_KEYWORD_LEN = 200;
const MS_PER_DAY = 86_400_000;

const log = logger.child({ module: 'add-cards-routes' });

type DurationBucket = 'short' | 'medium' | 'long' | 'xlong';

interface AddCardsFilters {
  minViewCount?: number;
  durationBucket?: DurationBucket;
  publishedAfter?: string; // ISO date
}

interface AddCardsBody {
  extraKeywords?: string[];
  excludeVideoIds?: string[];
  filters?: AddCardsFilters;
}

// CP466 amendment — durationBucket bounds in seconds.
const DURATION_BUCKETS: Record<DurationBucket, { min: number; max: number }> = {
  short: { min: 0, max: 600 },
  medium: { min: 600, max: 1800 },
  long: { min: 1800, max: 3600 },
  xlong: { min: 3600, max: Number.POSITIVE_INFINITY },
};

interface AddCardCandidate {
  videoId: string;
  title: string;
  channel: string | null;
  thumbnail: string | null;
  durationSec: number | null;
  viewCount: number | null;
  publishedAt: string | null;
  score: number;
  cellIndex: number;
  source: 'video_pool';
}

interface AddCardsTrace {
  layer1_count: number;
  after_exclude: number;
  layer4_boost_applied: number;
  caps_enforced: { channel: number; subgoal: number };
  drift_guard_fired: boolean;
  duration_ms: number;
}

export const addCardsRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{
    Params: { mandalaId: string };
    Body: AddCardsBody;
    Querystring: { trace?: string };
  }>('/:mandalaId/add-cards', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || !('userId' in request.user)) {
      return reply
        .code(401)
        .send({ status: 'error', code: 'UNAUTHORIZED', message: 'Unauthorized' });
    }
    const userId = request.user.userId;
    const { mandalaId } = request.params;
    const body = request.body ?? {};
    const wantTrace = request.query?.trace === '1';

    if (!UUID_RE.test(mandalaId)) {
      return reply.code(400).send({
        status: 'error',
        code: 'INVALID_MANDALA_ID',
        message: 'mandalaId must be a uuid',
      });
    }

    const extraKeywords = Array.isArray(body.extraKeywords)
      ? body.extraKeywords
          .filter((s): s is string => typeof s === 'string')
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s.length <= MAX_KEYWORD_LEN)
          .slice(0, MAX_EXTRA_KEYWORDS)
      : [];
    const excludeVideoIds = Array.isArray(body.excludeVideoIds)
      ? body.excludeVideoIds
          .filter((s): s is string => typeof s === 'string' && YOUTUBE_VIDEO_ID_RE.test(s))
          .slice(0, MAX_EXCLUDE_IDS)
      : [];

    // CP466 amendment — request filters (post-filter, in-memory).
    const rawFilters = body.filters ?? {};
    const filters: AddCardsFilters = {};
    if (
      typeof rawFilters.minViewCount === 'number' &&
      Number.isFinite(rawFilters.minViewCount) &&
      rawFilters.minViewCount > 0
    ) {
      filters.minViewCount = rawFilters.minViewCount;
    }
    if (
      rawFilters.durationBucket === 'short' ||
      rawFilters.durationBucket === 'medium' ||
      rawFilters.durationBucket === 'long' ||
      rawFilters.durationBucket === 'xlong'
    ) {
      filters.durationBucket = rawFilters.durationBucket;
    }
    if (typeof rawFilters.publishedAfter === 'string') {
      const parsed = Date.parse(rawFilters.publishedAfter);
      if (Number.isFinite(parsed)) {
        filters.publishedAfter = new Date(parsed).toISOString();
      }
    }

    const cfg = getAddCardsConfig();
    const prisma = getPrismaClient();
    const t0 = Date.now();

    try {
      // 1. resolve mandala — ownership check inside getMandalaById
      const mandala = await getMandalaManager().getMandalaById(userId, mandalaId);
      if (!mandala) {
        return reply.code(404).send({
          status: 'error',
          code: 'MANDALA_NOT_FOUND',
          message: `Mandala ${mandalaId} not found for this user`,
        });
      }
      const root = mandala.levels.find((l) => l.depth === 0);
      if (!root) {
        return reply.code(500).send({
          status: 'error',
          code: 'MANDALA_ROOT_MISSING',
          message: 'Mandala has no depth=0 level',
        });
      }
      const centerGoal = root.centerGoal;
      const subGoals = root.subjects.slice(0, 8);
      // CP466 amendment 2 — pull wizard metadata (focus_tags +
      // target_level + language + title) so the response exposes them
      // to the FE. Per user directive 2026-05-18: title is the locked
      // base (immutable, already rendered via center_goal); focus_tags
      // + target_level are EDITABLE on the FE — sent up as chips in
      // the request `extraKeywords` rather than auto-injected server-
      // side. This endpoint just surfaces them in the response so the
      // FE can prepopulate the panel state.
      const mandalaMeta = await prisma.user_mandalas.findUnique({
        where: { id: mandalaId },
        select: { focus_tags: true, target_level: true, language: true, title: true },
      });
      const language: 'ko' | 'en' = mandalaMeta?.language === 'en' ? 'en' : 'ko';

      // 2. embed center_goal + extraKeywords (1 batch, chunk-fail-safe).
      const embedTexts = [centerGoal, ...extraKeywords];
      const embeddings = await embedBatch(embedTexts);
      const centerEmbedding = embeddings[0];
      if (!centerEmbedding) {
        return reply.code(503).send({
          status: 'error',
          code: 'EMBED_UNAVAILABLE',
          message: 'Embedding service unavailable for center_goal',
        });
      }

      // 3. Tier 1 candidates from video_pool by centerGoal cosine
      const candidates = await matchFromVideoPoolByCenterGoal({
        centerEmbedding,
        language,
        subGoals,
        limit: cfg.tier1KnnLimit,
        threshold: cfg.semanticThreshold,
      });

      // 4. resolve exclude set in parallel
      const excludeSet = await resolveExcludeSet({
        prisma,
        userId,
        mandalaId,
        requestExcludeIds: excludeVideoIds,
      });

      // 5. filter candidates by exclude set + request filters (CP466
      //    amendment — post-filter in-memory: minViewCount + durationBucket
      //    + publishedAfter). NULL fields fall through (kept).
      const publishedAfterTs = filters.publishedAfter ? Date.parse(filters.publishedAfter) : null;
      const durationRange = filters.durationBucket
        ? DURATION_BUCKETS[filters.durationBucket]
        : null;
      const minViews = filters.minViewCount ?? null;
      const filtered = candidates.filter((c) => {
        if (excludeSet.has(c.videoId)) return false;
        if (minViews != null && c.viewCount != null && c.viewCount < minViews) return false;
        if (
          durationRange &&
          c.durationSec != null &&
          (c.durationSec < durationRange.min || c.durationSec >= durationRange.max)
        ) {
          return false;
        }
        if (publishedAfterTs != null && c.publishedAt) {
          const ts =
            c.publishedAt instanceof Date
              ? c.publishedAt.getTime()
              : Date.parse(String(c.publishedAt));
          if (Number.isFinite(ts) && ts < publishedAfterTs) return false;
        }
        return true;
      });

      // 6. Layer 4 feedback bias (channel match + drift guard).
      //    candidate-level embedding cosine boost (alphaEmbed) deferred —
      //    cache-matcher does not expose per-candidate raw embeddings.
      //    Reserved for a follow-up PR per spec §8 v2+ ("alphaEmbed
      //    candidate cosine — when cache-matcher exposes raw embeddings").
      const feedback = await applyFeedbackBias({
        prisma,
        userId,
        centerEmbedding,
        candidates: filtered,
        cfg,
      });

      // 7. caps + final sort
      const result = applyCapsAndSort(feedback.boostedCandidates, cfg);

      const cards: AddCardCandidate[] = result.accepted.map((c) => ({
        videoId: c.videoId,
        title: c.title,
        channel: c.channelName,
        thumbnail: c.thumbnail,
        durationSec: c.durationSec,
        viewCount: c.viewCount,
        publishedAt: c.publishedAt?.toISOString() ?? null,
        score: c.score,
        cellIndex: c.cellIndex,
        source: 'video_pool',
      }));

      const trace: AddCardsTrace | undefined = wantTrace
        ? {
            layer1_count: candidates.length,
            after_exclude: filtered.length,
            layer4_boost_applied: feedback.boostedCount,
            caps_enforced: { channel: result.capsChannel, subgoal: result.capsSubgoal },
            drift_guard_fired: feedback.driftGuardFired,
            duration_ms: Date.now() - t0,
          }
        : undefined;

      // CP466 amendment 2 — surface wizard meta so the FE panel can
      // prepopulate editable chips (focus_tags) + level selector
      // (target_level) on first open. title is informational (locked
      // base already shown via center_goal).
      const mandalaMetaOut = {
        title: mandalaMeta?.title ?? '',
        focusTags: mandalaMeta?.focus_tags ?? [],
        targetLevel: mandalaMeta?.target_level ?? 'standard',
        language,
      };

      const payload = trace
        ? { cards, mandalaMeta: mandalaMetaOut, trace }
        : { cards, mandalaMeta: mandalaMetaOut };

      return reply.code(200).send({ status: 'ok', data: payload });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`add-cards failed: mandalaId=${mandalaId} userId=${userId} err=${msg}`);
      return reply.code(500).send({
        status: 'error',
        code: 'ADD_CARDS_FAILED',
        message: msg.slice(0, 200),
      });
    }
  });

  done();
};

// ── Helpers ──────────────────────────────────────────────────

interface ResolveExcludeSetOpts {
  prisma: ReturnType<typeof getPrismaClient>;
  userId: string;
  mandalaId: string;
  requestExcludeIds: string[];
}

async function resolveExcludeSet(opts: ResolveExcludeSetOpts): Promise<Set<string>> {
  const { prisma, userId, mandalaId, requestExcludeIds } = opts;
  const [ownLocal, ownStates, deleteSignals, archiveSignals] = await Promise.all([
    prisma.user_local_cards.findMany({
      where: { user_id: userId },
      select: { video_id: true },
    }),
    prisma.$queryRaw<Array<{ youtube_video_id: string }>>(Prisma.sql`
      SELECT yv.youtube_video_id
        FROM public.user_video_states uvs
        JOIN public.youtube_videos yv ON yv.id = uvs.video_id
       WHERE uvs.user_id = ${userId}::uuid
         AND uvs.mandala_id = ${mandalaId}::uuid
    `),
    prisma.card_interactions.findMany({
      where: { user_id: userId, signal: 'delete' },
      select: { video_id: true },
    }),
    prisma.card_interactions.findMany({
      where: { user_id: userId, signal: 'archive', mandala_id: mandalaId },
      select: { video_id: true },
    }),
  ]);
  const excludeSet = new Set<string>();
  for (const id of requestExcludeIds) excludeSet.add(id);
  for (const r of ownLocal) if (r.video_id) excludeSet.add(r.video_id);
  for (const r of ownStates) excludeSet.add(r.youtube_video_id);
  for (const r of deleteSignals) excludeSet.add(r.video_id);
  for (const r of archiveSignals) excludeSet.add(r.video_id);
  return excludeSet;
}

interface ApplyFeedbackBiasOpts {
  prisma: ReturnType<typeof getPrismaClient>;
  userId: string;
  centerEmbedding: number[];
  candidates: CachedMatch[];
  cfg: ReturnType<typeof getAddCardsConfig>;
}

interface FeedbackBiasResult {
  boostedCandidates: CachedMatch[];
  boostedCount: number;
  driftGuardFired: boolean;
}

async function applyFeedbackBias(opts: ApplyFeedbackBiasOpts): Promise<FeedbackBiasResult> {
  const { prisma, userId, centerEmbedding, candidates, cfg } = opts;
  const likedRows = await prisma.card_interactions.findMany({
    where: { user_id: userId, signal: 'like' },
    select: { video_id: true, created_at: true },
    orderBy: { created_at: 'desc' },
    take: cfg.likedHistoryLimit,
  });
  if (likedRows.length === 0) {
    return { boostedCandidates: candidates, boostedCount: 0, driftGuardFired: false };
  }

  const likedVideoIds = likedRows.map((r) => r.video_id);
  // Liked-video embeddings + channel ids from video_pool (best-effort —
  // a like on a video NOT in video_pool contributes 0 to the centroid /
  // channel set).
  const [likedEmbedRows, likedChannelRows] = await Promise.all([
    prisma.$queryRaw<Array<{ video_id: string; embedding: string }>>(Prisma.sql`
      SELECT video_id, embedding::text AS embedding
        FROM public.video_pool_embeddings
       WHERE video_id = ANY(${likedVideoIds}::text[])
    `),
    prisma.$queryRaw<Array<{ channel_id: string | null }>>(Prisma.sql`
      SELECT DISTINCT channel_id
        FROM public.video_pool
       WHERE video_id = ANY(${likedVideoIds}::text[])
         AND channel_id IS NOT NULL
    `),
  ]);
  const likedChannels = new Set<string>();
  for (const r of likedChannelRows) if (r.channel_id) likedChannels.add(r.channel_id);

  // 6b. liked_centroid via time-decay weighting
  const dim = centerEmbedding.length;
  const accum: number[] = new Array(dim).fill(0);
  let weightSum = 0;
  const now = Date.now();
  const halfLifeMs = cfg.likedDecayHalfLifeDays * MS_PER_DAY;
  const ageByVid = new Map<string, number>();
  for (const r of likedRows) ageByVid.set(r.video_id, now - r.created_at.getTime());

  for (const row of likedEmbedRows) {
    const vec = parsePgvectorLiteral(row.embedding, dim);
    if (!vec) continue;
    const ageMs = ageByVid.get(row.video_id) ?? Infinity;
    if (!Number.isFinite(ageMs)) continue;
    const weight = Math.pow(0.5, ageMs / halfLifeMs);
    for (let i = 0; i < dim; i++) {
      // noUncheckedIndexedAccess — parsePgvectorLiteral verified
      // vec.length === dim and accum is preallocated with dim slots.
      accum[i] = (accum[i] ?? 0) + (vec[i] ?? 0) * weight;
    }
    weightSum += weight;
  }

  // 6c. drift guard
  let driftGuardFired = false;
  if (weightSum > 0) {
    const likedCentroid = accum.map((v) => v / weightSum);
    const driftCos = cosineSimilarity(likedCentroid, centerEmbedding);
    if (driftCos < cfg.driftGuardCosine) {
      driftGuardFired = true;
    }
  }

  // 6e. apply boost (Layer 4: channel match only at v1; alphaEmbed deferred
  //     per spec §8 v2+).
  let boostedCount = 0;
  const boosted = candidates.map((c) => {
    let boost = 0;
    if (!driftGuardFired && c.channelId && likedChannels.has(c.channelId)) {
      boost += cfg.alphaChannel;
    }
    const capped = Math.min(boost, cfg.maxFeedbackBoost);
    if (capped > 0) {
      boostedCount += 1;
      return { ...c, score: c.score * (1 + capped) };
    }
    return c;
  });

  return { boostedCandidates: boosted, boostedCount, driftGuardFired };
}

interface CapsResult {
  accepted: CachedMatch[];
  capsChannel: number;
  capsSubgoal: number;
}

function applyCapsAndSort(
  candidates: CachedMatch[],
  cfg: ReturnType<typeof getAddCardsConfig>
): CapsResult {
  const sorted = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.cellIndex - b.cellIndex;
  });
  const accepted: CachedMatch[] = [];
  const channelCount = new Map<string, number>();
  const subgoalCount = new Map<number, number>();
  let capsChannel = 0;
  let capsSubgoal = 0;
  for (const c of sorted) {
    if (accepted.length >= cfg.limitDefault) break;
    const chKey = c.channelId ?? 'unknown';
    if ((channelCount.get(chKey) ?? 0) >= cfg.channelCap) {
      capsChannel += 1;
      continue;
    }
    if ((subgoalCount.get(c.cellIndex) ?? 0) >= cfg.subgoalCap) {
      capsSubgoal += 1;
      continue;
    }
    accepted.push(c);
    channelCount.set(chKey, (channelCount.get(chKey) ?? 0) + 1);
    subgoalCount.set(c.cellIndex, (subgoalCount.get(c.cellIndex) ?? 0) + 1);
  }
  return { accepted, capsChannel, capsSubgoal };
}

/** Parse pgvector "[v1,v2,...]" text literal into number[]. Returns null on shape mismatch. */
function parsePgvectorLiteral(
  text: string | null | undefined,
  expectedDim: number
): number[] | null {
  if (
    typeof text !== 'string' ||
    text.length < 3 ||
    text[0] !== '[' ||
    text[text.length - 1] !== ']'
  ) {
    return null;
  }
  const inner = text.slice(1, -1);
  const parts = inner.split(',');
  if (parts.length !== expectedDim) return null;
  const vec = new Array<number>(expectedDim);
  for (let i = 0; i < expectedDim; i++) {
    const n = Number(parts[i]);
    if (!Number.isFinite(n)) return null;
    vec[i] = n;
  }
  return vec;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    // noUncheckedIndexedAccess — length-equality + length>0 guarded above.
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
