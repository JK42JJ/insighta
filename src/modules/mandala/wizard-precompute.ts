/**
 * Wizard Precompute Pipeline — runtime module (CP424.2).
 *
 * Design: docs/design/precompute-pipeline.md (CP417 draft).
 *
 * Lifecycle:
 *   1. /wizard-stream handler, after Haiku structure completes, calls
 *      `setImmediate(() => startPrecompute(...))` with real sub_goals.
 *   2. startPrecompute: INSERT row (status=pending) → UPDATE running →
 *      runDiscoverEphemeral() → UPDATE done + discover_result / failed +
 *      error_message.
 *   3. /create-with-data handler, after mandala save tx, calls
 *      `consumePrecompute(mandalaId, sessionId)`:
 *        - SELECT row WHERE session_id + status=done + expires_at > NOW()
 *          + goal matches
 *        - INSERT recommendation_cache rows with new mandala_id
 *        - cardPublisher.notify per slot → SSE card_added backlog
 *        - UPDATE status=consumed + consumed_mandala_id + consumed_at
 *        - Miss → returns { consumed: false, reason } so caller falls back
 *          to existing triggerMandalaPostCreationAsync.
 *
 * Feature flag: WIZARD_PRECOMPUTE_ENABLED (compose env, default false).
 * Rollback: 1-line env flip. No code revert.
 */

import { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import { loadWizardPrecomputeConfig } from '@/config/wizard-precompute';
import type { EphemeralDiscoverResult } from '@/skills/plugins/video-discover/v3/executor';
import { runV5ForWizard } from '@/skills/plugins/video-discover/v5/wizard-adapter';
import { reclassifyPlacedNotIn } from '@/skills/plugins/video-discover/v5/trace-candidates';
import { writeSearchTrace, type SearchTraceCandidateInput } from '@/modules/search-trace';
import { loadInflowGateConfig } from '@/config/inflow-gate';
import { notifyCardAdded, type CardPayload } from '@/modules/recommendations/publisher';
import { MS_PER_DAY } from '@/utils/time-constants';
import {
  isPrecomputeAttachEnabled,
  ATTACH_BUDGET_MS,
  ATTACH_POLL_INTERVAL_MS,
} from '@/config/precompute-attach';
import { isT11InflowJudgeEnabled } from '@/config/t11-inflow-judge';
import { randomUUID } from 'crypto';

const log = logger.child({ module: 'wizard-precompute' });

const TTL_DAYS = 7; // recommendation_cache TTL when we upsert at consume-time.
const RECOMMENDATION_STATUS_PENDING = 'pending';
const WEIGHT_VERSION = 3;

// ---------------------------------------------------------------------------
// startPrecompute — /wizard-stream fire-and-forget entry
// ---------------------------------------------------------------------------

export interface StartPrecomputeInput {
  sessionId: string;
  userId: string;
  goal: string;
  language: 'ko' | 'en';
  focusTags: string[];
  targetLevel?: string;
  subGoals: string[]; // length 8 — from Haiku structure response
  /**
   * CP493 — merged-gen per-cell queries (one per cell, full coverage) produced
   * in the SAME Haiku call as the structure. When present, forwarded to fanout
   * as precomputedQueries → fanout skips its own query-gen. Undefined = legacy
   * (fanout runs V5_QUERY_GEN).
   */
  cellQueries?: { cellIndex: number; query: string }[];
}

/**
 * Fire-and-forget precompute launcher. Never throws — all failures are
 * persisted to the precompute row's status=failed + error_message.
 *
 * Honors WIZARD_PRECOMPUTE_ENABLED flag at call site; if disabled, returns
 * immediately. Keep the flag check here so callers can unconditionally
 * invoke without worrying about state.
 */
export async function startPrecompute(input: StartPrecomputeInput): Promise<void> {
  const cfg = loadWizardPrecomputeConfig();
  if (!cfg.enabled) return;

  const db = getPrismaClient();
  const t0 = Date.now();

  // Step 1: INSERT row (status=pending). Idempotent via session_id PK —
  // duplicate startPrecompute calls for the same session are no-ops. We
  // intentionally do NOT update an existing row here, because concurrent
  // callers should cooperate on the earlier row's lifecycle.
  try {
    await db.mandala_wizard_precompute.create({
      data: {
        session_id: input.sessionId,
        user_id: input.userId,
        goal: input.goal,
        language: input.language,
        focus_tags: input.focusTags,
        target_level: input.targetLevel ?? null,
        status: 'pending',
      },
    });
  } catch (err) {
    // Likely PK duplicate — another in-flight call owns this session.
    // Honest log and return; never crash the wizard SSE stream.
    log.info(
      `precompute row already exists for session=${input.sessionId} (dup startPrecompute); skipping`,
      {
        error: err instanceof Error ? err.message : String(err),
      }
    );
    return;
  }

  // Step 2: UPDATE status=running (separate tx to make running visible in
  // admin dashboards while discover is in flight).
  await db.mandala_wizard_precompute.update({
    where: { session_id: input.sessionId },
    data: { status: 'running' },
  });

  log.info(`precompute running: session=${input.sessionId} goal="${input.goal.slice(0, 40)}"`, {
    sessionId: input.sessionId,
    userId: input.userId,
  });

  // Step 3: runDiscoverEphemeral → persist result
  try {
    // CP490+ — wizard now uses the v5 LLM-pick path (Haiku via OpenRouter)
    // for parity with /add-cards. v3 cosine + Mac-mini Ollama dependency
    // was producing 70s+ runs returning 0 cards.
    const result = await runV5ForWizard({
      centerGoal: input.goal,
      subGoals: input.subGoals,
      language: input.language,
      focusTags: input.focusTags,
      targetLevel: input.targetLevel ?? 'standard',
      env: process.env,
      // CP500+ B-1 — exclude ALREADY-OWNED videos at recruitment. uvs has a
      // GLOBAL @@unique(user_id, videoId), so picks overlapping ANY existing
      // mandala silently evaporate at auto-add insert (measured 24/39 = 62%
      // lost, 2026-06-12 SaaS run). add-cards already excludes owned; the
      // wizard path did not. Fail-open: lookup failure ⇒ empty set.
      excludeVideoIds: await fetchOwnedYoutubeIds(input.userId),
      // CP493 — when WIZARD_MERGED_GEN produced full per-cell coverage.
      precomputedQueries: input.cellQueries,
    });

    // CP500++ PR-3 (INV-INFLOW-GATE) — Layer-2 relevance judge for the wizard
    // v5 path (cell_binning has no relevance judge, unlike v3 cosine / pool-serve
    // Haiku). Runs HERE (off the consume/save SLO; fire-and-forget precompute).
    // Stage 1 (INFLOW_GATE_ENABLED) traces would-cut WITHOUT dropping; stage 2
    // (INFLOW_GATE_CUT) drops below-threshold slots. Fail-open at every level —
    // a judge failure keeps slots. mandala_id does not exist yet (precompute is
    // pre-save), so the trace is step-keyed by user_id, not mandala_id.
    const gateCfg = loadInflowGateConfig(process.env);
    if (gateCfg.enabled && result.slots.length > 0) {
      try {
        // Dynamic import — keeps the Haiku scorer / openrouter / config chain
        // out of the static graph (load only when the gate is on; default off).
        const { judgeWizardSlots } = await import('@/modules/inflow-gate/judge');
        const verdict = await judgeWizardSlots(result.slots, {
          centerGoal: input.goal,
          subGoals: input.subGoals,
          language: input.language,
          cfg: gateCfg,
        });
        if (verdict.wouldCut.length > 0) {
          const { withTraceContext, recordTrace } = await import('@/modules/discover-tracing');
          await withTraceContext({ mandalaId: null, userId: input.userId }, async () => {
            recordTrace({
              step: gateCfg.cut ? 'inflow_gate.cut' : 'inflow_gate.would_cut',
              status: 'ok',
              response: {
                session_id: input.sessionId,
                scored: verdict.scored,
                failed_open: verdict.failedOpen,
                relevance_min: gateCfg.relevanceMin,
                cut_count: verdict.wouldCut.length,
                cut: verdict.wouldCut.slice(0, 50),
              },
            });
          });
        }
        if (gateCfg.cut) {
          result.slots = verdict.kept;
        }
        log.info(
          `inflow-gate: scored=${verdict.scored} would_cut=${verdict.wouldCut.length} ` +
            `cut=${gateCfg.cut} failed_open=${verdict.failedOpen} session=${input.sessionId}`,
          { sessionId: input.sessionId }
        );
      } catch (err) {
        // Orchestration-level fail-open: judge failure must not break precompute.
        log.warn(
          `inflow-gate judge threw (fail-open, slots kept): ${err instanceof Error ? err.message : String(err)}`,
          { sessionId: input.sessionId }
        );
      }
    }

    // Observability Phase 1 (STEP 3) — wizard trail log. Emitted HERE (start-
    // precompute), the ONLY point that runs for every quota-spending discover,
    // so quota_units is recorded even when consume later MISSES (expired /
    // goal-mismatch / empty-slots). trigger='wizard', mandalaId null (pre-save,
    // mirrors the inflow-gate trace). Fire-and-forget; no decision changed.
    // traceCandidates is built by the executor only when SEARCH_TRACE_ENABLED.
    const diag = result.diagnostics as unknown as {
      traceCandidates?: SearchTraceCandidateInput[];
      quotaUnitsApprox?: number;
      perQuery?: unknown;
      queriesAttempted?: number;
      queriesSucceeded?: number;
      rawItemCount?: number;
      afterTitleFilter?: number;
      afterExcludeFilter?: number;
      offLangDropped?: number;
      shortsDropped?: number;
    };
    if (diag.traceCandidates) {
      // The inflow-gate (above) may have cut slots the executor had PLACED —
      // reclassify those to below_relevance_min against the final kept set.
      const keptIds = new Set(result.slots.map((s) => s.videoId));
      const journey = reclassifyPlacedNotIn(
        diag.traceCandidates,
        keptIds,
        'below_relevance_min',
        'inflow_gate'
      );
      writeSearchTrace(
        {
          traceId: input.sessionId,
          mandalaId: null,
          userId: input.userId,
          trigger: 'wizard',
          startedAt: new Date(t0),
          finishedAt: new Date(),
          queriesGenerated: diag.perQuery,
          quotaUnits: diag.quotaUnitsApprox ?? null,
          queriesAttempted: diag.queriesAttempted ?? null,
          queriesSucceeded: diag.queriesSucceeded ?? null,
          queriesFailed: Math.max(0, (diag.queriesAttempted ?? 0) - (diag.queriesSucceeded ?? 0)),
          counts: {
            raw: diag.rawItemCount,
            after_title: diag.afterTitleFilter,
            after_exclude: diag.afterExcludeFilter,
            off_lang_dropped: diag.offLangDropped,
            shorts_dropped: diag.shortsDropped,
            placed: result.slots.length,
          },
          outcome: { cards_count: result.slots.length },
          algorithmVersion: null,
        },
        journey
      );
    }

    await db.mandala_wizard_precompute.update({
      where: { session_id: input.sessionId },
      data: {
        status: 'done',
        discover_result: result as unknown as Prisma.InputJsonValue,
      },
    });

    // T11 Stage1 (post-done race, supervisor GO 2026-07-14): the unanimous
    // judge runs AFTER done is marked — the consume SLA path never waits on
    // it (F12's cause was judging ON the path). Shadow: verdicts + metrics
    // land in the dedicated judge_verdicts column only; placement unchanged.
    if (isT11InflowJudgeEnabled() && result.slots.length > 0) {
      setImmediate(() => {
        void import('./inflow-judge-shadow')
          .then(({ runInflowJudgeShadow }) =>
            runInflowJudgeShadow({
              sessionId: input.sessionId,
              centerGoal: input.goal,
              subGoals: input.subGoals,
              slots: result.slots.map((sl) => ({
                videoId: sl.videoId,
                title: sl.title,
                cellIndex: sl.cellIndex,
              })),
            })
          )
          .catch(() => undefined);
      });
    }

    log.info(
      `precompute done: session=${input.sessionId} slots=${result.slots.length} ` +
        `queries=${result.queriesUsed} duration_ms=${Date.now() - t0}`,
      {
        sessionId: input.sessionId,
        slotsCount: result.slots.length,
        queriesUsed: result.queriesUsed,
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(
      `precompute failed: session=${input.sessionId} error=${msg.slice(0, 200)} duration_ms=${Date.now() - t0}`,
      {
        sessionId: input.sessionId,
        error: msg,
      }
    );
    try {
      await db.mandala_wizard_precompute.update({
        where: { session_id: input.sessionId },
        data: {
          status: 'failed',
          error_message: msg.slice(0, 2000),
        },
      });
    } catch (updateErr) {
      log.error(
        `precompute failed-status update also threw for session=${input.sessionId}: ${
          updateErr instanceof Error ? updateErr.message : String(updateErr)
        }`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// consumePrecompute — /create-with-data consume entry
// ---------------------------------------------------------------------------

export interface ConsumePrecomputeInput {
  sessionId: string;
  userId: string;
  mandalaId: string;
  /** Expected goal (from save payload). If mismatch → treat as miss. */
  centerGoal: string;
}

export interface ConsumePrecomputeResult {
  consumed: boolean;
  reason?:
    | 'disabled'
    | 'no-session-id'
    | 'not-found'
    | 'wrong-user'
    | 'not-done'
    | 'expired'
    | 'goal-mismatch'
    | 'empty-slots';
  cardsInserted?: number;
  slotsCount?: number;
}

/**
 * Consume a precompute row at mandala save time. On hit, copies slots into
 * recommendation_cache under the new mandala_id and publishes card_added
 * events through the existing cardPublisher bus (same mechanism the
 * post-creation pipeline uses, so the dashboard/SSE consumer code path is
 * unchanged).
 *
 * Miss semantics are explicit (see `reason` enum). Callers SHOULD fall back
 * to `triggerMandalaPostCreationAsync` on miss so dashboard still fills via
 * the legacy path.
 *
 * Never throws — all errors produce `{ consumed: false, reason }`.
 */
export async function consumePrecompute(
  input: ConsumePrecomputeInput
): Promise<ConsumePrecomputeResult> {
  const cfg = loadWizardPrecomputeConfig();
  if (!cfg.enabled) return { consumed: false, reason: 'disabled' };
  if (!input.sessionId) return { consumed: false, reason: 'no-session-id' };

  const db = getPrismaClient();
  let row = await db.mandala_wizard_precompute.findUnique({
    where: { session_id: input.sessionId },
  });

  if (!row) return { consumed: false, reason: 'not-found' };
  if (row.user_id !== input.userId) {
    log.warn(
      `precompute user mismatch: session=${input.sessionId} row.user=${row.user_id} req.user=${input.userId}`
    );
    return { consumed: false, reason: 'wrong-user' };
  }

  // CP436 (Issue #543) — POLL_BUDGET_MS reduced 15_000 → 1_000.
  //
  // Original CP424.2 rationale (kept for context): poll while precompute
  // is still mid-flight so consumePrecompute can hit even when user clicks
  // Step 3 sooner than discover finishes. 15s covered p95 of Tier 2.
  //
  // Why 1s: user spec — `/create-with-data` ≤1s response is mandatory for
  // wizard-dashboard SLO. Polling up to 15s blocked the response on
  // precompute fairness, exceeding spec by 15×. Sub-1s budget aligns the
  // hit window with the Tier 1 envelope only — Tier 2 misses immediately
  // fall back to `triggerMandalaPostCreationAsync` (mandala-post-creation.ts:33),
  // which fires the same v3 discover async and streams cards through
  // cardPublisher → /videos/stream SSE backlog (mandalas.ts:2284-2316).
  //
  // Trade-off: precompute hit-rate drops for the slow-Tier-2 cases; SSE
  // path absorbs the latency without blocking save. Net wizard finalize
  // p99 ≤1s when precompute is done | running-but-fast | not-needed.
  //
  // Tracking: log.info on poll-wait end captures `final_status` +
  // `waited_ms` so we can quantify miss reasons in prod log post-deploy.
  const POLL_BUDGET_MS = 6_000;
  const POLL_INTERVAL_MS = 250;
  if (row.status === 'pending' || row.status === 'running') {
    const pollStart = Date.now();
    while (
      Date.now() - pollStart < POLL_BUDGET_MS &&
      (row.status === 'pending' || row.status === 'running')
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const refreshed = await db.mandala_wizard_precompute.findUnique({
        where: { session_id: input.sessionId },
      });
      if (!refreshed) {
        // Row vanished mid-poll (TTL sweep racing — unlikely within 5s).
        return { consumed: false, reason: 'not-found' };
      }
      row = refreshed;
    }
    log.info(
      `precompute poll-wait end: session=${input.sessionId} final_status=${row.status} waited_ms=${Date.now() - pollStart}`
    );
  }

  if (row.status !== 'done') {
    scheduleAttachWatcher(input, row.status);
    return { consumed: false, reason: 'not-done' };
  }
  if (row.expires_at.getTime() < Date.now()) return { consumed: false, reason: 'expired' };

  // Goal match: allow minor whitespace / case variance but reject substantive
  // edits. Design doc §Invalidation: "consumed 시점에 goal match 검사".
  const normalize = (s: string): string => s.trim().toLowerCase();
  if (normalize(row.goal) !== normalize(input.centerGoal)) {
    log.info(
      `precompute goal mismatch: session=${input.sessionId} expected="${row.goal.slice(0, 40)}" got="${input.centerGoal.slice(0, 40)}"`
    );
    return { consumed: false, reason: 'goal-mismatch' };
  }

  // Extract slots from discover_result JSON.
  const discover = row.discover_result as unknown as EphemeralDiscoverResult | null;
  const slots = discover?.slots ?? [];
  if (slots.length === 0) {
    // Mark consumed anyway so we don't retry a known-empty result; fall back.
    await db.mandala_wizard_precompute.update({
      where: { session_id: input.sessionId },
      data: {
        status: 'consumed',
        consumed_mandala_id: input.mandalaId,
        consumed_at: new Date(),
      },
    });
    return { consumed: false, reason: 'empty-slots', slotsCount: 0 };
  }

  // Copy slots → recommendation_cache. Use INSERT … ON CONFLICT DO NOTHING
  // so the unique (user_id, mandala_id, video_id) constraint silently dedupes
  // if somehow the row already exists.
  const expiresAt = new Date(Date.now() + TTL_DAYS * MS_PER_DAY);
  const slotResults = await Promise.all(
    slots.map(async (slot) => {
      try {
        await db.$executeRaw(
          Prisma.sql`
            INSERT INTO public.recommendation_cache (
              user_id, mandala_id, cell_index, keyword, video_id, title,
              thumbnail, channel, channel_subs, view_count, like_ratio,
              duration_sec, rec_score, rec_reason, weight_version, status, expires_at,
              published_at
            )
            VALUES (
              ${input.userId}::uuid,
              ${input.mandalaId}::uuid,
              ${slot.cellIndex},
              ${''},
              ${slot.videoId},
              ${slot.title},
              ${slot.thumbnail},
              ${slot.channelName},
              ${null},
              ${slot.viewCount ? BigInt(slot.viewCount) : null},
              ${null},
              ${slot.durationSec},
              ${slot.score},
              ${'realtime'},
              ${WEIGHT_VERSION},
              ${RECOMMENDATION_STATUS_PENDING},
              ${expiresAt},
              ${slot.publishedAt != null ? new Date(String(slot.publishedAt)) : null}
            )
            ON CONFLICT (user_id, mandala_id, video_id) DO NOTHING
          `
        );
        const payload: CardPayload = {
          id: randomUUID(),
          videoId: slot.videoId,
          title: slot.title,
          channel: slot.channelName ?? null,
          thumbnail: slot.thumbnail ?? null,
          durationSec: slot.durationSec ?? null,
          recScore: slot.score,
          cellIndex: slot.cellIndex,
          cellLabel: null,
          keyword: '',
          source: 'auto_recommend',
          recReason: 'realtime',
          publishedAt:
            typeof slot.publishedAt === 'string'
              ? slot.publishedAt
              : (slot.publishedAt?.toISOString() ?? null),
          // PR3 — anchor lookup deferred to SSE backlog path on subscriber connect.
          startSec: null,
        };
        notifyCardAdded(input.mandalaId, payload);
        return true;
      } catch (err) {
        log.warn(
          `precompute consume upsert failed: session=${input.sessionId} video=${slot.videoId} error=${
            err instanceof Error ? err.message : String(err)
          }`
        );
        return false;
      }
    })
  );
  const inserted = slotResults.filter(Boolean).length;

  // Mark consumed.
  await db.mandala_wizard_precompute.update({
    where: { session_id: input.sessionId },
    data: {
      status: 'consumed',
      consumed_mandala_id: input.mandalaId,
      consumed_at: new Date(),
    },
  });

  log.info(
    `precompute consumed: session=${input.sessionId} mandala=${input.mandalaId} ` +
      `slots=${slots.length} inserted=${inserted}`
  );

  // CP436 PR-Y0c (Issue #543) — kick auto-add inline so user_video_states
  // populates without waiting for pipeline-runner step3.
  //
  // Why this exists: pipeline-runner step1 (ensureMandalaEmbeddings) blocks
  // step3 (maybeAutoAdd) and step1 currently takes ~30s end-to-end on prod
  // (Mac-mini Ollama down → OpenRouter fallback). Wizard finalize returns
  // in ~1.3s (CP436 PR-Y0a) but the dashboard shows 0 cards for the entire
  // 30s window because user_video_states is empty until step3 fires.
  //
  // The recommendation_cache rows are already INSERTed above (status='pending'),
  // so calling maybeAutoAddRecommendations here promotes them straight into
  // user_video_states + flips status='shown' so the later step3 call
  // (post-step1) sees an empty 'pending' set and no-ops cleanly.
  //
  // Race / dedup safety:
  //   - userVideoState upsert (auto-add-recommendations.ts:234) keys on
  //     @@unique([user_id, videoId]) → idempotent
  //   - status='shown' UPDATE (auto-add-recommendations.ts:299-307) prevents
  //     step3 from re-processing the same rows
  //   - user_skill_config opt-in gate is identical (skill_type='video_discover',
  //     enabled=true, config.auto_add!=false) — same opt-in posture as today
  //
  // Failure handling: log.warn + swallow. The caller (`/create-with-data`)
  // does NOT depend on auto-add success for save success; pipeline-runner
  // step3 will retry the same logic ~30s later as a safety net.
  try {
    const { maybeAutoAddRecommendations } = await import('./auto-add-recommendations');
    const { withTraceContext, recordTrace } = await import('@/modules/discover-tracing');
    // CP457+ bind trace context for auto_add.user_video_states row.
    const autoAddResult = await withTraceContext(
      { mandalaId: input.mandalaId, userId: input.userId },
      () => {
        // CP491 F5c — emit the v5 discover diagnostics as a trace keyed by
        // mandala_id (mandala did not exist at precompute time). Mirrors the
        // /add-cards `add_cards.end` shape so F3 before/after is one query
        // across both surfaces. Fire-and-forget; does not affect save SLO.
        const diag = discover?.diagnostics;
        if (diag) {
          const cellDistribution: Record<string, number> = {};
          for (const slot of slots) {
            const key = String(slot.cellIndex ?? 0);
            cellDistribution[key] = (cellDistribution[key] ?? 0) + 1;
          }
          const durMs = diag['durationMs'];
          recordTrace({
            step: 'wizard.discover.end',
            status: 'ok',
            response: {
              cards_count: slots.length,
              inserted,
              cell_distribution: cellDistribution,
              ...diag,
            },
            latencyMs: typeof durMs === 'number' ? durMs : discover?.duration_ms,
          });
        }
        return maybeAutoAddRecommendations(input.userId, input.mandalaId);
      }
    );
    log.info(
      `precompute consume → auto-add inline: ok=${autoAddResult.ok}` +
        (autoAddResult.ok
          ? ` inserted=${autoAddResult.rowsInserted ?? 0} preserved=${autoAddResult.rowsPreserved ?? 0}`
          : ` reason=${autoAddResult.reason ?? 'unknown'}`)
    );

    // CP499 — A-stage relevance trigger MUST fire on THIS path: the wizard
    // places cards via this inline auto-add, NOT pipeline-runner step3. step3
    // then sees 'no pending recommendation_cache rows' (auto-add flips them to
    // 'shown') and no-ops, so its relevance trigger (gated on result.ok) never
    // fires for wizard mandalas — #873 was mis-wired into that dead path, so
    // new wizard cards were never scored (relevance_pct stayed NULL). Mirror
    // the pipeline-runner block here: fire-and-forget, applyCutoff:false.
    // Mutually exclusive with step3 (whichever consumes the 'pending' rows
    // fires; the other gets ok:false); the trigger's relevance_pct IS NULL
    // filter is an idempotent backstop against any double-enqueue edge.
    if (autoAddResult.ok && (autoAddResult.rowsInserted ?? 0) > 0) {
      setImmediate(() => {
        void import('@/modules/relevance/relevance-backfill-trigger')
          .then(({ enqueueRelevanceBackfillForMandala }) =>
            enqueueRelevanceBackfillForMandala({
              userId: input.userId,
              mandalaId: input.mandalaId,
              applyCutoff: false,
            })
          )
          .then((r) => log.info(`relevance trigger (precompute path): enqueued=${r.enqueued}`))
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            log.warn(`relevance trigger (precompute path) failed (non-fatal): ${msg}`);
          });
      });
    }

    // CP499+ pool-serve (UX 원칙 2): after wizard placement, fill DEFICIT
    // cells from the ko pool through the semantic relevance gate. Fires on
    // THIS path for the same reason as the relevance trigger above (#879
    // flow-reach lesson) — the wizard never reaches pipeline-runner step3.
    // Fire-and-forget; flag-gated inside (V5_POOL_SERVE, default off).
    // Runs regardless of autoAddResult shape: a fully-failed auto-add IS the
    // deficit case pool-serve exists for.
    setImmediate(() => {
      void import('@/modules/queue/handlers/pool-serve-fill')
        .then(({ dispatchPoolServeForMandala }) =>
          dispatchPoolServeForMandala(input.userId, input.mandalaId)
        )
        .then((r) => {
          if (r.runId) {
            log.info(
              `pool-serve dispatched (precompute path): run=${r.runId} cells=[${r.deficitCells.join(',')}]`
            );
          }
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn(`pool-serve dispatch (precompute path) failed (non-fatal): ${msg}`);
        });
    });
  } catch (err) {
    log.warn(
      `precompute consume → auto-add inline threw (non-fatal — pipeline-runner step3 will retry): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  return { consumed: true, cardsInserted: inserted, slotsCount: slots.length };
}

// ---------------------------------------------------------------------------
// T7 — attach watcher (matrix §11-b): consume missed while the precompute was
// still running. Instead of letting the full pipeline re-run discover, wait
// for the row to turn done (≤ATTACH_BUDGET_MS) and re-consume it. On failure
// or timeout, re-trigger the pipeline; checkDiscoverPreconditions only skips
// for YOUNG in-flight rows, so this fallback cannot dead-end on its own skip.
// ---------------------------------------------------------------------------

const activeAttachSessions = new Set<string>();

function scheduleAttachWatcher(input: ConsumePrecomputeInput, statusAtMiss: string): void {
  if (!isPrecomputeAttachEnabled()) return;
  if (statusAtMiss !== 'pending' && statusAtMiss !== 'running') return; // failed/consumed: nothing to wait for
  if (activeAttachSessions.has(input.sessionId)) return;
  activeAttachSessions.add(input.sessionId);

  setImmediate(() => {
    void (async () => {
      const db = getPrismaClient();
      const t0 = Date.now();
      try {
        while (Date.now() - t0 < ATTACH_BUDGET_MS) {
          await new Promise<void>((resolve) => setTimeout(resolve, ATTACH_POLL_INTERVAL_MS));
          const row = await db.mandala_wizard_precompute.findUnique({
            where: { session_id: input.sessionId },
            select: { status: true },
          });
          if (!row || row.status === 'failed' || row.status === 'consumed') break;
          if (row.status === 'done') {
            // Re-enter consume: status=done skips the poll, inserts slots and
            // runs the same inline auto-add path as a first-try hit.
            const outcome = await consumePrecompute(input);
            log.info(
              `attach consumed after miss: session=${input.sessionId} waited_ms=${Date.now() - t0} ` +
                `consumed=${outcome.consumed} inserted=${outcome.cardsInserted ?? 0}`
            );
            if (outcome.consumed) return;
            break; // consume miss on a done row (expired/goal-mismatch) → fallback
          }
        }
        // Failed, vanished, timed out, or post-done consume miss → pipeline owns it.
        log.info(
          `attach fallback → pipeline re-trigger: session=${input.sessionId} waited_ms=${Date.now() - t0}`
        );
        const { triggerMandalaPostCreationAsync } = await import('./mandala-post-creation');
        triggerMandalaPostCreationAsync(
          input.userId,
          input.mandalaId,
          'precompute-attach-fallback'
        );
      } catch (err) {
        log.warn(
          `attach watcher threw (non-fatal): session=${input.sessionId} error=${
            err instanceof Error ? err.message : String(err)
          }`
        );
      } finally {
        activeAttachSessions.delete(input.sessionId);
      }
    })();
  });
}

/**
 * CP500+ B-1 — the user's ALREADY-OWNED youtube video ids (all mandalas).
 * Recruitment-stage exclude set for the wizard discover: uvs carries a GLOBAL
 * @@unique(user_id, videoId), so any pick the user already owns can never be
 * inserted — excluding it up front lets the picker spend the slot on a NEW
 * video instead of silently evaporating at auto-add (measured 24/39 lost).
 * Fail-open: any failure returns an empty set (= pre-CP500 behavior).
 */
export async function fetchOwnedYoutubeIds(userId: string): Promise<Set<string>> {
  try {
    const db = getPrismaClient();
    const rows = await db.$queryRaw<{ youtube_video_id: string }[]>`
      SELECT DISTINCT yv.youtube_video_id
      FROM user_video_states uvs
      JOIN youtube_videos yv ON yv.id = uvs.video_id
      WHERE uvs.user_id = ${userId}::uuid`;
    return new Set(rows.map((r) => r.youtube_video_id));
  } catch (err) {
    log.warn(
      `fetchOwnedYoutubeIds failed (fail-open, empty exclude): ${err instanceof Error ? err.message : String(err)}`
    );
    return new Set();
  }
}
