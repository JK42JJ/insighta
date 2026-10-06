/**
 * The in-cluster Keel run, every fifteen minutes (CronJob `keel`).
 *
 *   node dist/modules/keel/run-cluster.js
 *
 * Same rules as the GitHub run: record every answer, alert on a transition seen
 * twice, a throw counts once it repeats -- and both reach Slack from here.
 * What reaches nobody (a delivery that failed) is recorded under
 * `alert-dispatch`; the daily GitHub run reads that, and this runner's
 * heartbeat (`CLUSTER_RUN_STAGE`), and falls back to a failure mail only when
 * it cannot reach Slack either.
 *
 * The exit code still says what happened, for `kubectl get jobs`.
 */

import { CLUSTER_CHECKS } from './cluster-checks';
import {
  CLUSTER_RUN_STAGE,
  closeLedger,
  confirmedThrows,
  connectWithRetry,
  countWorsenedUndelivered,
  getPrisma,
  notify,
  previousRunThrew,
  recordRun,
  report,
  shouldFail,
} from './ledger';

export async function runCluster(): Promise<boolean> {
  await connectWithRetry(getPrisma());

  const outcomes: Array<{ check: string; ok: boolean; alerted: boolean; undelivered: boolean }> =
    [];
  const threwNames: string[] = [];
  for (const check of CLUSTER_CHECKS) {
    try {
      const result = await check();
      const reported = await report(result);
      outcomes.push({
        check: result.check,
        ok: result.ok,
        alerted: reported.alerted,
        undelivered: reported.alerted && reported.delivery?.state !== 'sent',
      });
    } catch (err) {
      console.error(`💥 ${check.name} threw: ${String(err)}`);
      threwNames.push(check.name);
    }
  }

  const previous =
    threwNames.length > 0 ? await previousRunThrew(CLUSTER_RUN_STAGE) : new Set<string>();
  const confirmed = confirmedThrows(threwNames, previous);
  // A check that threw in two consecutive runs is a monitor that stopped
  // looking. It has no transition to alert on, so it is announced directly.
  let throwUndelivered = 0;
  if (confirmed.length > 0) {
    const d = await notify(
      `\u{1F4A5} *Keel (cluster)* — threw in two consecutive runs: ${confirmed.join(', ')}`,
      'keel-cluster-throw'
    );
    if (d.state !== 'sent') throwUndelivered = confirmed.length;
  }
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
  return shouldFail({ worsened: countWorsenedUndelivered(outcomes), threw: throwUndelivered });
}

if (require.main === module) {
  runCluster()
    .then((red) => process.exit(red ? 1 : 0))
    .catch((err) => {
      console.error(`keel run failed: ${String(err)}`);
      process.exit(1);
    });
}
