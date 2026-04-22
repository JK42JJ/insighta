/**
 * mandala-post-creation
 *
 * Entry point for the mandala post-creation pipeline. Creates a tracked
 * pipeline run record and dispatches execution via setImmediate.
 *
 * Pipeline steps (tracked in mandala_pipeline_runs):
 *   1. ensureMandalaEmbeddings — generate level=1 sub_goal embeddings
 *   2. runVideoDiscover — opt-in YouTube recommendation search
 *   3. maybeAutoAddRecommendations — place top-N recs into user_video_states
 *
 * Each step records status + timestamp + result for:
 *   - Resume-from-failure (retry picks up where it left off)
 *   - Audit trail (paid service evidence)
 *   - Admin dashboard visibility
 *   - Future Temporal migration
 *
 * The wizard response MUST NOT wait for any step.
 */

import { logger } from '@/utils/logger';
import { createPipelineRun, executePipelineRun } from './pipeline-runner';

const log = logger.child({ module: 'mandala-post-creation' });

/**
 * Fire-and-forget post-creation pipeline. Returns void synchronously;
 * the actual work runs on the next event loop tick via `setImmediate`.
 *
 * Creates a mandala_pipeline_runs record for tracking, then dispatches.
 * ALWAYS safe to call — all failure modes are logged and swallowed.
 */
export function triggerMandalaPostCreationAsync(
  userId: string,
  mandalaId: string,
  trigger: string = 'wizard'
): void {
  setImmediate(() => {
    // Phase 1 (2026-04-22): run the main pipeline (embeddings → discover →
    // auto-add) in parallel with missing-actions fill. The two tracks are
    // independent — actions populate `user_mandala_levels.subjects` while
    // the pipeline drives `recommendation_cache`. Both fire-and-forget;
    // failures in one do not stall the other. User's "최고의 카드 빠르게"
    // priority puts the pipeline on the faster path (cards) while actions
    // fill in progressively for the edit view.
    (async () => {
      const runId = await createPipelineRun(mandalaId, userId, trigger);
      log.info(`Pipeline run created: ${runId} mandala=${mandalaId} trigger=${trigger}`);
      await executePipelineRun(runId);
    })().catch((err) => {
      log.warn(
        `post-creation pipeline crashed for user=${userId} mandala=${mandalaId}: ${err instanceof Error ? err.message : String(err)}`
      );
    });

    (async () => {
      // Lazy require so that test-time module graphs that do not need the
      // generator / OpenRouter imports (e.g. `mandala-post-creation.test.ts`
      // which mocks only a narrow surface) are not forced to resolve them.
      const { fillMissingActionsIfNeeded } = await import('./fill-missing-actions');
      const result = await fillMissingActionsIfNeeded(mandalaId);
      log.info(
        `actions-fill result for mandala=${mandalaId}: ${JSON.stringify({
          action: result.action,
          cellsFilled: result.cellsFilled ?? 0,
        })}`
      );
    })().catch((err) => {
      log.warn(
        `fill-missing-actions crashed for user=${userId} mandala=${mandalaId}: ${err instanceof Error ? err.message : String(err)}`
      );
    });

    // Lever A (CP416) — ontology edge sync moved out of the create txn.
    // Triggers `trg_goal_edge` / `trg_topic_edges` were dropped by
    // migration 011 because their per-row sub-queries (~210 total for a
    // 9-level mandala) were the primary cause of the 7s wizard save.
    // Edges land ~100-500ms after commit via `syncOntologyEdges`; no
    // wizard/dashboard reader depends on them synchronously. See
    // `docs/design/ontology-trigger-defer.md`.
    (async () => {
      const { syncOntologyEdges } = await import('@/modules/ontology/sync-edges');
      const result = await syncOntologyEdges(mandalaId);
      log.info(
        `ontology-edges sync for mandala=${mandalaId}: ${JSON.stringify({
          ok: result.ok,
          goal: result.goalEdgesCreated,
          topic: result.topicEdgesCreated,
          ms: result.durationMs,
        })}`
      );
    })().catch((err) => {
      log.warn(
        `sync-ontology-edges crashed for user=${userId} mandala=${mandalaId}: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  });
}
