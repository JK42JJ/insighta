/**
 * pipeline-runner.ts
 *
 * Tracked, idempotent mandala post-creation pipeline.
 * Each step records status + timestamp + result to mandala_pipeline_runs.
 * Supports resume-from-failure: completed steps are skipped on retry.
 *
 * Steps:
 *   1. ensureMandalaEmbeddings — generate level=1 sub_goal embeddings
 *   2. runVideoDiscover — opt-in YouTube recommendation search
 *   3. maybeAutoAddRecommendations — place top-N recs into user_video_states
 *
 * Future: replace with Temporal Activities when workflow runtime is adopted.
 */

import { skillRegistry } from '@/modules/skills';
import { getPrismaClient } from '@/modules/database';
import { createGenerationProvider } from '@/modules/llm';
import type { Tier } from '@/config/quota';
import { logger } from '@/utils/logger';
import { ensureMandalaEmbeddings } from './ensure-mandala-embeddings';
import { maybeAutoAddRecommendations } from './auto-add-recommendations';

const log = logger.child({ module: 'pipeline-runner' });

const WIZARD_SKILL_TYPE = 'video_discover';
const PLUGIN_SKILL_ID = 'video-discover';
const RECENT_DISCOVER_WINDOW_MS = 5 * 60 * 1000;

type StepStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed';

interface StepField {
  status: string;
  startedAt: string;
  endedAt: string;
  result: string;
  error: string;
}

const STEP_FIELDS: Record<number, StepField> = {
  1: {
    status: 'step1_status',
    startedAt: 'step1_started_at',
    endedAt: 'step1_ended_at',
    result: 'step1_result',
    error: 'step1_error',
  },
  2: {
    status: 'step2_status',
    startedAt: 'step2_started_at',
    endedAt: 'step2_ended_at',
    result: 'step2_result',
    error: 'step2_error',
  },
  3: {
    status: 'step3_status',
    startedAt: 'step3_started_at',
    endedAt: 'step3_ended_at',
    result: 'step3_result',
    error: 'step3_error',
  },
};

async function updateStep(
  runId: string,
  step: number,
  status: StepStatus,
  result?: unknown,
  error?: string
): Promise<void> {
  const db = getPrismaClient();
  const fields = STEP_FIELDS[step];
  if (!fields) return;

  const now = new Date();
  const data: Record<string, unknown> = {
    [fields.status]: status,
    updated_at: now,
  };

  if (status === 'running') {
    data[fields.startedAt] = now;
  }
  if (status === 'completed' || status === 'failed' || status === 'skipped') {
    data[fields.endedAt] = now;
  }
  if (result !== undefined) {
    data[fields.result] = result;
  }
  if (error !== undefined) {
    data[fields.error] = error;
  }

  await db.mandala_pipeline_runs.update({ where: { id: runId }, data });
}

async function markRunStatus(runId: string, status: string, completedAt?: Date): Promise<void> {
  const db = getPrismaClient();
  const data: Record<string, unknown> = { status, updated_at: new Date() };
  if (completedAt) data['completed_at'] = completedAt;
  await db.mandala_pipeline_runs.update({ where: { id: runId }, data });
}

/**
 * Execute pipeline run with resume semantics.
 * Completed steps are skipped — only pending/failed steps execute.
 */
export async function executePipelineRun(runId: string): Promise<void> {
  const db = getPrismaClient();
  const run = await db.mandala_pipeline_runs.findUnique({ where: { id: runId } });
  if (!run) {
    log.warn(`Pipeline run not found: ${runId}`);
    return;
  }

  const { mandala_id: mandalaId, user_id: userId } = run;
  log.info(`Pipeline run started: ${runId} mandala=${mandalaId} trigger=${run.trigger}`);

  await markRunStatus(runId, 'running');

  // ── Step 1: Embeddings ──────────────────────────────────────
  let embeddingsReady = run.step1_status === 'completed';

  if (!embeddingsReady) {
    await updateStep(runId, 1, 'running');
    try {
      const EMBEDDING_TIMEOUT_MS = 30_000;
      const result = await Promise.race([
        ensureMandalaEmbeddings(mandalaId),
        new Promise<{ ok: false; reason: string }>((resolve) =>
          setTimeout(
            () => resolve({ ok: false, reason: `embedding timeout ${EMBEDDING_TIMEOUT_MS}ms` }),
            EMBEDDING_TIMEOUT_MS
          )
        ),
      ]);
      if (result.ok) {
        embeddingsReady = true;
        await updateStep(runId, 1, 'completed', result);
        log.info(
          `[${runId}] step1 completed: ${result.finalCount}/8 embeddings (${result.embedMs ?? 0}ms)`
        );
      } else {
        await updateStep(runId, 1, 'failed', result, result.reason ?? 'unknown');
        log.warn(`[${runId}] step1 failed: ${result.reason}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateStep(runId, 1, 'failed', null, msg);
      log.warn(`[${runId}] step1 threw: ${msg}`);
    }
  }

  if (!embeddingsReady) {
    await updateStep(runId, 2, 'skipped', null, 'embeddings not ready');
    await updateStep(runId, 3, 'skipped', null, 'embeddings not ready');
    await markRunStatus(runId, 'partial');
    log.info(`[${runId}] pipeline partial — step1 failed, steps 2-3 skipped`);
    return;
  }

  // ── Step 2: Video Discover (opt-in gated) ───────────────────
  let discoverSuccess = run.step2_status === 'completed';

  if (!discoverSuccess) {
    await updateStep(runId, 2, 'running');
    try {
      const skipReason = await checkDiscoverPreconditions(userId, mandalaId);
      if (skipReason) {
        await updateStep(runId, 2, 'skipped', { reason: skipReason });
        log.info(`[${runId}] step2 skipped: ${skipReason}`);
      } else {
        const sub = await db.user_subscriptions.findUnique({
          where: { user_id: userId },
          select: { tier: true },
        });
        const tier = (sub?.tier ?? 'free') as Tier;
        const llm = await createGenerationProvider();

        const t0 = Date.now();
        const result = await skillRegistry.execute(PLUGIN_SKILL_ID, {
          userId,
          mandalaId,
          tier,
          llm,
        });
        const wallMs = Date.now() - t0;

        if (result.success) {
          discoverSuccess = true;
          await updateStep(runId, 2, 'completed', { ...result.data, duration_ms: wallMs });
          log.info(`[${runId}] step2 completed in ${wallMs}ms`);
        } else {
          await updateStep(runId, 2, 'failed', result.data, result.error ?? 'unknown');
          log.warn(`[${runId}] step2 failed: ${result.error}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateStep(runId, 2, 'failed', null, msg);
      log.warn(`[${runId}] step2 threw: ${msg}`);
    }
  }

  // ── Step 3: Auto-Add Recommendations ────────────────────────
  if (run.step3_status !== 'completed') {
    if (!discoverSuccess && run.step2_status !== 'skipped') {
      // Step 2 failed (not skipped) → skip step 3
      await updateStep(runId, 3, 'skipped', null, 'discover failed');
    } else {
      await updateStep(runId, 3, 'running');
      try {
        const result = await maybeAutoAddRecommendations(userId, mandalaId);
        if (result.ok) {
          await updateStep(runId, 3, 'completed', result);
          log.info(
            `[${runId}] step3 completed: ${result.rowsInserted} inserted, ${result.rowsPreserved} preserved`
          );
        } else {
          await updateStep(runId, 3, 'completed', result); // not-applicable ≠ failed
          log.info(`[${runId}] step3 skipped: ${result.reason}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await updateStep(runId, 3, 'failed', null, msg);
        log.warn(`[${runId}] step3 threw: ${msg}`);
      }
    }
  }

  // ── Final status ────────────────────────────────────────────
  const finalRun = await db.mandala_pipeline_runs.findUnique({ where: { id: runId } });
  const anyFailed = [finalRun?.step1_status, finalRun?.step2_status, finalRun?.step3_status].some(
    (s) => s === 'failed'
  );

  if (anyFailed) {
    await markRunStatus(runId, 'partial');
    log.info(`[${runId}] pipeline partial — one or more steps failed`);
  } else {
    await markRunStatus(runId, 'completed', new Date());
    log.info(`[${runId}] pipeline completed`);
  }
}

/**
 * Check video-discover preconditions. Returns skip reason or null if OK.
 */
async function checkDiscoverPreconditions(
  userId: string,
  mandalaId: string
): Promise<string | null> {
  const db = getPrismaClient();

  // Dedup gate
  const cutoff = new Date(Date.now() - RECENT_DISCOVER_WINDOW_MS);
  const recent = await db.recommendation_cache.findFirst({
    where: { mandala_id: mandalaId, created_at: { gt: cutoff } },
    select: { id: true },
  });
  if (recent) return 'recent discover within 5min window';

  // Opt-in gate
  const config = await db.user_skill_config.findFirst({
    where: { user_id: userId, mandala_id: mandalaId, skill_type: WIZARD_SKILL_TYPE },
    select: { enabled: true },
  });
  if (!config?.enabled) return 'video_discover not enabled';

  return null;
}

/**
 * Create a pipeline run record and return its ID.
 */
export async function createPipelineRun(
  mandalaId: string,
  userId: string,
  trigger: string = 'wizard'
): Promise<string> {
  const db = getPrismaClient();
  const run = await db.mandala_pipeline_runs.create({
    data: { mandala_id: mandalaId, user_id: userId, trigger },
  });
  return run.id;
}
