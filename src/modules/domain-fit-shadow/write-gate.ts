/**
 * Domain-fit WRITE-edge ENFORCE gate (R23 — search redesign, blast-0 code-only;
 * deploy/flag-flip is James-gated, NOT part of this module's scope).
 *
 * Composite decision for the reuse-loop WRITE edge
 * (`src/modules/video-pool/reuse-from-v5.ts` `reusePickedToPool`): the frozen
 * T3 binary classifier (`./client.ts`) combined with the R22 lexical
 * qualifier-conflict signal (`./lexical-qualifier.ts`) into ONE scalar score,
 * thresholded — deliberately NOT a plain T3-only fit/not-fit boolean, so a T3
 * "적합" verdict can still be blocked by a lexical qualifier collision the LLM
 * missed (the 회화/코드 generic-noun over-pass pattern quantified in
 * docs/qa/domain-fit-r20-polysemy-overpass-n-expansion.md).
 *
 * SEPARATE module from `write-shadow.ts` (measure-only — `void` return, never
 * branches the caller). This module's whole purpose IS to return a branchable
 * decision, gated by `DOMAIN_FIT_WRITE_ENFORCE` (default false) at the call
 * site — see `src/config/domain-fit-shadow.ts`. Off = never imported/called
 * from a live code path with effect; `write-shadow.ts`'s existing shadow-log
 * call is completely unaffected either way (R19-A1 invariant preserved).
 *
 * Fail-open on classifier unavailability (timeout / http error / unparseable
 * response): a WRITE decision must never silently starve pool supply because
 * the Mac Mini Ollama instance is down — same fail-open posture as the
 * codebase's other classifier-outage guards (e.g. the zxx/und/mul/mis
 * non-linguistic-audio-code fail-open on the language gate).
 */

import { logger } from '@/utils/logger';
import { recordTrace, withTraceContext, getTraceContext } from '@/modules/discover-tracing';
import type { DomainFitShadowConfig } from '@/config/domain-fit-shadow';
import { classifyDomainFit, type DomainFitLabel } from './client';
import { detectQualifierConflicts } from './lexical-qualifier';
import type { DomainFitWriteShadowStage } from './write-shadow';

const log = logger.child({ module: 'domain-fit-shadow/write-gate' });

/**
 * Composite score threshold — write iff score >= this. Named constant (no
 * magic number at call sites). score = (T3 fit ? 1 : 0) * lexical multiplier
 * (1 = no conflict, DEFAULT_QUALIFIER_CONFLICT_MULTIPLIER = 0.2 on conflict —
 * see lexical-qualifier.ts), so 0.5 requires BOTH a "적합" T3 verdict AND no
 * lexical qualifier conflict to pass.
 */
export const DOMAIN_FIT_WRITE_ENFORCE_THRESHOLD = 0.5;

export type DomainFitWriteEnforceReason =
  | 'fit'
  | 'not_fit'
  | 'lexical_conflict'
  | 'classifier_unavailable_fail_open';

export interface DomainFitWriteEnforceInput {
  stage: DomainFitWriteShadowStage;
  centerGoal: string;
  videoId: string;
  title: string;
  /** video_pool.source this write is about to use. */
  source: string;
  /** Trace-context hint — used ONLY when no ambient trace context is bound. */
  mandalaId?: string | null;
  userId?: string | null;
}

export interface DomainFitWriteEnforceResult {
  /** true => caller should proceed with the write; false => skip it. */
  passed: boolean;
  fit: DomainFitLabel | null;
  /** true only when the classifier produced a parseable verdict. */
  classifierOk: boolean;
  /** Composite scalar; null when the classifier failed (fail-open, no score computed). */
  score: number | null;
  lexicalConflict: boolean;
  reason: DomainFitWriteEnforceReason;
}

/**
 * Pure decision — classify + lexical-deboost combined into one scalar,
 * thresholded. No trace/logging side effect; see `runDomainFitWriteEnforce`
 * for the logged wrapper used at the actual call site. Never throws
 * (`classifyDomainFit` itself never throws).
 */
export async function evaluateDomainFitWriteGate(
  centerGoal: string,
  title: string,
  cfg: Pick<DomainFitShadowConfig, 'ollamaUrl' | 'model' | 'timeoutMs'>
): Promise<DomainFitWriteEnforceResult> {
  const r = await classifyDomainFit(centerGoal, title, cfg);
  if (!r.ok || r.fit === null) {
    return {
      passed: true, // fail-open — classifier outage never blocks a write.
      fit: null,
      classifierOk: false,
      score: null,
      lexicalConflict: false,
      reason: 'classifier_unavailable_fail_open',
    };
  }
  // detectQualifierConflicts (not applyQualifierDeboost) — same primitive,
  // avoids a duplicate conflict-detection pass since `hasConflict` is also
  // needed for the logged reason below.
  const { hasConflict, multiplier } = detectQualifierConflicts(centerGoal, title);
  const base = r.fit === '적합' ? 1 : 0;
  const score = base * multiplier;
  const passed = score >= DOMAIN_FIT_WRITE_ENFORCE_THRESHOLD;
  return {
    passed,
    fit: r.fit,
    classifierOk: true,
    score,
    lexicalConflict: hasConflict,
    reason: passed ? 'fit' : r.fit === '비적합' ? 'not_fit' : 'lexical_conflict',
  };
}

/**
 * Evaluate + log (recordTrace) the ENFORCE decision — step
 * `domain_fit_write_enforce.<stage>`, for supervisor L2 sampling. Callers
 * (`reuse-from-v5.ts`) MUST await this: unlike write-shadow.ts's
 * fire-and-forget schedule, an enforce decision has to be known BEFORE the
 * caller decides whether to upsert. Same "bind a scoped trace context when
 * none is ambient" behavior as `write-shadow.ts` so the log is never silently
 * dropped by an accident of the caller's context. A trace-logging failure is
 * swallowed — it can never block or alter the returned decision.
 */
export async function runDomainFitWriteEnforce(
  input: DomainFitWriteEnforceInput,
  cfg: DomainFitShadowConfig
): Promise<DomainFitWriteEnforceResult> {
  const t0 = Date.now();
  const result = await evaluateDomainFitWriteGate(input.centerGoal, input.title, cfg);
  try {
    const writeTrace = () =>
      recordTrace({
        step: `domain_fit_write_enforce.${input.stage}`,
        status: 'ok',
        request: {
          model: cfg.model,
          video_id: input.videoId,
          source: input.source,
        },
        response: {
          decision: result.passed ? 'passed' : 'blocked',
          fit: result.fit,
          classifier_ok: result.classifierOk,
          score: result.score,
          lexical_conflict: result.lexicalConflict,
          reason: result.reason,
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
    // Never let a trace-logging failure surface anywhere near the enforced
    // write decision this is observing.
    log.debug(
      `domain-fit write-enforce trace failed (swallowed): ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return result;
}
