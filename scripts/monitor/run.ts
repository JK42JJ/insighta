/**
 * Runs every invariant check, records each, alerts on transitions.
 *
 *   npx tsx scripts/monitor/run.ts
 *
 * Exits non-zero when any check is failing, so the workflow goes red and
 * GitHub's own notification carries the signal even before Slack is wired.
 *
 * One check throwing must not stop the others: a database that refuses
 * connections should not also hide the fact that the site is down.
 */

import { ALL_CHECKS, report } from './checks';
import { getPrisma } from './lib';

async function main(): Promise<void> {
  let failing = 0;
  let alerted = 0;

  for (const check of ALL_CHECKS) {
    try {
      const result = await check();
      if (await report(result)) alerted++;
      if (!result.ok) failing++;
    } catch (err) {
      // The check itself broke. That is a failure of the check, reported as
      // such rather than swallowed -- a monitor that silently stops checking
      // is worse than no monitor, because it reads as "all clear".
      console.error(`💥 ${check.name} threw: ${String(err)}`);
      failing++;
    }
  }

  console.log(`\n${failing === 0 ? 'all clear' : `${failing} failing`} · ${alerted} alert(s) sent`);
  await getPrisma().$disconnect();
  process.exit(failing === 0 ? 0 : 1);
}

void main();
