/**
 * Weekly curation scheduler (Growth Hub, 2026-07-16). SCAFFOLD.
 *
 * boss.schedule cron scan (same pattern as batch-scan / collapse-watch /
 * key-alarm): find due subscriptions (is_active AND next_run_at <= now) and fan
 * out one CURATION_BUILD each (singletonKey per subscription dedups).
 *
 * "immediate" (James): a NEW subscription enqueues CURATION_BUILD immediately at
 * create time (see subscription create route, separate) — this weekly job is
 * the recurring refresh, not the first build.
 */

import { logger } from '@/utils/logger';
import { getPrismaClient } from '@/modules/database/client';
import { JOB_NAMES, QUEUE_CONFIG } from '../types';
import { getJobQueue } from '../manager';
import { enqueueCurationBuild } from './curation-build';

const log = logger.child({ module: 'queue/curation-weekly' });

/** ISO date (YYYY-MM-DD) of the Monday of `d`'s week — the week_of snapshot key. */
function mondayOf(d: Date): string {
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day; // back to Monday
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() + diff);
  return mon.toISOString().slice(0, 10);
}

export async function registerCurationWeeklyWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();
  await boss.schedule(JOB_NAMES.CURATION_WEEKLY, QUEUE_CONFIG.CURATION_WEEKLY_CRON);

  boss.work(JOB_NAMES.CURATION_WEEKLY, async () => {
    const prisma = getPrismaClient();
    const now = new Date();
    const due = await prisma.curation_subscriptions.findMany({
      where: { is_active: true, next_run_at: { lte: now } },
      select: { id: true },
    });
    const weekOf = mondayOf(now);
    for (const sub of due) {
      await enqueueCurationBuild({ subscriptionId: sub.id, weekOf });
    }
    log.info('curation weekly scan', { due: due.length, weekOf });
  });
}
