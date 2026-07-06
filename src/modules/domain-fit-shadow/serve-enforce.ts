/**
 * Domain-fit SERVE-edge ENFORCE (R24 — search redesign, blast-0 code-only;
 * deploy/flag-flip is James-gated, NOT part of this module's scope).
 *
 * The enforce counterpart of `shadow.ts`'s R23 pool-serve SERVE-edge shadow
 * (`stage: 'pool_serve'`, would-serve LOGGING only). This module actually
 * REORDERS the pre-gate candidate list: the frozen T3 binary classifier
 * (`./client.ts`) combined with the R22 lexical qualifier-conflict signal
 * (`./lexical-qualifier.ts`) into one composite DEBOOST multiplier, applied
 * as a stable demote-only sort — same "reorder, never drop" contract as the
 * diversity-guard transforms (`src/skills/plugins/video-discover/diversity-guard.ts`
 * hardChannelCap / softChannelCap / crossChannelTitleDedup): domain-fit is
 * simply another reorder layer at the SAME pipeline position (after
 * hygiene/diversity/shorts-drop, BEFORE the relevance gate decides the
 * per-cell budget), never a hard cut — the 50~70 card-count floor can never
 * be put at risk by this transform alone (output length === input length,
 * always, regardless of flag state or classifier outcome).
 *
 * Placement in the pipeline matters: reordering BEFORE the relevance gate
 * (`gate()` in pool-serve-fill.ts) means a demoted, low domain-fit candidate
 * can lose a limited per-cell budget SLOT to a higher domain-fit candidate
 * further down the recruit-rank order — a real reorder-driven outcome
 * change, not just cosmetic in-cell display order (contrast: reordering
 * AFTER the gate's budget cutoff has already run could only reorder display
 * position among an already-fixed selected set).
 *
 * Latency posture (see module docstring in pool-serve-fill.ts — this ALWAYS
 * runs inside the already-ASYNC pg-boss job, never the synchronous
 * wizard/add-cards HTTP read path):
 *   1. video-intrinsic CACHE (`./serve-cache.ts`, table `video_domain_fit_cache`,
 *      keyed by (youtube_video_id, mandala_id) — same PK shape as the
 *      existing `video_mandala_relevance` cache) avoids a repeat Ollama call
 *      for the same video within one mandala (R14-1: goal-level scoring is
 *      mandala-wide, so one score serves every cell + every re-dispatch).
 *   2. bounded to `cfg.maxCandidates` (shared cap with the shadow sibling,
 *      default 40) — realistic per-cell recruit sets (~12-22, see
 *      pool-serve config V5_POOL_SERVE_CANDIDATES_LIMIT/LIVE_FALLBACK_MAX_RESULTS)
 *      stay well under this; anything beyond the cap is appended UNSCORED at
 *      the tail (never dropped).
 *   3. bounded concurrency burst (`cfg.concurrency`, default 4) — same
 *      burst-width discipline as the shadow/write-gate siblings, avoids
 *      hammering the single Mac Mini Ollama instance
 *      (feedback_no_repeated_hammering.md).
 *   4. per-call timeout (`cfg.timeoutMs`, default 5000ms, AbortController —
 *      see client.ts) + FAIL-OPEN: a classifier timeout/HTTP-error/unparsable
 *      response never demotes (multiplier=1, i.e. no reorder for that
 *      candidate) and is NEVER cached (a transient Mac Mini outage
 *      self-heals on the next call instead of pinning a false failure).
 *   Honest worst-case wall time (all calls miss cache AND time out):
 *   ceil(maxCandidates / concurrency) * timeoutMs = ceil(40/4)*5000ms = 50s;
 *   at realistic recruit-set sizes ceil(22/4)*5000ms ≈ 30s. This runs inside
 *   the fire-and-forget pool-serve-fill job (user sees the W1b "filling"
 *   state meanwhile) — same property the R23 shadow sibling already has,
 *   not a NEW risk introduced by ENFORCE specifically.
 *
 * Compliance: inference is local-only (Mac Mini via Tailscale). No Anthropic /
 * OpenRouter / YouTube API calls are made by this module.
 */

import { logger } from '@/utils/logger';
import { recordTrace, withTraceContext, getTraceContext } from '@/modules/discover-tracing';
import type { DomainFitShadowConfig } from '@/config/domain-fit-shadow';
import { classifyDomainFit, type DomainFitLabel } from './client';
import { detectQualifierConflicts } from './lexical-qualifier';

const log = logger.child({ module: 'domain-fit-shadow/serve-enforce' });

/**
 * Deboost multiplier applied on a 비적합 (not-fit) verdict — NOT a hard cut
 * (demote-only, never 0/drop). Named constant (no magic number at call
 * sites), same spirit as `DEFAULT_QUALIFIER_CONFLICT_MULTIPLIER` in
 * lexical-qualifier.ts and `DOMAIN_FIT_WRITE_ENFORCE_THRESHOLD` in
 * write-gate.ts. Range per the supervisor spec: 0.2-0.3; 0.25 chosen as the
 * midpoint — a candidate stays serveable (never zeroed) but sinks below any
 * '적합' peer regardless of recruit rank.
 */
export const DOMAIN_FIT_SERVE_ENFORCE_DEBOOST_MULTIPLIER = 0.25;

/** Minimal candidate shape this module needs — matches pool-serve-fill's
 *  `GateCandidate` (youtubeVideoId/title) so no field-mapping step is needed
 *  at the call site. */
export interface DomainFitServeCandidate {
  youtubeVideoId: string;
  title: string;
}

export interface DomainFitServeCacheEntry {
  fit: DomainFitLabel;
  lexicalConflict: boolean;
  multiplier: number;
  model: string;
  scoredAt: string;
}

/** Injectable cache — decouples the pure reorder logic below from any DB
 *  specifics (see `./serve-cache.ts` for the real `video_domain_fit_cache`
 *  backed implementation; tests use a simple in-memory fake). */
export interface DomainFitServeCache {
  get(youtubeVideoId: string): Promise<DomainFitServeCacheEntry | null>;
  set(youtubeVideoId: string, entry: DomainFitServeCacheEntry): Promise<void>;
}

/** Every call is a miss; `set` is a no-op — used when no persistent cache is
 *  wired (e.g. a caller that only wants the reorder, not the DB round-trip). */
export function createNoopDomainFitServeCache(): DomainFitServeCache {
  return {
    get: async () => null,
    set: async () => {},
  };
}

export interface ApplyDomainFitServeEnforceResult<T> {
  /** Same length as input, ALWAYS — DEMOTE only, never drop (card-floor invariant). */
  reordered: T[];
  /** Count of candidates whose multiplier < 1 (i.e. actually demoted). */
  demoted: number;
  /** Count of fresh (non-cached) classifier calls made. */
  scored: number;
  cacheHits: number;
  /** Classifier timeout/error/unparsable — fail-open, never demoted, never cached. */
  classifierFailed: number;
}

/**
 * Pure reorder — classify + lexical-deboost combined into one composite
 * multiplier per candidate (cache-first), then a STABLE demote-only sort
 * (multiplier descending; ties preserve original recruit-rank order —
 * `Array.prototype.sort` is stable since ES2019 / all supported Node
 * runtimes). No trace/logging side effect; see `runDomainFitServeEnforce`
 * for the logged wrapper used at the actual call site.
 *
 * `cfg.serveEnforceEnabled` gates everything: off (default) is a synchronous
 * zero-cost no-op — same array reference returned, zero cache/classifier
 * calls — so every existing pool-serve-fill call site is byte-identical when
 * the flag is unset.
 */
export async function applyDomainFitServeEnforce<T extends DomainFitServeCandidate>(
  candidates: T[],
  centerGoal: string,
  cfg: DomainFitShadowConfig,
  cache: DomainFitServeCache
): Promise<ApplyDomainFitServeEnforceResult<T>> {
  if (!cfg.serveEnforceEnabled || candidates.length === 0) {
    return { reordered: candidates, demoted: 0, scored: 0, cacheHits: 0, classifierFailed: 0 };
  }

  // Bounded cap — anything beyond stays unscored, appended untouched at the
  // tail (never dropped; just not reordered).
  const capped = candidates.slice(0, cfg.maxCandidates);
  const overflow = candidates.slice(cfg.maxCandidates);

  let scored = 0;
  let cacheHits = 0;
  let classifierFailed = 0;
  const withMultiplier: { c: T; multiplier: number }[] = [];

  for (let i = 0; i < capped.length; i += cfg.concurrency) {
    const burst = capped.slice(i, i + cfg.concurrency);
    const results = await Promise.all(
      burst.map(async (c): Promise<{ c: T; multiplier: number }> => {
        const cached = await cache.get(c.youtubeVideoId).catch((err: unknown) => {
          log.debug(
            `domain-fit serve-enforce cache read failed (treated as miss): ${err instanceof Error ? err.message : String(err)}`
          );
          return null;
        });
        if (cached) {
          cacheHits += 1;
          return { c, multiplier: cached.multiplier };
        }

        const r = await classifyDomainFit(centerGoal, c.title, cfg);
        if (!r.ok || r.fit === null) {
          // Fail-open — a classifier outage must never demote a candidate,
          // and is deliberately NOT cached (self-heals on the next call).
          classifierFailed += 1;
          return { c, multiplier: 1 };
        }
        scored += 1;

        const { hasConflict, multiplier: lexicalMultiplier } = detectQualifierConflicts(
          centerGoal,
          c.title
        );
        const multiplier =
          r.fit === '비적합'
            ? DOMAIN_FIT_SERVE_ENFORCE_DEBOOST_MULTIPLIER * (hasConflict ? lexicalMultiplier : 1)
            : hasConflict
              ? lexicalMultiplier
              : 1;

        await cache
          .set(c.youtubeVideoId, {
            fit: r.fit,
            lexicalConflict: hasConflict,
            multiplier,
            model: cfg.model,
            scoredAt: new Date().toISOString(),
          })
          .catch((err: unknown) => {
            // Cache-write failure never blocks the reorder this request is doing.
            log.debug(
              `domain-fit serve-enforce cache write failed (swallowed): ${err instanceof Error ? err.message : String(err)}`
            );
          });
        return { c, multiplier };
      })
    );
    withMultiplier.push(...results);
  }

  const indexed = withMultiplier.map((r, idx) => ({ ...r, idx }));
  indexed.sort((a, b) => b.multiplier - a.multiplier || a.idx - b.idx);
  const demoted = indexed.filter((r) => r.multiplier < 1).length;
  const reordered: T[] = [...indexed.map((r) => r.c), ...overflow];

  return { reordered, demoted, scored, cacheHits, classifierFailed };
}

export interface DomainFitServeEnforceInput<T extends DomainFitServeCandidate> {
  /** 'pool' | 'live' — the two pool-serve-fill call sites (both use the same
   *  `gate()` budget-cutoff downstream). */
  stage: 'pool' | 'live';
  centerGoal: string;
  cellIndex: number;
  mandalaId?: string | null;
  userId?: string | null;
  candidates: T[];
}

/**
 * Evaluate + log (recordTrace) the ENFORCE reorder — step
 * `domain_fit_serve_enforce.<stage>`, for supervisor L2 sampling. Callers
 * MUST await this (unlike shadow.ts's fire-and-forget `scheduleDomainFitShadow`):
 * the reordered list feeds directly into the relevance gate's budget
 * decision. A trace-logging failure is swallowed — it can never block or
 * alter the returned (possibly reordered) candidate list.
 */
export async function runDomainFitServeEnforce<T extends DomainFitServeCandidate>(
  input: DomainFitServeEnforceInput<T>,
  cfg: DomainFitShadowConfig,
  cache: DomainFitServeCache
): Promise<T[]> {
  if (!cfg.serveEnforceEnabled || input.candidates.length === 0) return input.candidates;

  const t0 = Date.now();
  const result = await applyDomainFitServeEnforce(input.candidates, input.centerGoal, cfg, cache);
  try {
    const writeTrace = () =>
      recordTrace({
        step: `domain_fit_serve_enforce.${input.stage}`,
        status: 'ok',
        request: {
          model: cfg.model,
          cell_index: input.cellIndex,
          candidates_total: input.candidates.length,
          max_candidates: cfg.maxCandidates,
        },
        response: {
          demoted: result.demoted,
          scored: result.scored,
          cache_hits: result.cacheHits,
          classifier_failed: result.classifierFailed,
        },
        latencyMs: Date.now() - t0,
      });

    if (getTraceContext()) {
      writeTrace();
    } else {
      await withTraceContext(
        { mandalaId: input.mandalaId ?? null, userId: input.userId ?? null },
        async () => writeTrace()
      );
    }
  } catch (err) {
    // Never let a trace-logging failure surface anywhere near the reordered
    // list this is observing.
    log.debug(
      `domain-fit serve-enforce trace failed (swallowed): ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return result.reordered;
}
