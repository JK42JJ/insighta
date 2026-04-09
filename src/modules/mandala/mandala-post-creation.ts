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
    (async () => {
      const runId = await createPipelineRun(mandalaId, userId, trigger);
      log.info(`Pipeline run created: ${runId} mandala=${mandalaId} trigger=${trigger}`);
      await executePipelineRun(runId);
    })().catch((err) => {
      log.warn(
        `post-creation pipeline crashed for user=${userId} mandala=${mandalaId}: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  });
}
