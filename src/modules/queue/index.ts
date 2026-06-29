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

import { getJobQueue } from './manager';
import { registerEnrichVideoWorker } from './handlers/enrich-video';
import { registerBatchScanWorker } from './handlers/batch-scan';
import { registerEnrichRichSummaryWorker } from './handlers/enrich-rich-summary';
import { registerBatchVideoCollectorWorker } from './handlers/batch-video-collector';
import { registerPoolMaintenanceWorker } from './handlers/pool-maintenance';
import { registerEnrichRelevanceQuickWorker } from './handlers/enrich-relevance-quick';
import { registerPoolServeFillWorker } from './handlers/pool-serve-fill';
import { registerMandalaActionsFillWorker } from './handlers/mandala-actions-fill';
import { registerMandalaBookFillWorker } from './handlers/mandala-book-fill';
import { registerTranslateMandalaBulkWorker } from './handlers/translate-mandala-bulk';
import { registerSegmentRelevanceFillWorker } from './handlers/segment-relevance-fill';
import { registerDeckBuildWorker } from './handlers/deck-build';
import { registerNoteCvEnrichWorker } from './handlers/note-cv-enrich';
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
  await registerMandalaBookFillWorker();
  await registerTranslateMandalaBulkWorker();
  await registerSegmentRelevanceFillWorker();
  await registerDeckBuildWorker();
  await registerNoteCvEnrichWorker();

  logger.info('Job queue fully initialized (pg-boss + 13 workers)');
}
