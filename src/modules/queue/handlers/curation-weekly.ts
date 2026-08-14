/**
 * Weekly curation scheduler (Growth Hub, 2026-07-16).
 *
 * boss.schedule cron scan (same pattern as batch-scan / collapse-watch /
 * key-alarm): find due subscriptions and fan out one CURATION_BUILD each
 * (singletonKey per subscription dedups).
 *
 * "immediate" (James): a NEW subscription enqueues CURATION_BUILD immediately at
 * create time (see subscription create route, separate) — this weekly job is
 * the recurring refresh, not the first build.
 *
 * Due semantics depend on `curationSchedule.kstEnabled` (2026-07-27):
 *
 *   off (shipped behaviour) — scan Sundays only, due = next_run_at <= now.
 *     The scan and the due time are two different clocks, so a due time landing
 *     between scans waits for the next one (measured effective period 8-14 days).
 *     The 2026-07-26 scan ran in 92ms, found 0 due rows and built nothing.
 *
 *   on — scan daily, due = today's KST weekday matches the subscription's
 *     `weekday` AND this KST week has not been built yet. No time arithmetic, so
 *     nothing drifts; any chosen weekday fires exactly once a week.
 */

import { logger } from '@/utils/logger';
import { getPrismaClient } from '@/modules/database/client';
import { config } from '../../../config';
import { kstDow, kstWeekStart, kstWeekStartInstant, utcWeekStart } from '@/utils/kst';
import { JOB_NAMES, QUEUE_CONFIG } from '../types';
import { getJobQueue } from '../manager';
import { enqueueCurationBuild } from './curation-build';

const log = logger.child({ module: 'queue/curation-weekly' });

/** Week snapshot key for a build starting now. */
export function curationWeekKey(now: Date): string {
  return config.curationSchedule.kstEnabled ? kstWeekStart(now) : utcWeekStart(now);
}

/** Subscriptions that should be refreshed at `now`. Exported for unit tests. */
export async function findDueSubscriptions(
  prisma: ReturnType<typeof getPrismaClient>,
  now: Date
): Promise<Array<{ id: string }>> {
  if (!config.curationSchedule.kstEnabled) {
    return prisma.curation_subscriptions.findMany({
      where: { is_active: true, next_run_at: { lte: now } },
      select: { id: true },
    });
  }
  // Calendar-driven: right weekday, and this KST week not built yet.
  return prisma.curation_subscriptions.findMany({
    where: {
      is_active: true,
      weekday: kstDow(now),
      OR: [{ last_run_at: null }, { last_run_at: { lt: kstWeekStartInstant(now) } }],
    },
    select: { id: true },
  });
}

export async function registerCurationWeeklyWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();
  const cron = config.curationSchedule.kstEnabled
    ? QUEUE_CONFIG.CURATION_DAILY_CRON
    : QUEUE_CONFIG.CURATION_WEEKLY_CRON;
  await boss.schedule(JOB_NAMES.CURATION_WEEKLY, cron);

  await boss.work(JOB_NAMES.CURATION_WEEKLY, async () => {
    const prisma = getPrismaClient();
    const now = new Date();
    const due = await findDueSubscriptions(prisma, now);
    const weekOf = curationWeekKey(now);
    for (const sub of due) {
      await enqueueCurationBuild({ subscriptionId: sub.id, weekOf });
    }
    log.info('curation weekly scan', {
      due: due.length,
      weekOf,
      mode: config.curationSchedule.kstEnabled ? 'kst' : 'legacy',
      kstDow: kstDow(now),
    });
  });
}
