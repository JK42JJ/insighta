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
export type { EnrichVideoPayload, BatchScanPayload } from './types';
export { enqueueEnrichVideo } from './handlers/enrich-video';

import { getJobQueue } from './manager';
import { registerEnrichVideoWorker } from './handlers/enrich-video';
import { registerBatchScanWorker } from './handlers/batch-scan';
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

  logger.info('Job queue fully initialized (pg-boss + 2 workers)');
}
