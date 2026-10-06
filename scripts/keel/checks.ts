/**
 * The checks the daily GitHub run makes, and the one it makes about the cluster.
 *
 * These need what only a runner has: the repository checkout (the chart file
 * and its git history, the lockfiles), a view from outside the cluster (the
 * certificate as the public sees it), and AWS credentials through OIDC, which
 * are scoped to this workflow rather than granted to every pod on the node.
 *
 * The "is it working right now" checks moved into the cluster on 2026-10-02
 * (src/modules/keel/cluster-checks.ts, every fifteen minutes). From a runner
 * they had a thirty-minute schedule that GitHub delayed to one to five hours,
 * and a failure mail per red run. `checkClusterKeel` below is how what the
 * cluster sees still reaches a person while no Slack webhook exists.
 */

import { execFileSync, execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

import { checkAwsCost } from './check-aws-cost';
import { checkCloudPosture } from './check-cloud-posture';
import {
  CLUSTER_RUN_STAGE,
  SUBSYSTEM,
  deliveryFailuresSince,
  getPrisma,
  report,
  type CheckResult,
} from './lib';
import { CLUSTER_CHECKS, PROBE_TIMEOUT_MS, fetchJson } from '../../src/modules/keel/cluster-checks';
import { keelConfig } from '../../src/modules/keel/config';
import { MINUTES_PER_HOUR, MS_PER_HOUR, MS_PER_MINUTE } from '../../src/utils/time-constants';

export {
  CLUSTER_CHECKS,
  COLD_START_RETRY_DELAY_MS,
  DELIVERY_FAILURE_WINDOW_HOURS,
  PROBE_TIMEOUT_MS,
  checkAlertDelivery,
  checkLlmSpend,
  checkPipelineFreshness,
  checkSchema,
  checkServiceReachability,
  checkTranscriptProxies,
  interpretAlertDelivery,
  interpretFreshness,
  interpretProxyHealth,
  mergeProxyRetry,
  timedOutProxies,
  type FreshnessRow,
} from '../../src/modules/keel/cluster-checks';

const PROD = keelConfig.baseUrl();
const REPO_ROOT = join(__dirname, '..', '..');

/**
 * The chart and the running image name the same commit.
 *
 * 2026-09-03: the deploy workflow reported success three times while
 * production served the previous day's images. The pin PR it opens cannot
 * merge itself, and ArgoCD syncs manually, so a deploy stops halfway with
 * nothing red anywhere. Eight days passed on one occasion before anyone
 * noticed.
 *
 * This also covers ArgoCD drift without a second check: if ArgoCD has not
 * synced, the running SHA has not moved, and the comparison fails either way.
 *
 * A window is allowed because immediately after a merge the two are correctly
 * different -- the pin PR and the sync are still ahead. Only a mismatch that
 * persists past the window is a stall.
 */
const DRIFT_GRACE_MINUTES = Number(process.env['MONITOR_DRIFT_GRACE_MINUTES'] ?? 30);

export async function checkDeployDrift(): Promise<CheckResult> {
  const check = 'deploy-drift';

  const chartPath = join(REPO_ROOT, 'charts/insighta/environments/prod.yaml');
  const chart = readFileSync(chartPath, 'utf8');
  const apiTag = /^\s*apiTag:\s*([0-9a-f]{40})\s*$/m.exec(chart)?.[1];
  if (!apiTag) {
    return { check, ok: false, detail: `could not read apiTag from ${chartPath}` };
  }

  let running: string | null | undefined;
  try {
    const { status, body } = await fetchJson(`${PROD}/health`);
    if (status !== 200) return { check, ok: false, detail: `GET /health returned ${status}` };
    running = (body as { sha?: string | null }).sha;
  } catch (err) {
    return { check, ok: false, detail: `GET /health failed: ${String(err)}` };
  }

  if (running === undefined) {
    // The field is missing rather than null, which means production predates
    // it. Not a drift failure, and saying so beats a misleading mismatch.
    return {
      check,
      ok: true,
      detail: 'production does not report a SHA yet (deploy this change first)',
      context: { chart: apiTag },
    };
  }

  if (running === apiTag) {
    return {
      check,
      ok: true,
      detail: `chart and production agree on ${apiTag.slice(0, 12)}`,
      context: { sha: apiTag },
    };
  }

  // Different: only a stall if the chart commit is older than the window.
  // `git log -1 --format=%ct` on the file is not it -- the chart moves in its
  // own pin commit, which is exactly the event being timed.
  const ageMinutes = chartCommitAgeMinutes();
  if (ageMinutes !== null && ageMinutes < DRIFT_GRACE_MINUTES) {
    return {
      check,
      ok: true,
      detail: `chart moved ${Math.round(ageMinutes)}m ago; rollout still in progress`,
      context: { chart: apiTag, running, ageMinutes },
    };
  }

  return {
    check,
    ok: false,
    detail:
      `chart says ${apiTag.slice(0, 12)} but production runs ${String(running).slice(0, 12)}` +
      (ageMinutes === null ? '' : ` (${Math.round(ageMinutes)}m)`) +
      ' — pin PR unmerged, or ArgoCD not synced',
    context: { chart: apiTag, running, ageMinutes },
  };
}

/** Minutes since the chart file last changed on this branch, or null when git
 *  history is unavailable (a shallow checkout). */
function chartCommitAgeMinutes(): number | null {
  try {
    const out = execFileSync(
      'git',
      ['log', '-1', '--format=%ct', '--', 'charts/insighta/environments/prod.yaml'],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    ).trim();
    if (!out) return null;
    return (Date.now() / 1000 - Number(out)) / 60;
  } catch {
    return null;
  }
}

/**
 * The site answers, and its certificate is not about to expire.
 *
 * cert-manager renews automatically. Nothing reports a renewal that failed,
 * which is the case worth knowing about.
 */
const CERT_WARN_DAYS = Number(process.env['MONITOR_CERT_WARN_DAYS'] ?? 14);

export async function checkPublicSurface(): Promise<CheckResult> {
  const check = 'public-surface';
  try {
    const { status } = await fetchJson(`${PROD}/health`);
    if (status !== 200)
      return { check, ok: false, detail: `GET ${PROD}/health returned ${status}` };
  } catch (err) {
    return { check, ok: false, detail: `GET ${PROD}/health failed: ${String(err)}` };
  }

  const days = await certDaysRemaining(new URL(PROD).hostname);
  if (days !== null && days < CERT_WARN_DAYS) {
    return {
      check,
      ok: false,
      detail: `TLS certificate expires in ${days} days — cert-manager renewal may have failed`,
      context: { days },
    };
  }
  return {
    check,
    ok: true,
    detail: days === null ? 'reachable' : `reachable · certificate valid ${days} more days`,
    context: { days },
  };
}

/** Days until the TLS certificate expires, or null when openssl is unavailable. */
async function certDaysRemaining(host: string): Promise<number | null> {
  try {
    const out = execSync(
      `echo | openssl s_client -servername ${host} -connect ${host}:443 2>/dev/null | openssl x509 -noout -enddate`,
      { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS }
    );
    const m = /notAfter=(.+)/.exec(out);
    if (!m?.[1]) return null;
    return Math.floor((new Date(m[1]).getTime() - Date.now()) / 86_400_000);
  } catch {
    return null;
  }
}

/**
 * iam-hygiene: the identity layer must not drift back. Reads the account
 * credential report (free) and fails when a console user has no MFA, an
 * active access key is older than KEY_MAX_AGE_DAYS, or an active key has
 * never been used for longer than KEY_UNUSED_DAYS. The report is generated
 * on demand; AWS may answer "in progress" once, so one retry is built in.
 */
const KEY_MAX_AGE_DAYS = 90;
const KEY_UNUSED_DAYS = 30;

export async function checkIamHygiene(): Promise<CheckResult> {
  const check = 'iam-hygiene';
  try {
    execSync('aws iam generate-credential-report', {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let csv = '';
    for (let attempt = 0; attempt < 3 && !csv; attempt += 1) {
      try {
        const b64 = execSync('aws iam get-credential-report --query Content --output text', {
          encoding: 'utf8',
          timeout: PROBE_TIMEOUT_MS,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        csv = Buffer.from(b64, 'base64').toString('utf8');
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!csv) return { check, ok: false, detail: 'credential report unavailable after 3 attempts' };
    const [header, ...rows] = csv.trim().split('\n');
    const col = (header ?? '').split(',');
    const idx = (name: string) => col.indexOf(name);
    const now = Date.now();
    const days = (iso: string) =>
      iso && iso !== 'N/A' && iso !== 'no_information'
        ? Math.floor((now - Date.parse(iso)) / 86_400_000)
        : null;
    const noMfa: string[] = [];
    const staleKeys: string[] = [];
    const unusedKeys: string[] = [];
    for (const line of rows) {
      const f = line.split(',');
      const user = f[idx('user')] ?? '';
      if (f[idx('password_enabled')] === 'true' && f[idx('mfa_active')] !== 'true')
        noMfa.push(user);
      for (const k of ['1', '2']) {
        if (f[idx(`access_key_${k}_active`)] !== 'true') continue;
        const age = days(f[idx(`access_key_${k}_last_rotated`)] ?? '');
        const used = days(f[idx(`access_key_${k}_last_used_date`)] ?? '');
        if (age !== null && age > KEY_MAX_AGE_DAYS) staleKeys.push(`${user}:key${k}:${age}d`);
        if (used === null && age !== null && age > KEY_UNUSED_DAYS)
          unusedKeys.push(`${user}:key${k}:never-used:${age}d`);
      }
    }
    const ok = noMfa.length === 0 && staleKeys.length === 0 && unusedKeys.length === 0;
    const parts = [
      noMfa.length ? `console without MFA: ${noMfa.join(' ')}` : 'MFA ok',
      staleKeys.length ? `keys over ${KEY_MAX_AGE_DAYS}d: ${staleKeys.join(' ')}` : 'key age ok',
      unusedKeys.length ? `unused keys: ${unusedKeys.join(' ')}` : 'no unused keys',
    ];
    return { check, ok, detail: parts.join(' · '), context: { noMfa, staleKeys, unusedKeys } };
  } catch (err) {
    return { check, ok: false, detail: `credential report failed: ${String(err).slice(0, 160)}` };
  }
}

/**
 * supply-chain: known vulnerabilities in the two dependency trees, counted
 * from `npm audit` on the lockfiles (no install, no token). The Dependabot
 * API was tried first and refused the workflow token ("Resource not
 * accessible by integration"), so the audit is the source. Zero critical
 * and zero high is the target; the counts stay in context so the ledger
 * shows the trend while it is not.
 */
function auditCounts(cwd: string): Record<string, number> {
  const out = execSync('npm audit --json --package-lock-only 2>/dev/null || true', {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const parsed = JSON.parse(out || '{}') as {
    metadata?: { vulnerabilities?: Record<string, number> };
  };
  const v = parsed.metadata?.vulnerabilities ?? {};
  return {
    critical: v['critical'] ?? 0,
    high: v['high'] ?? 0,
    moderate: v['moderate'] ?? 0,
    low: v['low'] ?? 0,
  };
}

export async function checkSupplyChain(): Promise<CheckResult> {
  const check = 'supply-chain';
  try {
    const root = process.cwd();
    const backend = auditCounts(root);
    const frontend = auditCounts(`${root}/frontend`);
    const critical = (backend['critical'] ?? 0) + (frontend['critical'] ?? 0);
    const high = (backend['high'] ?? 0) + (frontend['high'] ?? 0);
    const ok = critical === 0 && high === 0;
    return {
      check,
      ok,
      detail: ok
        ? 'no critical or high vulnerabilities in either lockfile'
        : `vulnerabilities: backend critical ${backend['critical']} high ${backend['high']} · frontend critical ${frontend['critical']} high ${frontend['high']}`,
      context: { backend, frontend },
    };
  } catch (err) {
    return { check, ok: false, detail: `npm audit failed: ${String(err).slice(0, 160)}` };
  }
}

/**
 * The cluster's Keel is running, and what it saw reached Slack.
 *
 * The CronJob alerts through Slack itself; a worsening it saw and delivered is
 * already told, and repeating it here as a red run was a duplicate failure mail
 * (10-04 and 10-05). What this check is for is the two things the cluster
 * cannot report: having stopped, and a delivery that failed. The daily run
 * posts either to Slack and turns red only if that post fails too.
 */
export const CLUSTER_KEEL_CHECK = 'cluster-keel';
/** Four missed fifteen-minute runs. */
export const CLUSTER_STALE_MINUTES = 60;
export const CLUSTER_LOOKBACK_HOURS = 24;

export interface ClusterRunRow {
  at: Date;
  worsened: string[];
  confirmedThrows: string[];
}

/** The judgement, separated from the reads so it can be tested without a database. */
export function interpretClusterKeel(
  latest: Date | null,
  recent: ClusterRunRow[],
  deliveryFailures: Array<{ at: Date; message: string }> = [],
  now: number = Date.now()
): { ok: boolean; detail: string; context: Record<string, unknown> } {
  if (!latest) {
    return {
      ok: true,
      detail: 'cluster Keel has not run yet (deploy the CronJob first)',
      context: { latest: null },
    };
  }
  const ageMinutes = Math.round((now - latest.getTime()) / MS_PER_MINUTE);
  const worsened = [...new Set(recent.flatMap((r) => r.worsened))];
  const threw = [...new Set(recent.flatMap((r) => r.confirmedThrows))];
  const problems: string[] = [];
  if (ageMinutes > CLUSTER_STALE_MINUTES) {
    problems.push(
      `cluster Keel last ran ${Math.round(ageMinutes / MINUTES_PER_HOUR)}h ago — the CronJob or the cluster has stopped`
    );
  }
  if (deliveryFailures.length > 0) {
    problems.push(
      `${deliveryFailures.length} alert(s) in the last ${CLUSTER_LOOKBACK_HOURS}h reached nobody — latest: ${deliveryFailures[0]!.message}`
    );
  }
  const context = {
    latest: latest.toISOString(),
    ageMinutes,
    worsened,
    threw,
    deliveryFailures: deliveryFailures.length,
    runs: recent.length,
  };
  if (problems.length > 0) return { ok: false, detail: problems.join(' · '), context };
  // Worsenings are listed for the record; they were delivered when they happened.
  const seen = worsened.length > 0 ? ` · alerted in ${CLUSTER_LOOKBACK_HOURS}h: ${worsened.join(', ')}` : '';
  return {
    ok: true,
    detail: `cluster Keel ran ${ageMinutes}m ago · ${recent.length} runs in ${CLUSTER_LOOKBACK_HOURS}h · every alert delivered${seen}`,
    context,
  };
}

export async function checkClusterKeel(): Promise<CheckResult> {
  const prisma = getPrisma();
  const since = new Date(Date.now() - CLUSTER_LOOKBACK_HOURS * MS_PER_HOUR);
  const latest = await prisma.error_events.findFirst({
    where: { subsystem: SUBSYSTEM, stage: CLUSTER_RUN_STAGE },
    orderBy: { created_at: 'desc' },
    select: { created_at: true },
  });
  const rows = await prisma.error_events.findMany({
    where: { subsystem: SUBSYSTEM, stage: CLUSTER_RUN_STAGE, created_at: { gte: since } },
    select: { created_at: true, context: true },
  });
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  const recent = rows.map((r) => {
    const c = (r.context ?? {}) as { worsened?: unknown; confirmedThrows?: unknown };
    return { at: r.created_at, worsened: list(c.worsened), confirmedThrows: list(c.confirmedThrows) };
  });
  const failures = await deliveryFailuresSince(since);
  return {
    check: CLUSTER_KEEL_CHECK,
    ...interpretClusterKeel(latest?.created_at ?? null, recent, failures),
  };
}

/** Run once a day from GitHub. */
export const GITHUB_CHECKS: Array<() => Promise<CheckResult>> = [
  checkDeployDrift,
  checkPublicSurface,
  checkAwsCost,
  checkIamHygiene,
  checkSupplyChain,
  checkCloudPosture,
  checkClusterKeel,
];

/** Every check in either runner, for the collision tests. */
export const ALL_CHECKS: Array<() => Promise<CheckResult>> = [...CLUSTER_CHECKS, ...GITHUB_CHECKS];

export { report };
