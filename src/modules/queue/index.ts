/**
 * Job Queue Module — pg-boss based persistent job scheduling.
 *
 * Entry point: call initJobQueue() during server startup.
 * This starts pg-boss and registers all job workers + schedules.
 *
 * @see docs/design/job-queue-design.md
 */

export { getJobQueue, JobQueueManager } from './manager';
export { JOB_NAMES, QUEUE_CONFIG } from './types';
export type {
  EnrichVideoPayload,
  BatchScanPayload,
  EnrichRichSummaryPayload,
  BatchVideoCollectorRunPayload,
  PoolMaintenanceRunPayload,
  RelevanceQuickPayload,
} from './types';
export { enqueueEnrichVideo } from './handlers/enrich-video';
export { enqueueEnrichRichSummary } from './handlers/enrich-rich-summary';
export { enqueueBatchVideoCollectorRun } from './handlers/batch-video-collector';
export { enqueuePoolMaintenanceRun } from './handlers/pool-maintenance';
export { enqueueRelevanceQuick } from './handlers/enrich-relevance-quick';
export { enqueueNoteCvEnrich } from './handlers/note-cv-enrich';
export { enqueueEpisodeNarrationRender } from './handlers/episode-narration-render';

import { getJobQueue } from './manager';
import { registerEnrichVideoWorker } from './handlers/enrich-video';
import { registerBatchScanWorker } from './handlers/batch-scan';
import { registerEnrichRichSummaryWorker } from './handlers/enrich-rich-summary';
import { registerBatchVideoCollectorWorker } from './handlers/batch-video-collector';
import { registerPoolMaintenanceWorker } from './handlers/pool-maintenance';
import { registerEnrichRelevanceQuickWorker } from './handlers/enrich-relevance-quick';
import { registerPoolServeFillWorker } from './handlers/pool-serve-fill';
import { registerMandalaActionsFillWorker } from './handlers/mandala-actions-fill';
import { registerMandalaPipelineWorker } from './handlers/mandala-pipeline';
import { registerMandalaBookFillWorker } from './handlers/mandala-book-fill';
import { registerEpisodeNarrationRenderWorker } from './handlers/episode-narration-render';
import { registerJudgeDeboostWorker } from './handlers/judge-deboost';
import { registerTranslateMandalaBulkWorker } from './handlers/translate-mandala-bulk';
import { registerSegmentRelevanceFillWorker } from './handlers/segment-relevance-fill';
import { registerDeckBuildWorker } from './handlers/deck-build';
import { registerNoteCvEnrichWorker } from './handlers/note-cv-enrich';
import { registerKeyAlarmWorker } from './handlers/key-alarm';
import { registerSearchMetricsRollupWorker } from './handlers/search-metrics-rollup';
import { registerCollapseWatchWorker } from './handlers/collapse-watch';
import { logger } from '../../utils/logger';

/**
 * Initialize the job queue system.
 * Starts pg-boss, registers workers, sets up schedules.
 * Call during server startup, after database connection is established.
 */
export async function initJobQueue(): Promise<void> {
  const queue = getJobQueue();

  // Start pg-boss (creates schema on first run)
  await queue.start();

  // Register workers
  await registerEnrichVideoWorker();
  await registerBatchScanWorker();
  await registerEnrichRichSummaryWorker();
  await registerBatchVideoCollectorWorker();
  await registerPoolMaintenanceWorker();
  await registerEnrichRelevanceQuickWorker();
  await registerPoolServeFillWorker();
  await registerMandalaActionsFillWorker();
  await registerMandalaPipelineWorker();
  await registerMandalaBookFillWorker();
  await registerEpisodeNarrationRenderWorker();
  await registerJudgeDeboostWorker();
  await registerTranslateMandalaBulkWorker();
  await registerSegmentRelevanceFillWorker();
  await registerDeckBuildWorker();
  await registerNoteCvEnrichWorker();
  await registerKeyAlarmWorker();
  await registerSearchMetricsRollupWorker();
  await registerCollapseWatchWorker();

  logger.info('Job queue fully initialized (pg-boss + 17 workers)');

  // Performance-monitor PR1 — boot self-report (fire-and-forget, flag-gated
  // no-op when CONFIG_CHANGE_EVENTS_ENABLED is unset). Records git_sha + flag
  // fingerprint diff as a timeline event; covers deploys, pin swaps, flag flips.
  setImmediate(() => {
    void import('@/modules/observability/config-change-events')
      .then(({ reportBootConfigEvent }) => reportBootConfigEvent())
      .catch(() => undefined);
  });
}
