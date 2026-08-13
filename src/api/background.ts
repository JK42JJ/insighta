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

  if (runsQueueWorkers()) {
    try {
      await initJobQueue();
      log.info('JobQueue initialized (pg-boss + enrich-video + batch-scan)');
    } catch (err) {
      log.warn({ err }, 'JobQueue init failed (non-fatal)');
    }
  } else {
    // pg-boss needs session-mode connections, the scarce kind on Supabase.
    // Leaving them to the worker deployment keeps the web tier's connection
    // cost to the Prisma pool alone.
    log.info('JobQueue skipped (RUN_QUEUE_WORKERS=false)');
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
  if (runsQueueWorkers()) {
    try {
      await getJobQueue().stop();
    } catch {
      /* ignore */
    }
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
