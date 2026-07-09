/**
 * Daily error-log check (incident-response follow-up, 2026-07-09).
 *
 * Once a day, aggregate YESTERDAY's failures across every subsystem that records
 * an error to a queryable Postgres table, mail a digest to the operator, and flag
 * spikes vs the prior day. Read-only over the error tables; no serving path
 * touched. Same pg-boss + mailer pattern as the metrics rollup/report.
 *
 * WHY: this session's cost incident (Sonnet re-called on parse failures) stayed
 * hidden because book-fill hard-fails only reached ephemeral winston logs. Those
 * (and embedding batch failures) now also write `error_events`; this job surfaces
 * them together with the always-on error columns (llm_call_logs.status,
 * pgboss.job state='failed', mandala_*_error, skill_runs.error, sync errors).
 *
 * Inert when OBSERVABILITY_ALERT_EMAIL is unset (build + log, skip send).
 */

import { getPrismaClient } from '@/modules/database/client';
import { config } from '@/config/index';
import { logger } from '@/utils/logger';
import { transporter } from '@/modules/skills/mailer';
import { getJobQueue } from '../manager';
import { JOB_NAMES, QUEUE_CONFIG } from '../types';
import { rollupWindow } from './search-metrics-rollup';

const log = logger.child({ module: 'error-log-check' });

/** A spike is flagged when a source's count grows by >= this fraction vs prior. */
const SPIKE_FRAC = 0.5;
/** …but only once it clears this absolute floor (ignore 1→2 noise). */
const SPIKE_MIN = 5;
/** Cap the per-source breakdown rows in the email. */
const TOP_N = 8;

const n = (v: unknown): number =>
  v == null ? 0 : typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number(v);

/** A grouped breakdown line (module/model, job name, subsystem/stage). */
export interface ErrorBreakdown {
  key: string;
  count: number;
}

export interface ErrorSummary {
  llmErrors: number;
  llmBy: ErrorBreakdown[]; // module · model
  jobsFailed: number;
  jobsBy: ErrorBreakdown[]; // pgboss job name
  mandalaCreateErrors: number;
  pipelineFailed: number;
  wizardFailed: number;
  skillErrors: number;
  syncErrors: number;
  /** null = discover tracing flag OFF (not measured), never a misleading 0. */
  discoverTraceErrors: number | null;
  eventsTotal: number;
  eventsBy: ErrorBreakdown[]; // subsystem · stage (the log-only blind spots)
  grandTotal: number;
}

/** Aggregate every queryable error source for [start, end). Read-only. */
export async function computeErrorSummary(start: Date, end: Date): Promise<ErrorSummary> {
  const db = getPrismaClient();

  // ── LLM call failures (widest coverage — every OpenRouter/Ollama error) ──
  const llmRows = await db.$queryRaw<{ k: string; c: bigint }[]>`
    SELECT module || ' · ' || model AS k, count(*) AS c
    FROM public.llm_call_logs
    WHERE status IN ('error', 'blocked') AND created_at >= ${start} AND created_at < ${end}
    GROUP BY 1 ORDER BY 2 DESC`;
  const llmErrors = llmRows.reduce((s, r) => s + n(r.c), 0);

  // ── pg-boss failed jobs (generic — ALL queue handlers that threw) ──
  const jobRows = await db.$queryRaw<{ k: string; c: bigint }[]>`
    SELECT name AS k, count(*) AS c
    FROM pgboss.job
    WHERE state = 'failed' AND createdon >= ${start} AND createdon < ${end}
    GROUP BY 1 ORDER BY 2 DESC`;
  const jobsFailed = jobRows.reduce((s, r) => s + n(r.c), 0);

  // ── mandala generation + pipeline + wizard ──
  const [mc] = await db.$queryRaw<{ c: bigint }[]>`
    SELECT count(*) AS c FROM public.mandala_create_timings
    WHERE outcome = 'error' AND created_at >= ${start} AND created_at < ${end}`;
  const [pl] = await db.$queryRaw<{ c: bigint }[]>`
    SELECT count(*) AS c FROM public.mandala_pipeline_runs
    WHERE status = 'failed' AND created_at >= ${start} AND created_at < ${end}`;
  const [wz] = await db.$queryRaw<{ c: bigint }[]>`
    SELECT count(*) AS c FROM public.mandala_wizard_precompute
    WHERE status = 'failed' AND created_at >= ${start} AND created_at < ${end}`;

  // ── skill runs + youtube sync ──
  const [sk] = await db.$queryRaw<{ c: bigint }[]>`
    SELECT count(*) AS c FROM public.skill_runs
    WHERE error IS NOT NULL AND started_at >= ${start} AND started_at < ${end}`;
  const [sy] = await db.$queryRaw<{ c: bigint }[]>`
    SELECT count(*) AS c FROM public.youtube_sync_history
    WHERE error_message IS NOT NULL AND started_at >= ${start} AND started_at < ${end}`;

  // ── discover tracing — flag-gated (null ≠ 0 when the flag is OFF) ──
  let discoverTraceErrors: number | null = null;
  if (config.discoverTracing.enabled) {
    const [dt] = await db.$queryRaw<{ c: bigint }[]>`
      SELECT count(*) AS c FROM public.video_discover_traces
      WHERE status = 'error' AND created_at >= ${start} AND created_at < ${end}`;
    discoverTraceErrors = n(dt?.c);
  }

  // ── error_events (the log-only blind spots: book-fill hard-fail, embed fail) ──
  const evRows = await db.$queryRaw<{ k: string; c: bigint }[]>`
    SELECT subsystem || ' · ' || stage AS k, count(*) AS c
    FROM public.error_events
    WHERE created_at >= ${start} AND created_at < ${end}
    GROUP BY 1 ORDER BY 2 DESC`;
  const eventsTotal = evRows.reduce((s, r) => s + n(r.c), 0);

  const grandTotal =
    llmErrors +
    jobsFailed +
    n(mc?.c) +
    n(pl?.c) +
    n(wz?.c) +
    n(sk?.c) +
    n(sy?.c) +
    (discoverTraceErrors ?? 0) +
    eventsTotal;

  return {
    llmErrors,
    llmBy: llmRows.slice(0, TOP_N).map((r) => ({ key: r.k, count: n(r.c) })),
    jobsFailed,
    jobsBy: jobRows.slice(0, TOP_N).map((r) => ({ key: r.k, count: n(r.c) })),
    mandalaCreateErrors: n(mc?.c),
    pipelineFailed: n(pl?.c),
    wizardFailed: n(wz?.c),
    skillErrors: n(sk?.c),
    syncErrors: n(sy?.c),
    discoverTraceErrors,
    eventsTotal,
    eventsBy: evRows.slice(0, TOP_N).map((r) => ({ key: r.k, count: n(r.c) })),
    grandTotal,
  };
}

/** One source row for the report table (label, today, prior, is-spike). */
interface SourceSpec {
  label: string;
  today: number;
  prior: number | null;
}

/** Pure HTML builder — no I/O, unit-testable. */
export function buildErrorReportHtml(
  metricDate: string,
  today: ErrorSummary,
  prior: ErrorSummary | null
): { subject: string; html: string; spikes: string[] } {
  const spikes: string[] = [];

  const sources: SourceSpec[] = [
    {
      label: 'LLM 호출 실패 (error/blocked)',
      today: today.llmErrors,
      prior: prior?.llmErrors ?? null,
    },
    {
      label: '큐 잡 실패 (pgboss failed)',
      today: today.jobsFailed,
      prior: prior?.jobsFailed ?? null,
    },
    {
      label: '만다라 생성 실패',
      today: today.mandalaCreateErrors,
      prior: prior?.mandalaCreateErrors ?? null,
    },
    { label: '파이프라인 실패', today: today.pipelineFailed, prior: prior?.pipelineFailed ?? null },
    {
      label: '위저드 사전계산 실패',
      today: today.wizardFailed,
      prior: prior?.wizardFailed ?? null,
    },
    { label: '스킬 실행 오류', today: today.skillErrors, prior: prior?.skillErrors ?? null },
    { label: 'YouTube 동기화 오류', today: today.syncErrors, prior: prior?.syncErrors ?? null },
    {
      label: 'error_events (로그전용 사각지대)',
      today: today.eventsTotal,
      prior: prior?.eventsTotal ?? null,
    },
  ];

  const row = (s: SourceSpec): string => {
    let delta = '—';
    let spiked = false;
    if (s.prior != null) {
      const d = s.today - s.prior;
      const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '·';
      const color = d > 0 ? '#e6675e' : d < 0 ? '#5cc98a' : '#9aa';
      delta = `<span style="color:${color}">${arrow} ${d > 0 ? '+' : ''}${d}</span>`;
      if (
        d > 0 &&
        s.today >= SPIKE_MIN &&
        s.prior >= 0 &&
        d >= Math.max(SPIKE_MIN, s.prior * SPIKE_FRAC)
      ) {
        spiked = true;
        spikes.push(`${s.label}: ${s.prior}→${s.today}`);
      }
    } else if (s.today >= SPIKE_MIN) {
      // No prior baseline but a non-trivial count today → worth surfacing.
      spiked = true;
      spikes.push(`${s.label}: ${s.today} (기준 없음)`);
    }
    const mark = spiked ? ' 🔺' : '';
    const bg = spiked ? 'background:#2a1414' : '';
    return `<tr style="${bg}"><td style="opacity:.85">${s.label}${mark}</td><td>${s.today}</td><td>${delta}</td></tr>`;
  };

  const rows = sources.map(row).join('');

  const bd = (list: ErrorBreakdown[]): string =>
    list.length ? list.map((b) => `${b.key} = ${b.count}`).join(' · ') : '—';

  const trace =
    today.discoverTraceErrors == null
      ? '미측정 (discover trace flag OFF)'
      : String(today.discoverTraceErrors);

  const clean = today.grandTotal === 0;
  const banner = clean
    ? `<div style="background:#152a1a;color:#5cc98a;padding:10px;border-radius:6px">✓ 어제 에러 0건 — 이상 없음</div>`
    : spikes.length
      ? `<div style="background:#3a1a1a;color:#e6675e;padding:10px;border-radius:6px">🔺 스파이크: ${spikes.join(' / ')}</div>`
      : `<div style="background:#3a2a12;color:#f0c674;padding:10px;border-radius:6px">에러 ${today.grandTotal}건 (전일 대비 스파이크 없음)</div>`;

  const subject = clean
    ? `Insighta 에러로그 ${metricDate} — 이상 없음`
    : spikes.length
      ? `🔺 Insighta 에러로그 ${metricDate} — 스파이크 ${spikes.length}건 (총 ${today.grandTotal})`
      : `Insighta 에러로그 ${metricDate} — ${today.grandTotal}건`;

  const html = `<div style="font-family:system-ui,sans-serif;background:#0b0d10;color:#dfe3e8;padding:18px;max-width:640px">
    <h2 style="margin:0 0 4px">Insighta 일일 에러로그 리포트</h2>
    <div style="opacity:.6;margin-bottom:12px">${metricDate} · 총 ${today.grandTotal}건${prior ? ` (전일 ${prior.grandTotal})` : ''}</div>
    ${banner}
    <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:13px">
      <tr style="opacity:.5;text-align:left"><th>소스</th><th>어제</th><th>Δ 전일</th></tr>
      ${rows}
    </table>
    <p style="margin-top:12px;opacity:.8;font-size:12px"><b>LLM 실패 내역</b>: ${bd(today.llmBy)}</p>
    <p style="opacity:.8;font-size:12px"><b>실패 잡</b>: ${bd(today.jobsBy)}</p>
    <p style="opacity:.8;font-size:12px"><b>error_events</b>: ${bd(today.eventsBy)}</p>
    <p style="opacity:.8;font-size:12px"><b>discover trace 오류</b>: ${trace}</p>
    <p style="opacity:.4;font-size:11px;margin-top:16px">관측 전용 · 서빙 무변경 · error_events = winston-only 사각지대(book-fill hard-fail / embed fail)를 DB로 승격.</p>
  </div>`;

  return { subject, html, spikes };
}

/** Send the daily error digest (no-op when the alert email is unset). */
export async function sendErrorReport(
  metricDate: string,
  today: ErrorSummary,
  prior: ErrorSummary | null
): Promise<boolean> {
  const to = config.observability.alertEmail;
  const { subject, html, spikes } = buildErrorReportHtml(metricDate, today, prior);
  if (!to) {
    log.info(
      `error digest ${metricDate} built (total=${today.grandTotal}, spikes=${spikes.length}) — email unset, skipped`
    );
    return false;
  }
  try {
    await transporter.sendMail({ from: config.gmail.smtpFrom, to, subject, html });
    log.info(
      `error digest emailed to ${to} (${metricDate}, total=${today.grandTotal}, spikes=${spikes.length})`
    );
    return true;
  } catch (err) {
    log.warn(
      `error digest email failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}

async function handleErrorLogCheck(): Promise<void> {
  try {
    const { start, end, metricDate } = rollupWindow(new Date());
    const today = await computeErrorSummary(start, end);
    // Prior full UTC day, for spike detection.
    const priorStart = new Date(start.getTime() - 86_400_000);
    const prior = await computeErrorSummary(priorStart, start);
    await sendErrorReport(metricDate.toISOString().slice(0, 10), today, prior);
  } catch (err) {
    log.warn(
      `error-log-check failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** Register the error-log-check worker + daily schedule. Call after JobQueue.start(). */
export async function registerErrorLogCheckWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();
  await boss.work(JOB_NAMES.ERROR_LOG_CHECK, handleErrorLogCheck);
  await boss.schedule(JOB_NAMES.ERROR_LOG_CHECK, QUEUE_CONFIG.ERROR_LOG_CHECK_CRON);
  log.info(
    `error-log-check worker registered + scheduled (cron=${QUEUE_CONFIG.ERROR_LOG_CHECK_CRON})`
  );
}
