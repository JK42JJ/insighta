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
const SUBSYSTEM = 'keel';

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
 * The previous answers for this check, newest first. Empty when it has never run.
 *
 * A first run is deliberately not an alert even when it fails: the point of
 * the first run is to establish the baseline, and a burst of notifications on
 * the day monitoring ships teaches everyone to mute it.
 */
async function recentStates(check: string, take: number): Promise<boolean[]> {
  const rows = await prisma.error_events.findMany({
    where: { subsystem: SUBSYSTEM, stage: check },
    orderBy: { created_at: 'desc' },
    take,
    select: { severity: true },
  });
  return rows.map((r) => r.severity === 'info');
}

/**
 * How many consecutive observations of the new answer it takes to call it a
 * transition.
 *
 * One is what this had, and one is wrong for a probe: transcript-proxies flipped
 * 8 times in 13 runs (measured 2026-09-21) on an App Service instance waking up,
 * and every flip was an alert and a red workflow -- in both directions, so red
 * did not even mean "something broke". Two consecutive agreeing observations
 * cost one cycle of delay, 30 minutes, against failure modes this service
 * measures in days.
 */
export const TRANSITION_CONFIRMATIONS = 2;

/**
 * Whether `current` is a confirmed transition, given the previous answers
 * newest-first.
 *
 * Pure, and the reason this is not inline: the truth table is the whole design.
 *   history [] -> baseline, never a transition
 *   history [x] -> only one prior answer; not enough to confirm anything
 *   history [a, b] with current c: a transition when c === a and a !== b --
 *   the change first seen at `a` has now been seen twice, so it is not a flap.
 */
export function isConfirmedTransition(history: boolean[], current: boolean): boolean {
  if (history.length < TRANSITION_CONFIRMATIONS) return false;
  const [previous, beforeThat] = history;
  return current === previous && previous !== beforeThat;
}

/**
 * What happened to an alert. `unconfigured` is not a synonym for `sent`, which
 * is what the previous shape made it: `report()` returned true whether or not
 * anything left the process, so a run with no webhook printed
 * "1 alert(s) sent" and nobody had been told. Every delivery outcome is now
 * named, and the runner prints the name.
 */
export type Delivery =
  | { state: 'sent' }
  | { state: 'unconfigured' }
  | { state: 'failed'; reason: string };

/** True when a channel exists to deliver to at all. */
export function alertChannelConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env['SLACK_ALERT_WEBHOOK'] ?? '').length > 0;
}

/** Slack, when the webhook is configured. A delivery that fails must not fail
 *  the check that produced it -- that would turn a Slack outage into a
 *  monitoring outage -- so the outcome is returned rather than thrown. */
async function postToSlack(text: string): Promise<Delivery> {
  const url = process.env['SLACK_ALERT_WEBHOOK'];
  if (!url) return { state: 'unconfigured' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (res.ok) return { state: 'sent' };
    const body = (await res.text()).slice(0, 200);
    return { state: 'failed', reason: `HTTP ${res.status} ${body}` };
  } catch (err) {
    return { state: 'failed', reason: String(err) };
  }
}

/** What `report()` did, for the runner's summary and its exit code. */
export interface Reported {
  /** A confirmed transition was seen and an alert was attempted. */
  alerted: boolean;
  /** What happened to that alert. Absent when there was nothing to deliver. */
  delivery?: Delivery;
}

/**
 * Record the result and notify if the answer changed and stayed changed.
 *
 * Returns what happened, which the runner reports so a human can tell "nothing
 * was wrong" from "something was wrong and nobody was told" -- the second of
 * which this could not previously express.
 */
export async function report(r: CheckResult): Promise<Reported> {
  const history = await recentStates(r.check, TRANSITION_CONFIRMATIONS);
  const confirmed = isConfirmedTransition(history, r.ok);

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

  if (!confirmed) {
    if (history.length === 0) {
      console.log(`   (first run -- baseline recorded, not alerting)`);
    } else if (history.length > 0 && history[0] !== r.ok) {
      // Said out loud because it is the flap the old policy alerted on.
      console.log(`   (changed once -- waiting for a second run to agree)`);
    }
    return { alerted: false };
  }

  const heading = r.ok ? `*RESOLVED* — ${r.check}` : `*${r.check}*`;
  const delivery = await postToSlack(`${icon} ${heading}\n${r.detail}`);
  if (delivery.state !== 'sent') {
    const detail =
      delivery.state === 'unconfigured'
        ? 'no alert channel configured (SLACK_ALERT_WEBHOOK)'
        : `delivery failed: ${delivery.reason}`;
    console.error(`   🔴 ${r.check} alert NOT delivered — ${detail}`);
    // Written to the ledger so the next run's alert-delivery check can see it,
    // and so "was anyone told?" is answerable months later.
    await prisma.error_events.create({
      data: {
        subsystem: SUBSYSTEM,
        stage: ALERT_DISPATCH_STAGE,
        severity: 'error',
        message: `${r.check}: ${detail}`,
        context: { check: r.check, state: delivery.state } as never,
      },
    });
  }
  return { alerted: true, delivery };
}

/** The alert-delivery check's own name, and the stage its observations go to. */
export const ALERT_DELIVERY_STAGE = 'alert-delivery';

/**
 * Ledger stage for delivery outcomes. Deliberately not the check's name.
 *
 * It was the check's name for one hour on 2026-09-21, and that hour is the whole
 * reason this constant exists. `report()` writes one observation row per check
 * under `stage = check`, and it wrote delivery failures under the same string --
 * so the alert-delivery check read its own failure rows as its observation
 * history, `lastDeliveryFailure()` matched the row the check had just produced,
 * and one run left two rows under one stage. Measured in the ledger at 14:11 KST:
 *
 *   alert-delivery  error  no alert channel configured (SLACK_ALERT_WEBHOOK) ...
 *   alert-delivery  error  transcript-proxies: no alert channel configured ...
 *
 * A stage is a series. Two writers on one series is not a series.
 */
export const ALERT_DISPATCH_STAGE = 'alert-dispatch';

/**
 * Whether the most recent delivery attempt failed, and what it said.
 *
 * Read from the ledger rather than held in memory because a delivery failure in
 * one run has to be visible in the next one: the run that could not deliver is
 * also the run that cannot tell anyone it could not deliver.
 */
export async function lastDeliveryFailure(): Promise<{ at: Date; message: string } | null> {
  const row = await prisma.error_events.findFirst({
    where: { subsystem: SUBSYSTEM, stage: ALERT_DISPATCH_STAGE, severity: 'error' },
    orderBy: { created_at: 'desc' },
    select: { created_at: true, message: true },
  });
  return row ? { at: row.created_at, message: row.message ?? '' } : null;
}

/**
 * When a failing check last answered `info`, i.e. how long it has been failing.
 *
 * A check that has been red since before the ledger's first row returns null.
 * Used for the standing-failures summary: an edge-triggered policy says nothing
 * about a failure that never stops, and those are the ones that get forgotten.
 */
export async function failingSince(check: string): Promise<Date | null> {
  const lastHealthy = await prisma.error_events.findFirst({
    where: { subsystem: SUBSYSTEM, stage: check, severity: 'info' },
    orderBy: { created_at: 'desc' },
    select: { created_at: true },
  });
  if (!lastHealthy) return null;
  const firstErrorAfter = await prisma.error_events.findFirst({
    where: {
      subsystem: SUBSYSTEM,
      stage: check,
      severity: 'error',
      created_at: { gt: lastHealthy.created_at },
    },
    orderBy: { created_at: 'asc' },
    select: { created_at: true },
  });
  return firstErrorAfter?.created_at ?? null;
}

/** A digest, sent on a schedule rather than on a transition. Used by the daily
 *  spend summary, which is a report and not an alarm. Returns the outcome so a
 *  digest that reached nobody does not read as a digest that was sent. */
export async function postDigest(text: string): Promise<Delivery> {
  console.log(text);
  const delivery = await postToSlack(text);
  if (delivery.state !== 'sent') {
    console.error(
      `   🔴 digest NOT delivered — ${
        delivery.state === 'unconfigured'
          ? 'no alert channel configured (SLACK_ALERT_WEBHOOK)'
          : delivery.reason
      }`
    );
  }
  return delivery;
}

export { SUBSYSTEM };
