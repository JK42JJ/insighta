/**
 * Domain-fit shadow scheduler (R13-1).
 *
 * Fire-and-forget: scores the v3 recruited-and-ranked candidate set (post
 * keyword/embedding recruit + applyMandalaFilterWithStats — see
 * `src/skills/plugins/video-discover/v3/executor.ts` call sites) against the
 * frozen local-Ollama T3 domain-fit classifier, and LOGS the verdict + the
 * candidate's current rank via the existing `recordTrace` instrumentation
 * (`src/modules/discover-tracing`). This is observation only:
 *   - enforce-0: never mutates / reorders the caller's candidate array.
 *   - async/post: the caller must NOT await this function. It schedules the
 *     work with `void` internally and never throws.
 *   - flag-gated: `DOMAIN_FIT_SHADOW` (default false) — off = literally zero
 *     extra work (checked before touching the candidate list).
 */

import { logger } from '@/utils/logger';
import { recordTrace } from '@/modules/discover-tracing';
import { loadDomainFitShadowConfig, type DomainFitShadowConfig } from '@/config/domain-fit-shadow';
import { classifyDomainFit, type DomainFitLabel } from './client';

const log = logger.child({ module: 'domain-fit-shadow' });

export type DomainFitShadowStage = 'tier1' | 'tier2';

/** One recruited candidate as it stands AFTER applyMandalaFilterWithStats. */
export interface ShadowCandidateInput {
  videoId: string;
  title: string;
  /** Mandala cell (0-7) this candidate was routed to by the mandala filter. */
  cellIndex: number;
  /** 0-based position within the final ranked/sorted recruited set for this stage. */
  rank: number;
  /** The mandala-filter (or tier1 match) score that produced `rank`. */
  score: number;
}

export interface ScheduleDomainFitShadowInput {
  stage: DomainFitShadowStage;
  centerGoal: string;
  /** subGoals[cellIndex] = the per-cell goal text; falls back to centerGoal. */
  subGoals: string[];
  candidates: ShadowCandidateInput[];
}

export interface ShadowScoredCandidate {
  videoId: string;
  cellIndex: number;
  rank: number;
  score: number;
  fit: DomainFitLabel | null;
  ok: boolean;
  ms: number;
}

/**
 * Schedule shadow scoring for one recruited set. Returns immediately
 * (synchronous no-op check + fire-and-forget dispatch) — callers must NOT
 * await. No-op when the flag is off or the candidate list is empty.
 */
export function scheduleDomainFitShadow(
  input: ScheduleDomainFitShadowInput,
  cfgOverride?: DomainFitShadowConfig
): void {
  const cfg = cfgOverride ?? loadDomainFitShadowConfig();
  if (!cfg.enabled) return;
  if (input.candidates.length === 0) return;

  void runDomainFitShadow(input, cfg).catch((err) => {
    // Belt-and-suspenders — runDomainFitShadow already swallows internally,
    // this only guards against a truly unexpected synchronous throw.
    log.debug(
      `domain-fit shadow run failed (swallowed): ${err instanceof Error ? err.message : String(err)}`
    );
  });
}

/**
 * Exported (in addition to `scheduleDomainFitShadow`) so tests can `await`
 * the scoring pass directly instead of racing the fire-and-forget dispatch.
 * Production callers should use `scheduleDomainFitShadow`, never this.
 */
export async function runDomainFitShadow(
  input: ScheduleDomainFitShadowInput,
  cfg: DomainFitShadowConfig
): Promise<void> {
  const t0 = Date.now();
  try {
    const capped = input.candidates.slice(0, cfg.maxCandidates);
    const results: ShadowScoredCandidate[] = [];

    for (let i = 0; i < capped.length; i += cfg.concurrency) {
      const burst = capped.slice(i, i + cfg.concurrency);
      const scored = await Promise.all(
        burst.map(async (c): Promise<ShadowScoredCandidate> => {
          const goal = input.subGoals[c.cellIndex] ?? input.centerGoal;
          const r = await classifyDomainFit(goal, c.title, cfg);
          return {
            videoId: c.videoId,
            cellIndex: c.cellIndex,
            rank: c.rank,
            score: c.score,
            fit: r.fit,
            ok: r.ok,
            ms: r.ms,
          };
        })
      );
      results.push(...scored);
    }

    const fitCount = results.filter((r) => r.fit === '적합').length;
    const notFitCount = results.filter((r) => r.fit === '비적합').length;
    const failedCount = results.length - fitCount - notFitCount;

    recordTrace({
      step: `domain_fit_shadow.${input.stage}`,
      status: 'ok',
      request: {
        model: cfg.model,
        candidates_total: input.candidates.length,
        candidates_scored: capped.length,
        max_candidates: cfg.maxCandidates,
      },
      response: {
        fit: fitCount,
        not_fit: notFitCount,
        failed: failedCount,
        candidates: results,
      },
      latencyMs: Date.now() - t0,
    });
  } catch (err) {
    // Never let a shadow-logging failure surface anywhere near the serve
    // path — this function is always invoked fire-and-forget.
    log.debug(
      `domain-fit shadow scoring failed (swallowed): ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
