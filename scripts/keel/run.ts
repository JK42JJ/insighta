/**
 * Runs every invariant check, records each, alerts on transitions.
 *
 *   npx tsx scripts/keel/run.ts
 *
 * Exits non-zero when something *changed* for the worse, or when a check threw
 * -- not merely when a check is failing.
 *
 * The difference matters. pipeline-freshness has been failing since the day it
 * shipped, correctly, and exiting on any failure made every scheduled run red.
 * A workflow that is always red carries no information: GitHub's failure mail
 * stops meaning "look at this" and starts meaning "this is Keel again". Red now
 * marks the run where something began to be wrong, which is the same moment an
 * alert goes out.
 *
 * One check throwing must not stop the others: a database that refuses
 * connections should not also hide the fact that the site is down.
 */

import { ALL_CHECKS, report } from './checks';
import { getPrisma } from './lib';

async function main(): Promise<void> {
  let failing = 0;
  let alerted = 0;
  let threw = 0;

  for (const check of ALL_CHECKS) {
    try {
      const result = await check();
      if (await report(result)) alerted++;
      if (!result.ok) failing++;
    } catch (err) {
      // The check itself broke, which is different from the check reporting a
      // problem. A monitor that silently stops checking is worse than no
      // monitor, because it reads as "all clear" -- so this always goes red.
      console.error(`💥 ${check.name} threw: ${String(err)}`);
      threw++;
    }
  }

  const state = failing === 0 ? 'all clear' : `${failing} failing`;
  console.log(`\n${state} · ${alerted} alert(s) sent${threw > 0 ? ` · ${threw} threw` : ''}`);
  await getPrisma().$disconnect();

  // Red on a new problem or a broken check. A steady, already-reported failure
  // leaves the run green: the ledger and the alert channel carry that, and a
  // workflow that is permanently red is a signal nobody reads.
  process.exit(alerted > 0 || threw > 0 ? 1 : 0);
}

void main();
