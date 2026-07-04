/**
 * Domain-fit WRITE-edge shadow (R19 — search redesign, blast-0).
 *
 * Same frozen T3 classifier (`./client.ts`) and `recordTrace` instrumentation
 * as the serve-side shadow (`./shadow.ts`), wired at the TWO goal-aware
 * pool-WRITE edges identified in
 * docs/qa/domain-fit-r14-write-gate-and-goal-level.md §R14-2:
 *
 *   1. `src/modules/video-pool/reuse-from-v5.ts` — `reusePickedToPool`,
 *      right after `prepareReuseRow` returns a non-null row, before the
 *      `video_pool.upsert` call.
 *   2. `src/api/routes/cards.ts` — the `/like` fire-and-forget IIFE, right
 *      after the existing blocklist/channel-block gates, before the
 *      `video_pool.upsert` call.
 *
 * enforce-0: this module NEVER returns a value the caller could branch on
 * for the write decision — `scheduleDomainFitWriteShadow` returns `void`.
 * The upsert at both call sites is unconditional and unchanged; this is
 * observation only ("what got written + would it have passed a domain-fit
 * gate"), same measurement shape as the read-path shadow, just a single
 * candidate per call instead of a batch.
 *
 * flag-gated by `DOMAIN_FIT_WRITE_SHADOW` (default false, SEPARATE from the
 * serve-side `DOMAIN_FIT_SHADOW` master flag) — off = zero extra Ollama
 * calls, zero extra trace writes, byte-identical to pre-R19 behavior.
 *
 * async/post: fire-and-forget (`void` internally) — never awaited by
 * callers, never blocks the write it is observing.
 */

import { logger } from '@/utils/logger';
import { recordTrace, withTraceContext, getTraceContext } from '@/modules/discover-tracing';
import { loadDomainFitShadowConfig, type DomainFitShadowConfig } from '@/config/domain-fit-shadow';
import { classifyDomainFit } from './client';

const log = logger.child({ module: 'domain-fit-shadow/write-shadow' });

/** Which WRITE-edge this judgment came from — mirrors the two R14-2 file:line sites. */
export type DomainFitWriteShadowStage = 'reuse' | 'like';

export interface ScheduleDomainFitWriteShadowInput {
  stage: DomainFitWriteShadowStage;
  /** The mandala's centerGoal — goal-level, same target as the serve-side shadow (R14-1). */
  centerGoal: string;
  videoId: string;
  title: string;
  /** video_pool.source this write is about to use ('user_live' | 'user_curated'). */
  source: string;
  /** Trace-context hint — used ONLY when no ambient trace context is bound (see below). */
  mandalaId?: string | null;
  userId?: string | null;
}

/**
 * Schedule a single WRITE-edge shadow judgment. Returns immediately
 * (synchronous no-op check + fire-and-forget dispatch) — callers must NOT
 * await. No-op when the flag is off.
 */
export function scheduleDomainFitWriteShadow(
  input: ScheduleDomainFitWriteShadowInput,
  cfgOverride?: DomainFitShadowConfig
): void {
  const cfg = cfgOverride ?? loadDomainFitShadowConfig();
  if (!cfg.writeShadowEnabled) return;

  void runDomainFitWriteShadow(input, cfg).catch((err) => {
    // Belt-and-suspenders — runDomainFitWriteShadow already swallows
    // internally, this only guards against a truly unexpected sync throw.
    log.debug(
      `domain-fit write-shadow run failed (swallowed): ${err instanceof Error ? err.message : String(err)}`
    );
  });
}

/**
 * Exported (in addition to `scheduleDomainFitWriteShadow`) so tests can
 * `await` the judgment directly instead of racing the fire-and-forget
 * dispatch. Production callers should use `scheduleDomainFitWriteShadow`.
 */
export async function runDomainFitWriteShadow(
  input: ScheduleDomainFitWriteShadowInput,
  cfg: DomainFitShadowConfig
): Promise<void> {
  const t0 = Date.now();
  try {
    const r = await classifyDomainFit(input.centerGoal, input.title, cfg);
    const writeTrace = () =>
      recordTrace({
        step: `domain_fit_shadow.write.${input.stage}`,
        status: 'ok',
        request: {
          model: cfg.model,
          video_id: input.videoId,
          source: input.source,
          goal_level: true,
        },
        response: {
          fit: r.fit,
          ok: r.ok,
        },
        latencyMs: Date.now() - t0,
      });

    // Both WRITE-edge call sites may run outside an ambient `withTraceContext`
    // (cards.ts's /like IIFE has none today; reuse-from-v5's caller chain
    // usually does, via add-cards.ts, but is not guaranteed). recordTrace
    // silently no-ops with no bound context — bind a scoped one here so this
    // shadow observation is never silently dropped by an accident of the
    // caller's context, without touching the caller's own tracing.
    if (getTraceContext()) {
      writeTrace();
    } else {
      await withTraceContext(
        { mandalaId: input.mandalaId ?? null, userId: input.userId ?? null },
        async () => writeTrace()
      );
    }
  } catch (err) {
    // Never let a shadow-logging failure surface anywhere near the write
    // path this is observing — always invoked fire-and-forget.
    log.debug(
      `domain-fit write-shadow scoring failed (swallowed): ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
