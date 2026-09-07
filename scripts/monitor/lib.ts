/**
 * Shared plumbing for the invariant checks.
 *
 * These watch for the failure this service actually has: something is wrong
 * and nothing died. Drift between the chart and the running image went eight
 * days unnoticed; the Mac Mini transcript service was down for forty-four. A
 * CPU graph shows neither, because in both cases every process was healthy.
 *
 * Two design points worth keeping:
 *
 *   State lives in `error_events`, not in a file or an Actions cache. The
 *   table already exists for exactly this ("subsystem failures that otherwise
 *   reach ONLY ephemeral winston logs"), it is queryable months later, and it
 *   is what let us answer "$36.18 on 2026-06-25" two months after the fact.
 *
 *   Alerts fire on transitions, never on state. A check that runs every thirty
 *   minutes and posts every time it is unhappy produces forty-eight messages a
 *   day, and after two days nobody reads the channel. `report()` posts when the
 *   answer changes and stays quiet otherwise.
 */

import { PrismaClient } from '@prisma/client';

/** Rows this module writes and reads are tagged with this subsystem. */
const SUBSYSTEM = 'monitor';

export interface CheckResult {
  /** Stable identifier, also the `stage` column. Do not rename casually --
   *  a rename reads as a brand new check with no history, so the first run
   *  after it alerts even when nothing changed. */
  check: string;
  ok: boolean;
  /** One line, written to be read in a Slack notification. */
  detail: string;
  /** Anything worth querying later. Kept out of `detail` so the message stays
   *  short while the ledger stays complete. */
  context?: Record<string, unknown>;
}

const prisma = new PrismaClient();

export function getPrisma(): PrismaClient {
  return prisma;
}

/**
 * The previous answer for this check, or null when it has never run.
 *
 * A first run is deliberately not an alert even when it fails: the point of
 * the first run is to establish the baseline, and a burst of notifications on
 * the day monitoring ships teaches everyone to mute it.
 */
async function lastState(check: string): Promise<boolean | null> {
  const row = await prisma.error_events.findFirst({
    where: { subsystem: SUBSYSTEM, stage: check },
    orderBy: { created_at: 'desc' },
    select: { severity: true },
  });
  if (!row) return null;
  return row.severity === 'info';
}

/** Slack, when the webhook is configured. Absence is not an error: the checks
 *  still run and still write the ledger, and a failing workflow is itself a
 *  signal GitHub delivers by mail. */
async function postToSlack(text: string): Promise<void> {
  const url = process.env['SLACK_ALERT_WEBHOOK'];
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) console.error(`slack: ${res.status} ${await res.text()}`);
  } catch (err) {
    // A notification that cannot be delivered must not fail the check that
    // produced it -- that would turn a Slack outage into a monitoring outage.
    console.error(`slack: ${String(err)}`);
  }
}

/**
 * Record the result and notify if the answer changed.
 *
 * Returns whether an alert was sent, which the runner reports so a human can
 * tell "nothing was wrong" from "something was wrong and nobody was told".
 */
export async function report(r: CheckResult): Promise<boolean> {
  const previous = await lastState(r.check);
  const changed = previous !== null && previous !== r.ok;
  const firstRun = previous === null;

  await prisma.error_events.create({
    data: {
      subsystem: SUBSYSTEM,
      stage: r.check,
      // `info` for a healthy answer so the ledger holds both edges of every
      // transition. Storing only failures would make "when did it recover?"
      // unanswerable, and that is half of every incident write-up.
      severity: r.ok ? 'info' : 'error',
      message: r.detail,
      context: (r.context ?? {}) as never,
    },
  });

  const icon = r.ok ? '✅' : '\u{1F534}';
  console.log(`${icon} ${r.check}: ${r.detail}`);

  if (!changed) {
    if (firstRun) console.log(`   (first run -- baseline recorded, not alerting)`);
    return false;
  }

  const heading = r.ok ? `*RESOLVED* — ${r.check}` : `*${r.check}*`;
  await postToSlack(`${icon} ${heading}\n${r.detail}`);
  return true;
}

/** A digest, sent on a schedule rather than on a transition. Used by the daily
 *  spend summary, which is a report and not an alarm. */
export async function postDigest(text: string): Promise<void> {
  console.log(text);
  await postToSlack(text);
}

export { SUBSYSTEM };
