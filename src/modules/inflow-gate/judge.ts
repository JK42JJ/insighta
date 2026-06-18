/**
 * Inflow-gate Layer-2 — wizard relevance judge (CP500++ PR-3, INV-INFLOW-GATE).
 *
 * The wizard v5 path (cell_binning) places cards with NO relevance judge,
 * unlike v3 (cosine center gate) and pool-serve (Haiku gate). This partitions
 * wizard-generated slots into kept / would-cut using the SHARED Haiku scorer
 * (computeCardRelevance), so the caller can trace (stage 1) or drop (stage 2).
 *
 * FAIL-OPEN: any scorer failure (provider error / no title / parse) KEEPS the
 * slot — a judge outage must never empty a cell. This differs from pool-serve,
 * which is fail-CLOSED to guard the pool-first lexical path (CP494+1); the
 * wizard path is live-generated, so supply-first wins = fail-open.
 *
 * Gate axis follows RELEVANCE_RUBRIC_ENABLED (same as pool-serve): rubric ON →
 * goal_contribution_pct (the measured discriminator); OFF → composite score.
 */

import { computeCardRelevance } from '@/modules/relevance/compute-card-relevance';
import { loadRelevanceRubricConfig } from '@/config/relevance-rubric';
import type { InflowGateConfig } from '@/config/inflow-gate';

// Bounded concurrency for the Haiku batch (mirrors pool-serve SCORE_BURST_SIZE).
const SCORE_BURST = 8;

/** Minimal slot shape the judge needs (AssembledSlot is a structural superset). */
export interface JudgeSlot {
  videoId: string;
  title: string;
  description: string | null;
  cellIndex: number;
}

export interface WouldCutEntry {
  videoId: string;
  title: string;
  cellIndex: number;
  gatePct: number;
  reason: string;
}

export interface JudgeResult<T> {
  /** Slots that pass (≥ relevanceMin) OR fail-open (scorer error). */
  kept: T[];
  /** Slots below threshold — traced (stage 1) or dropped (stage 2 uses `kept`). */
  wouldCut: WouldCutEntry[];
  scored: number;
  /** Slots kept because the scorer failed (fail-open), not because they passed. */
  failedOpen: number;
}

export interface JudgeContext {
  centerGoal: string;
  /** Per-cell sub-goals; cellGoal = subGoals[slot.cellIndex]. */
  subGoals: string[];
  language?: 'ko' | 'en';
  cfg: InflowGateConfig;
}

/**
 * Score each slot and partition into kept / wouldCut. Never throws; a scorer
 * error fails the slot OPEN (into `kept`). The caller applies the cut (stage 2)
 * by using `kept`, or ignores it and only traces `wouldCut` (stage 1).
 */
export async function judgeWizardSlots<T extends JudgeSlot>(
  slots: T[],
  ctx: JudgeContext
): Promise<JudgeResult<T>> {
  const rubric = loadRelevanceRubricConfig().enabled;
  const kept: T[] = [];
  const wouldCut: WouldCutEntry[] = [];
  let scored = 0;
  let failedOpen = 0;

  for (let i = 0; i < slots.length; i += SCORE_BURST) {
    const burst = slots.slice(i, i + SCORE_BURST);
    const verdicts = await Promise.all(
      burst.map(async (slot) => {
        const cellGoal = ctx.subGoals[slot.cellIndex];
        const r = await computeCardRelevance({
          title: slot.title,
          description: slot.description ?? '',
          centerGoal: ctx.centerGoal,
          cellGoal,
          language: ctx.language,
          ...(rubric ? { rubric: true } : {}),
        });
        if (!r.ok) {
          // FAIL-OPEN — keep the slot, do not cut on a scorer failure.
          return {
            slot,
            keep: true,
            failedOpen: true,
            gatePct: null as number | null,
            reason: `fail_open:${r.reason}`,
          };
        }
        const gatePct = rubric && r.detail ? r.detail.goalContributionPct : r.relevancePct;
        const keep = gatePct >= ctx.cfg.relevanceMin;
        return {
          slot,
          keep,
          failedOpen: false,
          gatePct,
          reason: keep ? 'pass' : `below_min:${gatePct}<${ctx.cfg.relevanceMin}`,
        };
      })
    );

    for (const v of verdicts) {
      scored += 1;
      if (v.failedOpen) failedOpen += 1;
      if (v.keep) {
        kept.push(v.slot);
      } else {
        wouldCut.push({
          videoId: v.slot.videoId,
          title: v.slot.title,
          cellIndex: v.slot.cellIndex,
          gatePct: v.gatePct as number,
          reason: v.reason,
        });
      }
    }
  }

  return { kept, wouldCut, scored, failedOpen };
}
