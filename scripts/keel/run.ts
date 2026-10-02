/**
 * The daily GitHub run: the checks that need a checkout or AWS, plus the one
 * that reads what the in-cluster CronJob saw (cluster-keel). Records each,
 * alerts on confirmed transitions.
 *
 *   npx tsx scripts/keel/run.ts
 *
 * Once a day since 2026-10-02. The "is it working now" checks run every fifteen
 * minutes inside the cluster (src/modules/keel/run-cluster.ts), which has no
 * failure mail; this run fails once when the cluster reports a worsening or
 * stops reporting, so a person still hears of it while no Slack webhook exists.
 *
 * Exits non-zero when something *changed* for the worse or when a check threw in
 * two consecutive runs -- not merely when a check is failing, not when something
 * recovered, and not on one throw.
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

import { CLUSTER_KEEL_CHECK, GITHUB_CHECKS, report } from './checks';
import {
  ALERT_DISPATCH_STAGE,
  closeLedger,
  confirmedThrows,
  connectWithRetry,
  countWorsened,
  failingSince,
  getPrisma,
  previousRunThrew,
  recordRun,
  shouldFail,
} from './lib';

export { countWorsened, shouldFail };
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
 * A confirmed transition *to failing*, or a check that threw in this run and
 * the last (`confirmedThrows`). A steady,
 * already-reported failure leaves the run green: the ledger, the channel and
 * the job summary's standing section carry that, and a workflow that is
 * permanently red is a signal nobody reads.
 *
 * A recovery is not red. It was, until 2026-10-01: `alerted` counted
 * transitions in both directions, so a check coming back -- pipeline-freshness
 * on 10-01, transcript-proxies on 09-29 -- failed the run exactly like one
 * going down, and half of that fortnight's red runs were good news. The
 * recovery is still recorded and still sent; it just does not page.
 *
 * An unconfigured alert channel was an exception to that for one hour on
 * 2026-09-21, on the reasoning that a monitor which cannot notify is not
 * monitoring and should say so on every run. On a thirty-minute schedule that
 * is 48 failure mails a day -- the same "signal nobody reads" the rule above
 * exists to prevent, and they were arriving in James's inbox. It is not an
 * exception. The alert-delivery check still fails, so the first confirmed
 * transition produces one red run, and the standing section names it on every
 * run after that without sending anything.
 *
 * Since 2026-10-02 the run is also red when cluster-keel is failing
 * (`escalated`): the cluster's confirmed worsenings and its own silence reach a
 * person this way, at most once a day.
 *
 * `countWorsened` and `shouldFail` live in src/modules/keel/ledger.ts, shared
 * with the in-cluster runner, and are re-exported above for the tests.
 */


async function main(): Promise<void> {
  const outcomes: Outcome[] = [];
  const threwNames: string[] = [];

  // The first check is the first query, so a pooler that drops one connect
  // attempt used to fail whichever check ran first (deploy-drift, 10-01) while
  // every later database check in the same run passed. A database that is
  // really down still fails every attempt here, and then every check that
  // needs it throws -- which is red, as it should be.
  await connectWithRetry(getPrisma());

  for (const check of GITHUB_CHECKS) {
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
      // problem. It is printed and recorded every time; it turns the run red
      // when it also threw last run (below), the same two-run rule transitions
      // follow, so one network blip does not send a failure mail.
      console.error(`💥 ${check.name} threw: ${String(err)}`);
      threwNames.push(check.name);
    }
  }

  // A throw pages only when the same check also threw last run -- the rule
  // transitions already follow. A single throw is still printed above and in
  // the summary; it just does not send the failure mail on its own.
  const previous = threwNames.length > 0 ? await previousRunThrew() : new Set<string>();
  const confirmed = confirmedThrows(threwNames, previous);
  const threw = confirmed.length;
  const blips = threwNames.filter((n) => !confirmed.includes(n));
  await recordRun(threwNames);

  const failing = outcomes.filter((o) => !o.ok).length;
  const alerted = outcomes.filter((o) => o.alerted).length;
  const worsened = countWorsened(outcomes);
  // What the cluster saw, escalated here because the CronJob has no failure
  // mail: red on the first daily observation rather than after two, since the
  // two-run rule was already applied to the cluster's own transitions.
  const escalated = outcomes.filter((o) => o.check === CLUSTER_KEEL_CHECK && !o.ok).length;
  const undelivered = outcomes.filter((o) => o.undelivered).length;
  const delivered = alerted - undelivered;

  const parts = [failing === 0 ? 'all clear' : `${failing} failing`];
  // "sent" used to be printed whether or not anything was sent. Both numbers
  // now, always, because the interesting one is the second.
  parts.push(`${delivered} alert(s) delivered`);
  if (undelivered > 0) parts.push(`${undelivered} NOT delivered`);
  if (threw > 0) parts.push(`${threw} threw (also last run)`);
  if (blips.length > 0) parts.push(`${blips.length} threw once: ${blips.join(', ')} -- red if it throws again`);
  console.log(`\n${parts.join(' · ')}`);

  await writeJobSummary(outcomes);
  await closeLedger();

  process.exit(shouldFail({ worsened, threw, escalated }) ? 1 : 0);
}

// Only when run as the script. This file also exports `shouldFail`, and an
// import for that must not launch a monitoring run -- which it did, once, in a
// test process.
if (require.main === module) void main();
