/**
 * The in-cluster Keel run, every fifteen minutes (CronJob `keel`).
 *
 *   node dist/modules/keel/run-cluster.js
 *
 * Same rules as the GitHub run: record every answer, alert on a transition seen
 * twice, a throw counts once it repeats. What it does not have is GitHub's
 * failure mail, and that is the point of moving it -- a red run here reaches a
 * person through Slack when a webhook exists, and otherwise through the daily
 * GitHub run, which reads this runner's rows (`CLUSTER_RUN_STAGE`) and fails
 * once if anything worsened or this job stopped running.
 *
 * The exit code still says what happened, for `kubectl get jobs`.
 */

import { CLUSTER_CHECKS } from './cluster-checks';
import {
  CLUSTER_RUN_STAGE,
  closeLedger,
  confirmedThrows,
  connectWithRetry,
  countWorsened,
  getPrisma,
  previousRunThrew,
  recordRun,
  report,
  shouldFail,
} from './ledger';

export async function runCluster(): Promise<boolean> {
  await connectWithRetry(getPrisma());

  const outcomes: Array<{ check: string; ok: boolean; alerted: boolean }> = [];
  const threwNames: string[] = [];
  for (const check of CLUSTER_CHECKS) {
    try {
      const result = await check();
      const reported = await report(result);
      outcomes.push({ check: result.check, ok: result.ok, alerted: reported.alerted });
    } catch (err) {
      console.error(`💥 ${check.name} threw: ${String(err)}`);
      threwNames.push(check.name);
    }
  }

  const previous =
    threwNames.length > 0 ? await previousRunThrew(CLUSTER_RUN_STAGE) : new Set<string>();
  const confirmed = confirmedThrows(threwNames, previous);
  const worsenedNames = outcomes.filter((o) => o.alerted && !o.ok).map((o) => o.check);
  await recordRun(threwNames, CLUSTER_RUN_STAGE, {
    worsened: worsenedNames,
    confirmedThrows: confirmed,
  });

  const failing = outcomes.filter((o) => !o.ok).length;
  console.log(
    `\n${failing === 0 ? 'all clear' : `${failing} failing`}` +
      (worsenedNames.length > 0 ? ` · worsened: ${worsenedNames.join(', ')}` : '') +
      (confirmed.length > 0 ? ` · threw twice: ${confirmed.join(', ')}` : '') +
      (threwNames.length > confirmed.length
        ? ` · threw once: ${threwNames.filter((n) => !confirmed.includes(n)).join(', ')}`
        : '')
  );
  await closeLedger();
  return shouldFail({ worsened: countWorsened(outcomes), threw: confirmed.length });
}

if (require.main === module) {
  runCluster()
    .then((red) => process.exit(red ? 1 : 0))
    .catch((err) => {
      console.error(`keel run failed: ${String(err)}`);
      process.exit(1);
    });
}
