/**
 * Domain-fit shadow scheduler (R13-1; R14-1 rescoped goal-level).
 *
 * Fire-and-forget: scores the v3 recruited-and-ranked candidate set (post
 * keyword/embedding recruit + applyMandalaFilterWithStats — see
 * `src/skills/plugins/video-discover/v3/executor.ts` call sites) against the
 * frozen local-Ollama T3 domain-fit classifier, and LOGS the verdict + the
 * candidate's REAL mandala-filter score/rank via the existing `recordTrace`
 * instrumentation (`src/modules/discover-tracing`). This is observation only:
 *   - enforce-0: never mutates / reorders the caller's candidate array.
 *   - async/post: the caller must NOT await this function. It schedules the
 *     work with `void` internally and never throws.
 *   - flag-gated: `DOMAIN_FIT_SHADOW` (default false) — off = literally zero
 *     extra work (checked before touching the candidate list).
 *
 * R14-1 — classification target is the mandala's `centerGoal` (domain-level),
 * not the per-cell subgoal used in R13. R13-2's offline sim found per-cell
 * subgoal scoring produced a 25.8% false-not-fit rate on a known-clean
 * mandala (docs/qa/domain-fit-r13-2-sim-results.md §a) — most of those misses
 * were genuine CELL-level mismatches within an overall-legit mandala (a
 * placement-granularity effect), not evidence the video is off the mandala's
 * DOMAIN. Goal-level scoring measured 6.5% false-not-fit on the same style of
 * real data, clearing the <10% bar. `cellIndex`/`rank` are still logged per
 * candidate (needed for the trace's per-cell breakdown), just no longer used
 * to pick the comparison text.
 */

import { logger } from '@/utils/logger';
import { recordTrace } from '@/modules/discover-tracing';
import { loadDomainFitShadowConfig, type DomainFitShadowConfig } from '@/config/domain-fit-shadow';
import { classifyDomainFit, classifyDomainFitScalar, type DomainFitLabel } from './client';

const log = logger.child({ module: 'domain-fit-shadow' });

export type DomainFitShadowStage = 'tier1' | 'tier2';

/** One recruited candidate as it stands AFTER applyMandalaFilterWithStats. */
export interface ShadowCandidateInput {
  videoId: string;
  title: string;
  /** Mandala cell (0-7) this candidate was routed to by the mandala filter — logged, not used to pick the classification goal (R14-1: goal-level). */
  cellIndex: number;
  /** 0-based position within the final ranked/sorted recruited set for this stage. */
  rank: number;
  /** The mandala-filter (or tier1 match) score that produced `rank` — the REAL score, not a proxy. */
  score: number;
}

export interface ScheduleDomainFitShadowInput {
  stage: DomainFitShadowStage;
  /** R14-1: this IS the classification goal (domain-level) — subGoals are no longer used to build the prompt. */
  centerGoal: string;
  /**
   * @deprecated R14-1 — retained only so existing call sites (v3/executor.ts)
   * don't need a signature change. No longer read for classification; the
   * comparison text is always `centerGoal`.
   */
  subGoals: string[];
  candidates: ShadowCandidateInput[];
}

export interface ShadowScoredCandidate {
  videoId: string;
  cellIndex: number;
  rank: number;
  /** REAL mandala-filter score (never a synthetic/proxy value). */
  score: number;
  fit: DomainFitLabel | null;
  ok: boolean;
  ms: number;
  /** R14-1 — additive T3_SCALAR confidence (0.0-1.0), only when DOMAIN_FIT_SHADOW_SCALAR is on. */
  scalarScore?: number | null;
  scalarMs?: number;
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
          // R14-1: goal-level — always the mandala's centerGoal, never the
          // per-cell subgoal (see module header for the false-not-fit
          // rationale). cellIndex/rank stay per-candidate for the trace.
          const r = await classifyDomainFit(input.centerGoal, c.title, cfg);
          const base: ShadowScoredCandidate = {
            videoId: c.videoId,
            cellIndex: c.cellIndex,
            rank: c.rank,
            score: c.score,
            fit: r.fit,
            ok: r.ok,
            ms: r.ms,
          };
          if (!cfg.scalarEnabled) return base;
          // Additive second call — never substitutes the binary verdict
          // above, never blocks it (sequential here only to keep the burst
          // width == cfg.concurrency total in-flight calls, not 2x).
          const scalar = await classifyDomainFitScalar(input.centerGoal, c.title, cfg);
          return { ...base, scalarScore: scalar.score, scalarMs: scalar.ms };
        })
      );
      results.push(...scored);
    }

    const fitCount = results.filter((r) => r.fit === '적합').length;
    const notFitCount = results.filter((r) => r.fit === '비적합').length;
    const failedCount = results.length - fitCount - notFitCount;
    const scalarScores = results
      .map((r) => r.scalarScore)
      .filter((s): s is number => typeof s === 'number');

    recordTrace({
      step: `domain_fit_shadow.${input.stage}`,
      status: 'ok',
      request: {
        model: cfg.model,
        candidates_total: input.candidates.length,
        candidates_scored: capped.length,
        max_candidates: cfg.maxCandidates,
        scalar_enabled: cfg.scalarEnabled,
        goal_level: true, // R14-1 marker — distinguishes from R13 per-cell rows
      },
      response: {
        fit: fitCount,
        not_fit: notFitCount,
        failed: failedCount,
        scalar_mean: scalarScores.length
          ? scalarScores.reduce((a, b) => a + b, 0) / scalarScores.length
          : null,
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
