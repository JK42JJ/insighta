/**
 * The invariant checks.
 *
 * Each one exists because it was learned the expensive way. The comment on
 * each says which incident, so nobody deletes a check whose cost they cannot
 * see.
 *
 * Every check runs from a GitHub runner, which cannot reach the cluster: port
 * 22 is restricted by source address and a runner's address changes every
 * time. So nothing here uses `kubectl`. What it uses instead is the public
 * `/health` endpoint and the database, both reachable from anywhere.
 */

import { execFileSync, execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

import { checkAwsCost } from './check-aws-cost';
import { checkCloudPosture } from './check-cloud-posture';
import { getPrisma, report, type CheckResult } from './lib';

const PROD = process.env['MONITOR_BASE_URL'] ?? 'https://insighta.one';
const REPO_ROOT = join(__dirname, '..', '..');

/** Requests that take longer than this are treated as a failure of the thing
 *  being probed, not as a slow network. */
const PROBE_TIMEOUT_MS = 15_000;

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* not json; keep the text for the message */
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

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
    return { check, ok: true, detail: `chart and production agree on ${apiTag.slice(0, 12)}`, context: { sha: apiTag } };
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
 * Spend is under the ceiling, and the warning line has not been crossed.
 *
 * 2026-06-25: $36.18 in a single day, across calls that all succeeded. The
 * credit breaker only fires on a provider 402 -- that is, after the money is
 * gone -- so nothing saw it happen.
 *
 * The caps themselves are enforced in `cost-gate`. This does not duplicate
 * that: it reports *approach*, so a limit is a plan rather than a surprise
 * stop in the middle of a batch.
 */
export async function checkLlmSpend(): Promise<CheckResult> {
  const check = 'llm-spend';
  const dailyLimit = Number(process.env['LLM_DAILY_COST_LIMIT_USD'] ?? 10);
  const monthlyLimit = Number(process.env['LLM_MONTHLY_COST_LIMIT_USD'] ?? 50);
  const warnAt = Number(process.env['MONITOR_SPEND_WARN_RATIO'] ?? 0.7);

  const rows = await getPrisma().$queryRaw<Array<{ daily: number; monthly: number }>>`
    SELECT COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= CURRENT_DATE), 0)::float AS daily,
           COALESCE(SUM(cost_usd), 0)::float AS monthly
      FROM llm_call_logs
     WHERE created_at >= date_trunc('month', CURRENT_DATE) AND status = 'success'
  `;
  const daily = rows[0]?.daily ?? 0;
  const monthly = rows[0]?.monthly ?? 0;

  const ctx = { daily, monthly, dailyLimit, monthlyLimit, warnAt };
  const money = (n: number) => `$${n.toFixed(2)}`;

  // Monthly first: a day resets tomorrow, a month does not.
  if (monthly >= monthlyLimit * warnAt) {
    return {
      check,
      ok: false,
      detail: `month at ${money(monthly)} of ${money(monthlyLimit)} (${Math.round((monthly / monthlyLimit) * 100)}%)`,
      context: ctx,
    };
  }
  if (daily >= dailyLimit * warnAt) {
    return {
      check,
      ok: false,
      detail: `today at ${money(daily)} of ${money(dailyLimit)} (${Math.round((daily / dailyLimit) * 100)}%)`,
      context: ctx,
    };
  }
  return {
    check,
    ok: true,
    detail: `today ${money(daily)}/${money(dailyLimit)} · month ${money(monthly)}/${money(monthlyLimit)}`,
    context: ctx,
  };
}

/**
 * Each surface that should be producing, reported separately.
 *
 * pipeline_events stopped on 2026-07-22 and nothing said so for forty-seven
 * days. The transcript service on the Mac Mini was not the reason -- it had
 * been running for eighty-one days when this was measured -- so probing that
 * host would have reported healthy throughout. What stopped was the collector
 * that calls the internal route, and the only thing that shows it is the
 * outcome: is anything still being written.
 *
 * Split by surface rather than reduced to one timestamp. A single "newest row
 * anywhere" is green while the transcript path is dead, because chat traffic
 * keeps llm_call_logs fresh; and once it does go red it says only that
 * something stopped, which is where the previous version left the reader.
 * Measured 2026-09-08: llm_call_logs an hour old, video_summaries sixteen days,
 * pipeline_events forty-seven. Three different states, one number.
 */

/** Surfaces, with how long each may reasonably be quiet. Transcript ingestion
 *  runs on a schedule; summaries follow it; LLM calls happen whenever anyone
 *  uses the product. */
const SURFACES: Array<{ table: string; label: string; hours: number }> = [
  { table: 'llm_call_logs', label: 'LLM calls', hours: 26 },
  { table: 'video_summaries', label: 'summaries', hours: 24 * 7 },
  { table: 'pipeline_events', label: 'transcript pipeline', hours: 24 * 3 },
];

export async function checkPipelineFreshness(): Promise<CheckResult> {
  const check = 'pipeline-freshness';
  const rows = await getPrisma().$queryRawUnsafe<Array<{ t: string; newest: Date | null }>>(
    SURFACES.map((s) => `SELECT '${s.table}' AS t, max(created_at) AS newest FROM ${s.table}`).join(
      ' UNION ALL '
    )
  );

  const seen = new Map(rows.map((r) => [r.t, r.newest]));
  const parts: string[] = [];
  const stale: string[] = [];
  const ctx: Record<string, unknown> = {};

  for (const s of SURFACES) {
    const newest = seen.get(s.table) ?? null;
    if (!newest) {
      parts.push(`${s.label} never`);
      stale.push(s.label);
      ctx[s.table] = null;
      continue;
    }
    const hours = (Date.now() - new Date(newest).getTime()) / 3_600_000;
    ctx[s.table] = { newest, hours: Number(hours.toFixed(1)), allowed: s.hours };
    const age = hours < 48 ? `${hours.toFixed(0)}h` : `${(hours / 24).toFixed(0)}d`;
    if (hours > s.hours) {
      parts.push(`${s.label} ${age} STALE`);
      stale.push(s.label);
    } else {
      parts.push(`${s.label} ${age}`);
    }
  }

  if (stale.length === 0) {
    return { check, ok: true, detail: parts.join(' · '), context: ctx };
  }

  // Naming the dependency turns a red flag into a next step, and naming the
  // wrong one sends the reader the wrong way -- this hint said "the cluster
  // cannot reach the Mac Mini", which is true and is not the cause. The traffic
  // runs the other way: the collector on the Mac Mini polls
  // /api/v1/internal/transcript/candidates and posts back, and the route
  // handler is the only writer of pipeline_events in the codebase. So this
  // surface going quiet means the collector stopped calling, not that the
  // cluster stopped reaching.
  const hint = stale.includes('transcript pipeline')
    ? ' — only the internal transcript route writes this, and the Mac Mini collector is what calls it'
    : '';
  return { check, ok: false, detail: `${parts.join(' · ')}${hint}`, context: ctx };
}

/**
 * What a set of proxy probe results means, separated from fetching them so the
 * judgement can be tested without a network.
 *
 * Partial reachability is a failure, not a warning. The second proxy exists
 * because the first has gone down before; running on one is running with the
 * spare already used.
 */
export function interpretProxyHealth(
  deps: Array<{ name: string; ok: boolean; detail: string }>
): { ok: boolean; detail: string } {
  if (deps.length === 0) {
    return { ok: false, detail: 'no transcript proxy is configured — captions cannot be fetched at all' };
  }
  const summary = deps.map((d) => `${d.name} ${d.ok ? 'ok' : d.detail}`).join(' · ');
  const reachable = deps.filter((d) => d.ok).length;
  if (reachable === 0) {
    return { ok: false, detail: `no proxy reachable — transcripts, summaries and notes are all blocked · ${summary}` };
  }
  if (reachable < deps.length) {
    return { ok: false, detail: `${reachable}/${deps.length} reachable · ${summary}` };
  }
  return { ok: true, detail: summary };
}

/**
 * Which features can run, given what the cluster can currently reach.
 *
 * A host being down is not the question a person has when something is broken;
 * "can users still do X" is. Two of the unreachable hosts have a working
 * alternative and one does not, and that difference is not visible in a list of
 * timeouts.
 *
 * Recorded per feature so the ledger answers, months later, what was actually
 * unavailable on a given day -- which is the question an incident write-up
 * starts from and the one nothing here could answer for the forty-seven days
 * before this existed.
 */
export async function checkServiceReachability(): Promise<CheckResult> {
  const check = 'service-reachability';
  let services: Array<{
    env: string;
    feature: string;
    alternative: string | null;
    configured: boolean;
    ok: boolean;
    detail: string;
  }>;

  try {
    const { status, body } = await fetchJson(`${PROD}/health/dependencies`);
    if (status === 404) {
      return { check, ok: true, detail: 'production does not report services yet (deploy this change first)' };
    }
    if (status !== 200) return { check, ok: false, detail: `GET /health/dependencies returned ${status}` };
    services = (body as { services?: typeof services }).services ?? [];
  } catch (err) {
    return { check, ok: false, detail: `GET /health/dependencies failed: ${String(err)}` };
  }

  if (services.length === 0) {
    return { check, ok: true, detail: 'no external services declared' };
  }

  // Down with no alternative is the only case that stops a feature. Down with
  // one is worth reporting and is not an outage, and conflating them is how a
  // dashboard trains people to ignore it.
  const blocked = services.filter((s) => s.configured && !s.ok && !s.alternative);
  const degraded = services.filter((s) => s.configured && !s.ok && s.alternative);
  const ctx = { services };

  if (blocked.length > 0) {
    return {
      check,
      ok: false,
      detail:
        `unavailable: ${blocked.map((s) => `${s.feature} (${s.detail})`).join(', ')}` +
        (degraded.length > 0 ? ` · degraded: ${degraded.map((s) => s.feature).join(', ')}` : ''),
      context: ctx,
    };
  }
  if (degraded.length > 0) {
    return {
      check,
      ok: false,
      detail: `running on the alternative: ${degraded.map((s) => `${s.feature} → ${s.alternative}`).join(', ')}`,
      context: ctx,
    };
  }
  return { check, ok: true, detail: `${services.filter((s) => s.ok).length} services reachable`, context: ctx };
}

/**
 * The transcript proxies answer.
 *
 * pipeline-freshness notices this too, but only after three days of silence and
 * only as an inference: it sees that nothing was written and names the likely
 * cause. This asks the dependency directly, so an outage is caught on the next
 * run with the reason attached rather than deduced from an absence.
 *
 * The proxies are the only way captions can be fetched -- the direct YouTube
 * path was removed on 2026-09-08 -- so when they are down the whole chain
 * behind them is down: no transcript, no v2 summary, no note. Forty-seven days
 * of that went unnoticed because nothing checked the dependency itself.
 *
 * Runs from a GitHub runner, which reaches neither proxy: one is behind a
 * Tailscale address and the other is a private host. So this asks the API pod
 * to make the call, through an endpoint that reports reachability and nothing
 * else.
 */
export async function checkTranscriptProxies(): Promise<CheckResult> {
  const check = 'transcript-proxies';
  try {
    const { status, body } = await fetchJson(`${PROD}/health/dependencies`);
    if (status === 404) {
      // The endpoint ships with this check; a 404 means production predates it.
      return {
        check,
        ok: true,
        detail: 'production does not report dependencies yet (deploy this change first)',
      };
    }
    if (status !== 200) return { check, ok: false, detail: `GET /health/dependencies returned ${status}` };

    const deps = (body as { transcriptProxies?: Array<{ name: string; ok: boolean; detail: string }> })
      .transcriptProxies;
    if (!deps || deps.length === 0) {
      return { check, ok: false, detail: 'no transcript proxy is configured — captions cannot be fetched at all' };
    }
    const { ok, detail } = interpretProxyHealth(deps);
    return { check, ok, detail, context: { deps } };
  } catch (err) {
    return { check, ok: false, detail: `GET /health/dependencies failed: ${String(err)}` };
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
    if (status !== 200) return { check, ok: false, detail: `GET ${PROD}/health returned ${status}` };
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
 * The database has the columns the code believes it has.
 *
 * `prisma db push` fails silently on Supabase when it touches an auth-owned
 * table: it drops the new column and returns success. Six occurrences before
 * the raw-SQL fallback existed. `verify-db-tables.js` already checks this, but
 * only during a deploy -- so a table that disappears between deploys is
 * invisible until the next one.
 */
export async function checkSchema(): Promise<CheckResult> {
  const check = 'db-schema';
  const required = ['llm_call_logs', 'error_events', 'pipeline_events'];
  const rows = await getPrisma().$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY(${required})
  `;
  const found = rows.map((r) => r.table_name);
  const missing = required.filter((t) => !found.includes(t));
  if (missing.length > 0) {
    return { check, ok: false, detail: `missing tables: ${missing.join(', ')}`, context: { missing } };
  }

  // The column added on 2026-09-07, which the silent-drop failure mode would
  // take out first: it is new, and it is nullable.
  const cols = await getPrisma().$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'llm_call_logs'
       AND column_name IN ('cached_input_tokens', 'cost_usd', 'model', 'module')
  `;
  const names = cols.map((c) => c.column_name);
  const missingCols = ['cached_input_tokens', 'cost_usd', 'model', 'module'].filter(
    (c) => !names.includes(c)
  );
  if (missingCols.length > 0) {
    return {
      check,
      ok: false,
      detail: `llm_call_logs is missing columns: ${missingCols.join(', ')} — silent db push failure`,
      context: { missingCols },
    };
  }
  return { check, ok: true, detail: `${required.length} tables and 4 tracked columns present` };
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
    execSync('aws iam generate-credential-report', { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] });
    let csv = '';
    for (let attempt = 0; attempt < 3 && !csv; attempt += 1) {
      try {
        const b64 = execSync('aws iam get-credential-report --query Content --output text', { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
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
    const days = (iso: string) => (iso && iso !== 'N/A' && iso !== 'no_information' ? Math.floor((now - Date.parse(iso)) / 86_400_000) : null);
    const noMfa: string[] = [];
    const staleKeys: string[] = [];
    const unusedKeys: string[] = [];
    for (const line of rows) {
      const f = line.split(',');
      const user = f[idx('user')] ?? '';
      if (f[idx('password_enabled')] === 'true' && f[idx('mfa_active')] !== 'true') noMfa.push(user);
      for (const k of ['1', '2']) {
        if (f[idx(`access_key_${k}_active`)] !== 'true') continue;
        const age = days(f[idx(`access_key_${k}_last_rotated`)] ?? '');
        const used = days(f[idx(`access_key_${k}_last_used_date`)] ?? '');
        if (age !== null && age > KEY_MAX_AGE_DAYS) staleKeys.push(`${user}:key${k}:${age}d`);
        if (used === null && age !== null && age > KEY_UNUSED_DAYS) unusedKeys.push(`${user}:key${k}:never-used:${age}d`);
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
  const parsed = JSON.parse(out || '{}') as { metadata?: { vulnerabilities?: Record<string, number> } };
  const v = parsed.metadata?.vulnerabilities ?? {};
  return { critical: v['critical'] ?? 0, high: v['high'] ?? 0, moderate: v['moderate'] ?? 0, low: v['low'] ?? 0 };
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

export const ALL_CHECKS: Array<() => Promise<CheckResult>> = [
  checkDeployDrift,
  checkPublicSurface,
  checkTranscriptProxies,
  checkServiceReachability,
  checkLlmSpend,
  checkAwsCost,
  checkPipelineFreshness,
  checkSchema,
  checkIamHygiene,
  checkSupplyChain,
  checkCloudPosture,
];

export { report };
