/**
 * Weekly fresh-supply leg (2026-08-03 redesign, restores design §6):
 * the WEEKLY topic build's PRIMARY source is a live v5 search over this
 * week's uploads — the original growth-hub design that the #1298 speed swap
 * (justified only for the user-waiting IMMEDIATE build) silently dropped.
 *
 * Responsibilities, in serving-contract order:
 *   1. v5 live search, publishedAfter = 7d (one 30d retry when empty)
 *   2. fit gate — computeCardRelevance(centerGoal=topic) against
 *      CURATION_RELEVANCE_FLOOR, fail-CLOSED (2026-08-04). The build-level
 *      gate in curation-build.ts judges every leg's picks again at the
 *      chokepoint; this one only saves work by dropping early.
 *   3. pool upsert AWAITED — the deck renders items via a video_pool join
 *      (backfill-curation-pool.ts: absent row = renders as nothing), so this
 *      is a RENDERING precondition, not an optimization. Admission mirrors
 *      channel-uploads: duration + blocklist gates, NO view floor (a video
 *      being 3 days old must not get it turned away — same argument as
 *      "a followed channel's upload is not turned away for being unpopular").
 *      Referenced rows get a long TTL so week history cannot go inactive
 *      under them (the "inactive 191 items" incident class).
 *   4. embeddings best-effort — only next week's pool KNN rung depends on
 *      them, never this week's rendering.
 */

import { Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';
import { getPrismaClient } from '@/modules/database/client';
import { runV5Executor, type V5Card } from '@/skills/plugins/video-discover/v5/executor';
import {
  embedBatch,
  vectorToLiteral,
  QWEN3_EMBED_MODEL,
} from '@/skills/plugins/iks-scorer/embedding';
import { computeCardRelevance } from '@/modules/relevance/compute-card-relevance';
import { titleHitsBlocklist } from '@/skills/plugins/video-discover/v2/youtube-client';
import {
  QUALITY_GOLD_VIEW_COUNT,
  QUALITY_SILVER_VIEW_COUNT,
  MIN_DURATION_SEC,
  MAX_DURATION_SEC,
} from '@/skills/plugins/batch-video-collector/manifest';
import { MS_PER_DAY } from '@/utils/time-constants';
import { generateMandalaWithQueries } from '@/modules/mandala/generator';
import { config } from '@/config/index';
import { CURATION_RELEVANCE_FLOOR } from './config';

const log = logger.child({ module: 'curation/weekly-fresh' });

/** Provenance for pool rows the weekly fresh leg creates. */
export const CURATION_POOL_SOURCE = 'curation_weekly';

/** Referenced-row longevity: curation_items render via a pool join, so rows
 *  this leg writes must outlive the default 30d pool TTL. */
export const CURATION_POOL_EXPIRES_DAYS = 365;

/** Live-search windows: a weekly delivery asks for the trailing week; niche
 *  topics get ONE widened retry before the pool fallback takes over. */
export const CURATION_FRESH_WINDOW_DAYS = 7;
export const CURATION_FRESH_RETRY_DAYS = 30;

/**
 * Cell labels handed to v5. Prod V5_QUERY_GEN=llm refines each label into a
 * focused searchable query (rule fallback built in), so these stay labels,
 * not final queries — the mechanism CP492 shipped for exactly this problem.
 * Design §6: "subGoals = 3~5 derived sub-queries".
 */
export function curationSubGoals(topic: string): string[] {
  const t = topic.trim();
  return [t, `${t} 최신`, `${t} 강의`, `${t} 사례`];
}

/** What the fresh leg hands to v5: cell labels, and queries when we have them. */
export interface ShapedTopic {
  subGoals: string[];
  /** Full-coverage per-cell queries; undefined = let v5 run its own query-gen. */
  precomputedQueries?: Array<{ cellIndex: number; query: string }>;
  /** False = the suffix labels above (generation off, failed, or degraded). */
  shaped: boolean;
}

/**
 * Turn a one-word topic into something v5 was built to receive.
 *
 * v5 expects a mandala: a centre plus sub-goals a person actually wrote, each
 * meaning something different. A curation subscription has one word, so the
 * shipped code manufactured four near-identical labels by appending 최신/강의/
 * 사례. Handed four labels that barely differ, the query generator has to
 * invent the difference — and "<topic> 사례" refines into success stories.
 * Measured on prod for "파이썬" (2026-08-03 04:03): the 7-day window returned
 * raw=1/title=0, the 30-day retry recruited 4 candidates, and they came from
 * 라이프해커·자청 / 유튜브신쌤 / 지투지 — self-help channels, not Python ones.
 *
 * `generateMandalaWithQueries` is the wizard's existing answer to exactly this
 * problem: one call produces the structure AND its per-cell queries in a single
 * continuous context, so the cells cannot collide. v5 already accepts those
 * queries verbatim through `precomputedQueries`. Nothing here is new — the
 * curation path simply never wired it up.
 *
 * Fail-open by construction: anything short of a full-coverage result returns
 * the suffix labels, which is what ships today.
 */
export async function shapeTopic(topic: string): Promise<ShapedTopic> {
  const fallback: ShapedTopic = { subGoals: curationSubGoals(topic), shaped: false };
  if (!config.curationTopicShaping.enabled) return fallback;

  try {
    const gen = await generateMandalaWithQueries({ goal: topic, language: 'ko' });
    const subGoals = (gen.structure.sub_goals ?? []).map((s) => s.trim()).filter(Boolean);
    if (subGoals.length < 2) {
      log.warn('curation topic shaping: too few sub-goals, using suffix labels', {
        topic,
        subGoals: subGoals.length,
      });
      return fallback;
    }
    // Partial coverage is worse than none: a sparse query set leaves some cells
    // to v5's own generator and some to ours, which is the collision we are
    // removing. The generator already reports this as `degraded`.
    const usable = !gen.meta.degraded && (gen.cellQueries?.length ?? 0) === subGoals.length;
    log.info('curation topic shaping', {
      topic,
      subGoals,
      queryCount: gen.cellQueries?.length ?? 0,
      degraded: gen.meta.degraded,
      latencyMs: gen.meta.latencyMs,
    });
    return {
      subGoals,
      precomputedQueries: usable ? gen.cellQueries : undefined,
      shaped: true,
    };
  } catch (err) {
    log.warn('curation topic shaping failed, using suffix labels', {
      topic,
      error: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  }
}

/**
 * Pure admission — duration + blocklist only. Deliberately NOT classifyQuality:
 * its 1,000-view floor would reject most sub-week uploads and ghost the very
 * videos the weekly contract exists to deliver. Tier stays diagnostic.
 */
export function curationPoolAdmission(card: {
  title: string;
  durationSec: number | null;
  viewCount: number | null;
}): { admit: boolean; tier: string; reason?: string } {
  const views = card.viewCount ?? 0;
  const tier =
    views >= QUALITY_GOLD_VIEW_COUNT
      ? 'gold'
      : views >= QUALITY_SILVER_VIEW_COUNT
        ? 'silver'
        : 'bronze';
  if (card.durationSec == null || card.durationSec < MIN_DURATION_SEC) {
    return { admit: false, tier, reason: 'too_short' };
  }
  if (card.durationSec > MAX_DURATION_SEC) {
    return { admit: false, tier, reason: 'too_long' };
  }
  if (titleHitsBlocklist(card.title)) {
    return { admit: false, tier, reason: 'title_blocklist' };
  }
  return { admit: true, tier };
}

async function storeFreshInPool(cards: V5Card[]): Promise<string[]> {
  const prisma = getPrismaClient();
  const stored: string[] = [];
  const expires = new Date(Date.now() + CURATION_POOL_EXPIRES_DAYS * MS_PER_DAY);
  for (const c of cards) {
    const gate = curationPoolAdmission(c);
    if (!gate.admit) continue;
    const shared = {
      title: c.title.slice(0, 5000),
      channel_name: c.channelTitle?.slice(0, 200) || null,
      channel_id: c.channelId?.slice(0, 30) || null,
      view_count: BigInt(c.viewCount ?? 0),
      duration_seconds: c.durationSec,
      published_at: c.publishedAt ? new Date(c.publishedAt) : null,
      thumbnail_url: c.thumbnailUrl || null,
      is_active: true,
      refreshed_at: new Date(),
      expires_at: expires,
    };
    try {
      await prisma.video_pool.upsert({
        where: { video_id: c.videoId },
        create: {
          video_id: c.videoId,
          language: 'ko',
          quality_tier: gate.tier,
          source: CURATION_POOL_SOURCE,
          ...shared,
        },
        // source/language stay as first written (channel-uploads convention).
        update: shared,
      });
      stored.push(c.videoId);
    } catch (err) {
      log.warn('curation pool write failed', {
        videoId: c.videoId,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
  }
  return stored;
}

/** Best-effort vectors for freshly pooled rows (next week's KNN rung). */
async function embedFresh(videoIds: string[]): Promise<number> {
  if (!videoIds.length) return 0;
  const prisma = getPrismaClient();
  try {
    const rows = await prisma.video_pool.findMany({
      where: { video_id: { in: videoIds } },
      select: { video_id: true, title: true, description: true },
    });
    if (!rows.length) return 0;
    const texts = rows.map((r) => `${r.title}\n${(r.description ?? '').slice(0, 500)}`);
    const vecs = await embedBatch(texts);
    let n = 0;
    for (let i = 0; i < rows.length; i++) {
      const vec = vecs[i];
      const row = rows[i];
      if (!vec || vec.length === 0 || !row) continue;
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO public.video_pool_embeddings (video_id, embedding, text_input, model_version)
        VALUES (${row.video_id}, ${vectorToLiteral(vec)}::vector, ${texts[i]}, ${QWEN3_EMBED_MODEL})
        ON CONFLICT (video_id, model_version) DO NOTHING
      `);
      n += 1;
    }
    return n;
  } catch (err) {
    log.warn('curation fresh embed failed (non-fatal)', {
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return 0;
  }
}

export interface FreshPick {
  videoId: string;
  relevancePct: number;
}

/**
 * The whole fresh leg: search → fit gate → pool (awaited) → embed (best
 * effort). Returns ONLY render-safe picks (pool row confirmed) with an honest
 * relevance (Haiku fit score; an unjudged card is dropped, not floored).
 */
export async function fetchFreshTopicVideos(args: {
  topic: string;
  weekDate: Date;
  excludeVideoIds: Set<string>;
  limit: number;
}): Promise<{ picks: FreshPick[]; windowDays: number; fitDropped: number }> {
  const { topic, weekDate, excludeVideoIds, limit } = args;
  // Shaped once, above the window retry: the 30-day retry is the same topic,
  // so re-running the generator for it would pay twice for one answer.
  const shape = await shapeTopic(topic);
  const runSearch = (days: number) =>
    runV5Executor({
      centerGoal: topic,
      subGoals: shape.subGoals,
      ...(shape.precomputedQueries ? { precomputedQueries: shape.precomputedQueries } : {}),
      focusTags: [],
      targetLevel: '',
      language: 'ko',
      includeEnCards: false,
      excludeVideoIds,
      publishedAfter: new Date(weekDate.getTime() - days * MS_PER_DAY).toISOString(),
      env: process.env,
    });

  let windowDays = CURATION_FRESH_WINDOW_DAYS;
  let v5 = await runSearch(windowDays);
  if (!v5.cards.length) {
    windowDays = CURATION_FRESH_RETRY_DAYS;
    v5 = await runSearch(windowDays);
  }
  if (!v5.cards.length) return { picks: [], windowDays, fitDropped: 0 };

  // Fit gate: score each fresh candidate against the topic; drop below the
  // floor. fail-CLOSED — an unjudged video is one we do not know about, and
  // garbage does not enter even at the cost of a thin week (owner, 2026-08-04).
  // This used to keep an errored card AT the floor so an LLM outage could not
  // empty the week; emptying the week is now the acceptable outcome, and a
  // silent pass is not.
  const scored: Array<{ card: V5Card; relevancePct: number }> = [];
  let fitDropped = 0;
  for (const card of v5.cards.slice(0, limit * 2)) {
    const r = await computeCardRelevance({
      videoId: card.videoId,
      title: card.title,
      centerGoal: topic,
      language: 'ko',
    });
    if (r.ok) {
      if (r.relevancePct < CURATION_RELEVANCE_FLOOR) {
        fitDropped += 1;
        continue;
      }
      scored.push({ card, relevancePct: r.relevancePct });
    } else {
      fitDropped += 1;
    }
    if (scored.length >= limit) break;
  }
  if (!scored.length) return { picks: [], windowDays, fitDropped };

  // Rendering precondition — only pool-confirmed videos are returned.
  const pooled = new Set(await storeFreshInPool(scored.map((s) => s.card)));
  const picks = scored
    .filter((s) => pooled.has(s.card.videoId))
    .map((s) => ({ videoId: s.card.videoId, relevancePct: s.relevancePct }));
  const embedded = await embedFresh(picks.map((p) => p.videoId));
  log.info('curation fresh leg', {
    topic,
    windowDays,
    // `searched` is the measurable that decides whether the shaping worked:
    // it was 4 for "파이썬" over 30 days before this change.
    searched: v5.cards.length,
    shaped: shape.shaped,
    subGoalCount: shape.subGoals.length,
    queryCount: shape.precomputedQueries?.length ?? 0,
    fitDropped,
    pooled: pooled.size,
    picks: picks.length,
    embedded,
  });
  return { picks, windowDays, fitDropped };
}
