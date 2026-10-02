/**
 * The checks that ask "is it working right now" -- run every fifteen minutes by
 * the in-cluster CronJob (run-cluster.ts).
 *
 * They need only the database and HTTP, which the cluster has. They used to run
 * from a GitHub runner, which meant thirty-minute schedules that GitHub delayed
 * to one to five hours, and a failure mail per red run. The checks that need a
 * repository checkout or AWS credentials (deploy drift, the certificate seen
 * from outside, cost, IAM, posture, supply chain) stay in scripts/keel and run
 * once a day.
 *
 * Each check says which incident it exists for, so nobody deletes one whose
 * cost they cannot see.
 */

import { HOURS_PER_DAY, MS_PER_HOUR } from '../../utils/time-constants';
import { keelConfig } from './config';
import {
  ALERT_DELIVERY_STAGE,
  alertChannelConfigured,
  getPrisma,
  lastDeliveryFailure,
  type CheckResult,
} from './ledger';

/** Requests that take longer than this are treated as a failure of the thing
 *  being probed, not as a slow network.
 *
 *  Must outlive the slowest thing the endpoint it calls waits on. The pod's
 *  `/health/dependencies` gives a sleeping transcript proxy
 *  PROXY_PROBE_TIMEOUT_MS = 15 s (src/config/transcript.ts); at the old 15 s
 *  here the two budgets were equal, so a proxy cold start could abort this
 *  fetch instead of being reported -- the check would fail on its own timeout
 *  and say nothing about the proxy. */
export const PROBE_TIMEOUT_MS = 25_000;

export async function fetchJson(
  url: string,
  init?: RequestInit
): Promise<{ status: number; body: unknown }> {
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
  const dailyLimit = keelConfig.llmDailyLimitUsd();
  const monthlyLimit = keelConfig.llmMonthlyLimitUsd();
  const warnAt = keelConfig.spendWarnRatio();

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

/** Ages under two days are printed in hours, longer ones in whole days. */
const AGE_IN_DAYS_FROM_HOURS = HOURS_PER_DAY * 2;

/** Allowed quiet period per surface, in hours. */
const LLM_CALLS_QUIET_HOURS = 26;
const SUMMARIES_QUIET_HOURS = HOURS_PER_DAY * 7;
const TRANSCRIPT_PIPELINE_QUIET_HOURS = HOURS_PER_DAY * 3;

const TRANSCRIPT_PIPELINE_LABEL = 'transcript pipeline';

interface Surface {
  table: string;
  label: string;
  /** Quiet period after which the surface is reported STALE. */
  hours: number;
  /** Reported for context only: the age is shown, but the surface is never
   *  marked STALE and never fails the check. */
  informational?: boolean;
}

/**
 * Surfaces, with how long each may be quiet before it is reported stale.
 *
 * video_summaries and pipeline_events are scheduled pipeline outputs and gate
 * the check. llm_call_logs is informational. Its 26 h allowance was set on
 * 2026-09-08, when the scheduled trend-collector called the LLM every day.
 * That job was disabled on 2026-09-10 under the LLM spend shutdown
 * (docs/ops/llm-spend-census-2026-09-10.md), so the table is now written only
 * when a user invokes an LLM feature. Its age therefore measures product usage,
 * not pipeline health, and a day without usage is not a fault. The age is still
 * reported because it shows whether the LLM path is being exercised at all.
 */
const SURFACES: Surface[] = [
  { table: 'llm_call_logs', label: 'LLM calls', hours: LLM_CALLS_QUIET_HOURS, informational: true },
  { table: 'video_summaries', label: 'summaries', hours: SUMMARIES_QUIET_HOURS },
  {
    table: 'pipeline_events',
    label: TRANSCRIPT_PIPELINE_LABEL,
    hours: TRANSCRIPT_PIPELINE_QUIET_HOURS,
  },
];

/** One row of the freshness query: the newest created_at per table, or null
 *  when the table has no rows. */
export interface FreshnessRow {
  t: string;
  newest: Date | null;
}

/**
 * What the newest row per surface means, separated from the query so the
 * judgement can be tested without a database. `now` is injected for the same
 * reason.
 */
export function interpretFreshness(
  rows: FreshnessRow[],
  now: number = Date.now()
): { ok: boolean; detail: string; context: Record<string, unknown> } {
  const seen = new Map(rows.map((r) => [r.t, r.newest]));
  const parts: string[] = [];
  const stale: string[] = [];
  const context: Record<string, unknown> = {};

  for (const s of SURFACES) {
    const newest = seen.get(s.table) ?? null;
    if (!newest) {
      parts.push(`${s.label} never`);
      if (!s.informational) stale.push(s.label);
      context[s.table] = null;
      continue;
    }
    const hours = (now - new Date(newest).getTime()) / MS_PER_HOUR;
    context[s.table] = {
      newest,
      hours: Number(hours.toFixed(1)),
      allowed: s.hours,
      ...(s.informational ? { informational: true } : {}),
    };
    const age =
      hours < AGE_IN_DAYS_FROM_HOURS
        ? `${hours.toFixed(0)}h`
        : `${(hours / HOURS_PER_DAY).toFixed(0)}d`;
    if (hours > s.hours && !s.informational) {
      parts.push(`${s.label} ${age} STALE`);
      stale.push(s.label);
    } else {
      parts.push(`${s.label} ${age}`);
    }
  }

  if (stale.length === 0) {
    return { ok: true, detail: parts.join(' · '), context };
  }

  // Naming the dependency turns a red flag into a next step, and naming the
  // wrong one sends the reader the wrong way -- this hint said "the cluster
  // cannot reach the Mac Mini", which is true and is not the cause. The traffic
  // runs the other way: the collector on the Mac Mini polls
  // /api/v1/internal/transcript/candidates and posts back, and the route
  // handler is the only writer of pipeline_events in the codebase. So this
  // surface going quiet means the collector stopped calling, not that the
  // cluster stopped reaching.
  const hint = stale.includes(TRANSCRIPT_PIPELINE_LABEL)
    ? ' — only the internal transcript route writes this, and the Mac Mini collector is what calls it'
    : '';
  return { ok: false, detail: `${parts.join(' · ')}${hint}`, context };
}

export async function checkPipelineFreshness(): Promise<CheckResult> {
  const check = 'pipeline-freshness';
  const rows = await getPrisma().$queryRawUnsafe<FreshnessRow[]>(
    SURFACES.map((s) => `SELECT '${s.table}' AS t, max(created_at) AS newest FROM ${s.table}`).join(
      ' UNION ALL '
    )
  );
  return { check, ...interpretFreshness(rows) };
}

/**
 * What a set of proxy probe results means, separated from fetching them so the
 * judgement can be tested without a network.
 *
 * Partial reachability is a failure, not a warning. The second proxy exists
 * because the first has gone down before; running on one is running with the
 * spare already used.
 */
export function interpretProxyHealth(deps: Array<{ name: string; ok: boolean; detail: string }>): {
  ok: boolean;
  detail: string;
} {
  if (deps.length === 0) {
    return {
      ok: false,
      detail: 'no transcript proxy is configured — captions cannot be fetched at all',
    };
  }
  const summary = deps.map((d) => `${d.name} ${d.ok ? 'ok' : d.detail}`).join(' · ');
  const reachable = deps.filter((d) => d.ok).length;
  if (reachable === 0) {
    return {
      ok: false,
      detail: `no proxy reachable — transcripts, summaries and notes are all blocked · ${summary}`,
    };
  }
  if (reachable < deps.length) {
    return { ok: false, detail: `${reachable}/${deps.length} reachable · ${summary}` };
  }
  return { ok: true, detail: summary };
}

type ProxyProbe = { name: string; ok: boolean; detail: string };

/**
 * The Azure proxy runs on App Service Free (F1), which has no Always On: after
 * an idle period the app is unloaded and the next request starts it again.
 * Azure's own HttpResponseTime maximum in those hours was 6.2-7.6 s
 * (2026-09-15..17; once 67 s), and the API's dependency probe gives up at 5 s
 * (src/api/server.ts), so a sleeping proxy read as AbortError and turned this
 * check red 13 times in 22 runs while captions kept working: the extractor
 * waits 30 s for the same proxy (src/modules/caption/extractor.ts).
 *
 * A proxy that timed out is asked again after COLD_START_RETRY_DELAY_MS. The
 * first probe has already started the app; only a second timeout counts as
 * down. Refusals, 401s and DNS errors are not retried: waiting does not fix
 * them.
 */
export const COLD_START_RETRY_DELAY_MS = 10_000;
const TIMEOUT_DETAILS = new Set(['AbortError', 'TIMEOUT', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT']);

/** Names of proxies whose probe failed by timing out. */
export function timedOutProxies(deps: ProxyProbe[]): string[] {
  return deps.filter((d) => !d.ok && TIMEOUT_DETAILS.has(d.detail)).map((d) => d.name);
}

/** First-probe results, with the retried proxies replaced by their second probe. */
export function mergeProxyRetry(
  first: ProxyProbe[],
  retry: ProxyProbe[],
  retried: string[]
): ProxyProbe[] {
  const again = new Map(retry.map((d) => [d.name, d]));
  return first.map((d) => (retried.includes(d.name) ? (again.get(d.name) ?? d) : d));
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
    const { status, body } = await fetchJson(`${keelConfig.baseUrl()}/health/dependencies`);
    if (status === 404) {
      return {
        check,
        ok: true,
        detail: 'production does not report services yet (deploy this change first)',
      };
    }
    if (status !== 200)
      return { check, ok: false, detail: `GET /health/dependencies returned ${status}` };
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
  return {
    check,
    ok: true,
    detail: `${services.filter((s) => s.ok).length} services reachable`,
    context: ctx,
  };
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
 * Asks the API pod to make the call, through an endpoint that reports
 * reachability and nothing else: the pod is what has to reach the proxies (one
 * behind a Tailscale address, one a private host), so its view is the one that
 * matters.
 */
export async function checkTranscriptProxies(): Promise<CheckResult> {
  const check = 'transcript-proxies';
  const probe = async (): Promise<{ status: number; deps?: ProxyProbe[] }> => {
    const { status, body } = await fetchJson(`${keelConfig.baseUrl()}/health/dependencies`);
    return { status, deps: (body as { transcriptProxies?: ProxyProbe[] }).transcriptProxies };
  };
  try {
    const first = await probe();
    if (first.status === 404) {
      return {
        check,
        ok: true,
        detail: 'production does not report dependencies yet (deploy this change first)',
      };
    }
    if (first.status !== 200)
      return { check, ok: false, detail: `GET /health/dependencies returned ${first.status}` };
    if (!first.deps || first.deps.length === 0) {
      return {
        check,
        ok: false,
        detail: 'no transcript proxy is configured — captions cannot be fetched at all',
      };
    }

    let deps = first.deps;
    const retried = timedOutProxies(deps);
    if (retried.length > 0) {
      await new Promise((r) => setTimeout(r, COLD_START_RETRY_DELAY_MS));
      const second = await probe();
      if (second.status === 200 && second.deps) deps = mergeProxyRetry(deps, second.deps, retried);
    }

    const { ok, detail } = interpretProxyHealth(deps);
    const note = retried.length > 0 ? ` · retried after a timeout: ${retried.join(', ')}` : '';
    return {
      check,
      ok,
      detail: `${detail}${note}`,
      context: { deps, ...(retried.length > 0 ? { firstProbe: first.deps, retried } : {}) },
    };
  } catch (err) {
    return { check, ok: false, detail: `GET /health/dependencies failed: ${String(err)}` };
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
    return {
      check,
      ok: false,
      detail: `missing tables: ${missing.join(', ')}`,
      context: { missing },
    };
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
 * Whether an alert can reach a person at all.
 *
 * The check that had to exist. Every other check here answers a question about
 * the service; this one answers the question about the monitor, and the monitor
 * was failing it silently: SLACK_ALERT_WEBHOOK has never been set (48 repo
 * secrets, measured 2026-09-21), postToSlack returned early when it was absent,
 * and report() counted the alert as sent anyway -- so the run log has been
 * printing "1 alert(s) sent" for every transition since the day this shipped
 * while nothing left the process.
 *
 * An unconfigured channel cannot be announced through the channel. It is listed
 * in the standing section of every run, and the daily GitHub run escalates the
 * cluster's confirmed worsenings in its place (scripts/keel/checks.ts
 * checkClusterKeel).
 *
 * Configuration plus the last recorded outcome, not a live send: posting a test
 * message every fifteen minutes would flood the channel this is meant to keep
 * usable.
 */
export async function checkAlertDelivery(): Promise<CheckResult> {
  // The unconfigured answer needs no database, which matters: this is the check
  // that has to work when other things do not.
  const configured = alertChannelConfigured();
  const lastFailure = configured ? await lastDeliveryFailure() : null;
  return { check: ALERT_DELIVERY_STAGE, ...interpretAlertDelivery({ configured, lastFailure }) };
}

/** How recent a delivery failure has to be to still count as broken: several
 *  runs of the fifteen-minute schedule. */
export const DELIVERY_FAILURE_WINDOW_HOURS = 2;

/**
 * The judgement, separated from the reads so it can be tested without either an
 * environment or a database.
 */
export function interpretAlertDelivery(input: {
  configured: boolean;
  lastFailure: { at: Date; message: string } | null;
  now?: number;
}): { ok: boolean; detail: string; context: Record<string, unknown> } {
  const { configured, lastFailure, now = Date.now() } = input;
  if (!configured) {
    return {
      ok: false,
      detail:
        'no alert channel configured (SLACK_ALERT_WEBHOOK) — transitions reach the ledger and this workflow, nobody else',
      context: { configured: false },
    };
  }
  if (lastFailure) {
    const ageHours = Math.round((now - lastFailure.at.getTime()) / MS_PER_HOUR);
    // A webhook that is revoked or rotated answers 403 and the alert is lost.
    // Recent means recent: an older row is a failure that has since recovered.
    if (ageHours <= DELIVERY_FAILURE_WINDOW_HOURS) {
      return {
        ok: false,
        detail: `last alert was not delivered ${ageHours}h ago — ${lastFailure.message}`,
        context: { configured: true, lastFailureAt: lastFailure.at.toISOString() },
      };
    }
  }
  return {
    ok: true,
    detail: lastFailure
      ? `channel configured · last delivery failure ${lastFailure.at.toISOString().slice(0, 10)}, outside the window`
      : 'channel configured · no delivery failure on record',
    context: { configured: true },
  };
}

/** Run by the CronJob, every fifteen minutes. */
export const CLUSTER_CHECKS: Array<() => Promise<CheckResult>> = [
  checkTranscriptProxies,
  checkServiceReachability,
  checkLlmSpend,
  checkPipelineFreshness,
  checkSchema,
  checkAlertDelivery,
];
