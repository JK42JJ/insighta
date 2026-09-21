/**
 * Runs every invariant check, records each, alerts on confirmed transitions.
 *
 *   npx tsx scripts/keel/run.ts
 *
 * Exits non-zero when something *changed* for the worse, when a check threw, or
 * when an alert could not be delivered -- not merely when a check is failing.
 *
 * The difference matters. pipeline-freshness has been failing since the day it
 * shipped, correctly, and exiting on any failure made every scheduled run red.
 * A workflow that is always red carries no information: GitHub's failure mail
 * stops meaning "look at this" and starts meaning "this is Keel again". Red now
 * marks the run where something began to be wrong, which is the same moment an
 * alert goes out.
 *
 * Two things that policy got wrong, both measured 2026-09-21 over 14 runs:
 *
 *   A single flip counted as a transition. transcript-proxies flipped 8 times
 *   in 13 runs while captions kept working, and each flip -- in either
 *   direction -- alerted and turned the run red. `report()` now needs two
 *   consecutive agreeing observations, so a red run again means a state that
 *   held.
 *
 *   A steady failure was invisible. iam-hygiene and cloud-posture were red in
 *   all 14 runs, alerted in none of them, and left the workflow green, so the
 *   only way to see them was to open the log. They are now listed in the job
 *   summary with how long each has been failing.
 *
 * One check throwing must not stop the others: a database that refuses
 * connections should not also hide the fact that the site is down.
 */

import { appendFileSync } from 'fs';

import { ALL_CHECKS, report } from './checks';
import { ALERT_DISPATCH_STAGE, failingSince, getPrisma } from './lib';
import { MS_PER_DAY } from '../../src/utils/time-constants';

interface Outcome {
  check: string;
  ok: boolean;
  detail: string;
  alerted: boolean;
  undelivered: boolean;
}

function days(from: Date): number {
  return Math.floor((Date.now() - from.getTime()) / MS_PER_DAY);
}

/**
 * The run, as a table in the Actions job summary.
 *
 * The standing section is the point. An edge-triggered policy says nothing
 * about a failure that never stops, and those are exactly the ones that get
 * forgotten -- so each is printed with the date it started, which is also the
 * question a person asks first.
 */
async function writeJobSummary(outcomes: Outcome[]): Promise<void> {
  const path = process.env['GITHUB_STEP_SUMMARY'];
  if (!path) return;

  const failing = outcomes.filter((o) => !o.ok);
  const lines = [
    `## Keel — ${failing.length === 0 ? 'all clear' : `${failing.length} failing`}`,
    '',
    '| | check | detail |',
    '| --- | --- | --- |',
    ...outcomes.map((o) => `| ${o.ok ? '✅' : '🔴'} | \`${o.check}\` | ${o.detail} |`),
  ];

  if (failing.length > 0) {
    lines.push('', '### Standing', '');
    for (const o of failing) {
      const since = await failingSince(o.check);
      const age = since ? `since ${since.toISOString().slice(0, 10)} (${days(since)}d)` : 'since before the ledger';
      lines.push(`- \`${o.check}\` — ${age}`);
    }
  }

  const undelivered = outcomes.filter((o) => o.undelivered);
  if (undelivered.length > 0) {
    lines.push(
      '',
      `> ${undelivered.length} alert(s) could not be delivered. See \`${ALERT_DISPATCH_STAGE}\`.`
    );
  }

  appendFileSync(path, `${lines.join('\n')}\n`);
}

/**
 * Whether this run is red.
 *
 * A confirmed transition, or a check that threw. A steady, already-reported
 * failure leaves the run green: the ledger, the channel and the job summary's
 * standing section carry that, and a workflow that is permanently red is a
 * signal nobody reads.
 *
 * An unconfigured alert channel was an exception to that for one hour on
 * 2026-09-21, on the reasoning that a monitor which cannot notify is not
 * monitoring and should say so on every run. On a thirty-minute schedule that
 * is 48 failure mails a day -- the same "signal nobody reads" the rule above
 * exists to prevent, and they were arriving in James's inbox. It is not an
 * exception. The alert-delivery check still fails, so the first confirmed
 * transition produces one red run, and the standing section names it on every
 * run after that without sending anything.
 */
export function shouldFail(run: { alerted: number; threw: number }): boolean {
  return run.alerted > 0 || run.threw > 0;
}

async function main(): Promise<void> {
  const outcomes: Outcome[] = [];
  let threw = 0;

  for (const check of ALL_CHECKS) {
    try {
      const result = await check();
      const reported = await report(result);
      outcomes.push({
        check: result.check,
        ok: result.ok,
        detail: result.detail,
        alerted: reported.alerted,
        undelivered: reported.alerted && reported.delivery?.state !== 'sent',
      });
    } catch (err) {
      // The check itself broke, which is different from the check reporting a
      // problem. A monitor that silently stops checking is worse than no
      // monitor, because it reads as "all clear" -- so this always goes red.
      console.error(`💥 ${check.name} threw: ${String(err)}`);
      threw++;
    }
  }

  const failing = outcomes.filter((o) => !o.ok).length;
  const alerted = outcomes.filter((o) => o.alerted).length;
  const undelivered = outcomes.filter((o) => o.undelivered).length;
  const delivered = alerted - undelivered;

  const parts = [failing === 0 ? 'all clear' : `${failing} failing`];
  // "sent" used to be printed whether or not anything was sent. Both numbers
  // now, always, because the interesting one is the second.
  parts.push(`${delivered} alert(s) delivered`);
  if (undelivered > 0) parts.push(`${undelivered} NOT delivered`);
  if (threw > 0) parts.push(`${threw} threw`);
  console.log(`\n${parts.join(' · ')}`);

  await writeJobSummary(outcomes);
  await getPrisma().$disconnect();

  process.exit(shouldFail({ alerted, threw }) ? 1 : 0);
}

// Only when run as the script. This file also exports `shouldFail`, and an
// import for that must not launch a monitoring run -- which it did, once, in a
// test process.
if (require.main === module) void main();
