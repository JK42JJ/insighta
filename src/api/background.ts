/**
 * Background work startup and shutdown, shared by the web and worker
 * entrypoints so the set of things that run is declared once.
 *
 * Two roles, selected by environment (see config/process-role.ts):
 *
 *   queue workers   pg-boss consumers. Safe in any number of processes --
 *                   pg-boss hands each job to one consumer, and its cron
 *                   ticks collapse across processes via singletonKey.
 *   schedulers      node-cron. Their overlap guards are per-process
 *                   variables, so exactly one process may run them.
 *
 * Both default on, which reproduces the single-container behaviour.
 */

import { initJobQueue, getJobQueue } from '../modules/queue';
import { getAutoSyncScheduler } from '../modules/scheduler/auto-sync';
import {
  startRichSummaryV2Cron,
  stopRichSummaryV2Cron,
} from '../modules/scheduler/rich-summary-v2-cron';
import {
  startYouTubeMetadataCron,
  stopYouTubeMetadataCron,
} from '../modules/scheduler/youtube-metadata-cron';
import {
  startV2QualityAuditCron,
  stopV2QualityAuditCron,
} from '../modules/scheduler/v2-quality-audit-cron';
import {
  startV2QualityRegenCron,
  stopV2QualityRegenCron,
} from '../modules/scheduler/v2-quality-regen-cron';
import { runsQueueWorkers, runsSchedulers, describeProcessRole } from '../config/process-role';

/** Minimal logger shape, so this works with fastify's logger or console. */
export interface BackgroundLogger {
  info(msg: string): void;
  warn(obj: unknown, msg: string): void;
}

/** Each cron is individually flag-gated inside its own module; these are the entry points. */
const CRONS: Array<{ name: string; start: () => void; stop: () => void }> = [
  // CP437 — Rich Summary v2 backfill of v2 columns. Default OFF.
  { name: 'RichSummaryV2Cron', start: startRichSummaryV2Cron, stop: stopRichSummaryV2Cron },
  // CP437 — YouTube metadata backfill (videos.list parts expansion). Default OFF.
  { name: 'YouTubeMetadataCron', start: startYouTubeMetadataCron, stop: stopYouTubeMetadataCron },
  // CP488+ — daily score scan of v2 rows. Default OFF.
  { name: 'V2QualityAuditCron', start: startV2QualityAuditCron, stop: stopV2QualityAuditCron },
  // CP488+ Phase 3 — drains the regen queue the audit populates. Default OFF.
  { name: 'V2QualityRegenCron', start: startV2QualityRegenCron, stop: stopV2QualityRegenCron },
];

export async function startBackgroundWork(log: BackgroundLogger): Promise<void> {
  log.info(`Process role: ${describeProcessRole()}`);

  // Started in every process, with or without handlers.
  //
  // This used to be skipped entirely when RUN_QUEUE_WORKERS was false, to keep
  // session-mode connections on the worker deployment. That reasoning was
  // sound and the conclusion was wrong: the api serves the endpoints that
  // *enqueue*, and pg-boss `send()` throws unless the client is started. From
  // the web/worker split until 2026-08-19 every internal trigger endpoint
  // returned 500 with "JobQueue not started", which took out
  // batch-video-collector and pool-maintenance nightly and had no symptom
  // beyond two red workflows among several red for other reasons.
  //
  // The connection cost is answered by sizing rather than by absence: a
  // producer opens QUEUE_CONFIG.PRODUCER_POOL_MAX, not pg-boss's default of
  // 10, and runs neither the supervisor nor the scheduler.
  try {
    await initJobQueue({ registerWorkers: runsQueueWorkers() });
    log.info(
      runsQueueWorkers()
        ? 'JobQueue initialized (pg-boss + handlers)'
        : 'JobQueue initialized (producer only -- enqueue works, handlers run on the worker)'
    );
  } catch (err) {
    log.warn({ err }, 'JobQueue init failed (non-fatal)');
  }

  if (!runsSchedulers()) {
    log.info('Schedulers skipped (RUN_SCHEDULERS=false)');
    return;
  }

  try {
    await getAutoSyncScheduler().start();
    log.info('AutoSyncScheduler started');
  } catch (err) {
    log.warn({ err }, 'AutoSyncScheduler init failed (non-fatal)');
  }

  for (const c of CRONS) {
    try {
      c.start();
    } catch (err) {
      log.warn({ err }, `${c.name} init failed (non-fatal)`);
    }
  }
}

export async function stopBackgroundWork(log: BackgroundLogger): Promise<void> {
  // Unconditional, to match startBackgroundWork: a producer holds a pool too,
  // and leaving it open on shutdown holds session-mode connections until the
  // server times them out.
  try {
    await getJobQueue().stop();
  } catch {
    /* ignore */
  }

  if (!runsSchedulers()) return;

  try {
    await getAutoSyncScheduler().stop();
  } catch {
    /* ignore */
  }

  for (const c of CRONS) {
    try {
      c.stop();
    } catch {
      /* ignore */
    }
  }
  log.info('Background work stopped');
}
