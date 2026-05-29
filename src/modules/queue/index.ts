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
} from './types';
export { enqueueEnrichVideo } from './handlers/enrich-video';
export { enqueueEnrichRichSummary } from './handlers/enrich-rich-summary';
export { enqueueBatchVideoCollectorRun } from './handlers/batch-video-collector';

import { getJobQueue } from './manager';
import { registerEnrichVideoWorker } from './handlers/enrich-video';
import { registerBatchScanWorker } from './handlers/batch-scan';
import { registerEnrichRichSummaryWorker } from './handlers/enrich-rich-summary';
import { registerBatchVideoCollectorWorker } from './handlers/batch-video-collector';
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

  logger.info('Job queue fully initialized (pg-boss + 4 workers)');
}
