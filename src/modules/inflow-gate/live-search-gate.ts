/**
 * Live-search exposure gate (D-01 2026-07-03 — add-cards quality wiring).
 *
 * Wires the RELEVANCE axis (shared Haiku scorer via computeCardRelevance)
 * plus an AUDIO-LANGUAGE check onto the add-cards exposed slice. The trust
 * (view floor) axis is deliberately ABSENT: the 2026-07-03 floor-canary
 * incident proved view count alone kills niche topics (84% of a niche
 * mandala's relevant candidates sat under 1000 views, incl. official
 * Microsoft/AWS lectures). Channel blocklist stays wired upstream in v5.
 *
 * Cost/latency contract (measure-first):
 *  - Only the top-N exposed slice (pick-score order) is scored — never the
 *    raw fanout. The tail past top-N is DEMOTED below scored results, not
 *    scored and not hidden.
 *  - Scores are cached in video_mandala_relevance; a re-search is a cache
 *    hit = zero cost + idempotent ordering.
 *  - Scoring failure/timeout DEMOTES (never hides) — an empty panel is
 *    worse than a low-confidence tail (floor-incident lesson).
 *
 * Language rule (audio wins over title script): defaultAudioLanguage from
 * the existing videos.list snippet (free field, no extra quota). null =
 * pass (fail-open). A clear mismatch with the mandala's target language
 * (e.g. Arabic audio on an en mandala — the script-invisible case the
 * title filter cannot catch) hides the candidate.
 */

import { getPrismaClient } from '@/modules/database/client';
import { computeCardRelevance } from '@/modules/relevance/compute-card-relevance';
import { loadRelevanceRubricConfig } from '@/config/relevance-rubric';
import type { LiveSearchGateConfig } from '@/config/live-search-gate';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'live-search-gate' });

/** Minimal candidate shape the gate needs (v5 card is a structural superset). */
export interface LiveGateCandidate {
  videoId: string;
  title: string;
  cellIndex: number | null;
  audioLanguage: string | null;
  /** D-06 — for the subscriber trust-signal shadow (channels.list batch). */
  channelId?: string | null;
}

export interface LiveGateContext {
  mandalaId: string;
  centerGoal: string;
  /** Per-cell sub-goals; cellGoal = subGoals[cellIndex]. */
  subGoals: string[];
  language: 'ko' | 'en';
  cfg: LiveSearchGateConfig;
}

export interface LiveGateResult<T> {
  /** Exposed candidates: scored-pass first (gc desc), then demoted tail. */
  exposed: T[];
  /** gc attached per exposed videoId (null = unscored/demoted). */
  gcByVideoId: Map<string, number | null>;
  /** D-06 subscriber shadow — measurement only, never gates in this module. */
  subsByVideoId: Map<string, number | null>;
  wouldDropSub100: number;
  wouldDropSub1000: number;
  gcDropped: number;
  langDropped: number;
  cacheHits: number;
  scored: number;
  demoted: number;
  latencyMs: number;
}

/**
 * Audio-language mismatch: null passes (fail-open); primary subtag must be
 * the target language or English (en content is globally acceptable per the
 * CP492 off-language gate contract: ko ∪ en survives on ko mandalas).
 */
export function audioLanguageMismatch(audioLanguage: string | null, target: 'ko' | 'en'): boolean {
  if (!audioLanguage) return false;
  const primary = audioLanguage.trim().toLowerCase().split(/[-_]/)[0];
  if (!primary) return false;
  if (primary === 'en') return false;
  if (target === 'ko' && primary === 'ko') return false;
  return true;
}

/**
 * Gate the exposed slice: language check on ALL candidates (free), then gc
 * scoring on the top-N slice only (cache-first, one bounded Haiku wave).
 * Never throws; a total scorer outage demotes everything instead of hiding.
 */
export async function gateLiveSearchCards<T extends LiveGateCandidate>(
  candidates: T[],
  ctx: LiveGateContext
): Promise<LiveGateResult<T>> {
  const t0 = Date.now();
  const prisma = getPrismaClient();
  const rubric = loadRelevanceRubricConfig().enabled;
  const gcByVideoId = new Map<string, number | null>();

  // 1. Audio-language gate — free, applies to every candidate.
  let langDropped = 0;
  const langOk = candidates.filter((c) => {
    if (audioLanguageMismatch(c.audioLanguage, ctx.language)) {
      langDropped += 1;
      return false;
    }
    return true;
  });

  // 2. gc gate on the exposed top-N slice only.
  const head = langOk.slice(0, ctx.cfg.topN);
  const tail = langOk.slice(ctx.cfg.topN);

  // 2a. Cache read (one query for the whole slice).
  let cacheHits = 0;
  const cachedByIdRaw = head.length
    ? await prisma.video_mandala_relevance
        .findMany({
          where: {
            mandala_id: ctx.mandalaId,
            video_id: { in: head.map((c) => c.videoId) },
          },
          select: { video_id: true, relevance_pct: true, detail: true },
        })
        .catch((err: unknown) => {
          log.warn(
            `live-search gate cache read failed (scoring all): ${err instanceof Error ? err.message : String(err)}`
          );
          return [] as Array<{ video_id: string; relevance_pct: number; detail: unknown }>;
        })
    : [];
  const cachedById = new Map(cachedByIdRaw.map((r) => [r.video_id, r]));

  // 2b. Score misses in bounded bursts (single wave when burst >= topN).
  const scoredEntries: Array<{ c: T; gc: number | null }> = [];
  let scored = 0;
  const misses: T[] = [];
  for (const c of head) {
    const hit = cachedById.get(c.videoId);
    if (hit) {
      cacheHits += 1;
      const detail = hit.detail as { goalContributionPct?: number } | null;
      const gc =
        rubric && detail?.goalContributionPct != null
          ? detail.goalContributionPct
          : hit.relevance_pct;
      scoredEntries.push({ c, gc });
    } else {
      misses.push(c);
    }
  }

  for (let i = 0; i < misses.length; i += ctx.cfg.burst) {
    const burst = misses.slice(i, i + ctx.cfg.burst);
    const verdicts = await Promise.all(
      burst.map(async (c) => {
        const cellGoal = c.cellIndex != null ? ctx.subGoals[c.cellIndex] : undefined;
        const r = await computeCardRelevance({
          title: c.title,
          description: '',
          centerGoal: ctx.centerGoal,
          cellGoal,
          language: ctx.language,
          ...(rubric ? { rubric: true } : {}),
        });
        if (!r.ok) return { c, gc: null as number | null, detail: null };
        return { c, gc: r.relevancePct, detail: r.detail ?? null };
      })
    );
    for (const v of verdicts) {
      scored += 1;
      if (v.gc != null) {
        // Cache write — a re-search becomes a free cache hit (idempotency).
        const detailJson = v.detail ? JSON.stringify(v.detail) : null;
        await prisma.$executeRaw`
            INSERT INTO video_mandala_relevance (video_id, mandala_id, relevance_pct, detail)
            VALUES (${v.c.videoId}, ${ctx.mandalaId}::uuid, ${v.gc}, ${detailJson}::jsonb)
            ON CONFLICT (video_id, mandala_id)
            DO UPDATE SET relevance_pct = EXCLUDED.relevance_pct, detail = EXCLUDED.detail`.catch(
          (err: unknown) => {
            log.warn(
              `live-search gate cache write failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
            );
          }
        );
        const detail = v.detail as { goalContributionPct?: number } | null;
        const gc =
          rubric && detail?.goalContributionPct != null ? detail.goalContributionPct : v.gc;
        scoredEntries.push({ c: v.c, gc });
      } else {
        // Scoring failure — DEMOTE, never hide (floor-incident lesson).
        scoredEntries.push({ c: v.c, gc: null });
      }
    }
  }

  // 3. Partition + order: pass (gc desc) → failed-open demoted → unscored tail.
  const pass: Array<{ c: T; gc: number }> = [];
  const demotedScored: T[] = [];
  let gcDropped = 0;
  for (const e of scoredEntries) {
    if (e.gc == null) {
      demotedScored.push(e.c);
    } else if (e.gc >= ctx.cfg.relevanceMin) {
      pass.push({ c: e.c, gc: e.gc });
    } else {
      gcDropped += 1;
    }
    gcByVideoId.set(e.c.videoId, e.gc);
  }
  pass.sort((a, b) => b.gc - a.gc);
  for (const t of tail) gcByVideoId.set(t.videoId, null);

  // D-06 subscriber shadow — measure-only (channels.list, cached 1h). A
  // fetch failure leaves the map empty; gaps must never gate.
  const subsByVideoId = new Map<string, number | null>();
  let wouldDropSub100 = 0;
  let wouldDropSub1000 = 0;
  try {
    const { fetchChannelStats } = await import('@/modules/youtube/channel-stats');
    const { resolveVideosApiKeys } =
      await import('@/skills/plugins/video-discover/v2/youtube-client');
    const chIds = head.map((c) => c.channelId).filter((x): x is string => !!x);
    if (chIds.length > 0) {
      const stats = await fetchChannelStats(chIds, resolveVideosApiKeys(process.env));
      for (const c of head) {
        const subs = c.channelId ? (stats.get(c.channelId)?.subscriberCount ?? null) : null;
        subsByVideoId.set(c.videoId, subs);
        if (subs != null && subs < 100) wouldDropSub100 += 1;
        if (subs != null && subs < 1000) wouldDropSub1000 += 1;
      }
    }
  } catch (err) {
    log.warn(
      `subscriber shadow failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const exposed = [...pass.map((p) => p.c), ...demotedScored, ...tail];
  return {
    exposed,
    gcByVideoId,
    subsByVideoId,
    wouldDropSub100,
    wouldDropSub1000,
    gcDropped,
    langDropped,
    cacheHits,
    scored,
    demoted: demotedScored.length + tail.length,
    latencyMs: Date.now() - t0,
  };
}
