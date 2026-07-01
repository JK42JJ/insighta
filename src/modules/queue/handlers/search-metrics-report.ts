/**
 * Observability Phase 2-B (iii) — daily report email (§5 of the design SSOT).
 *
 * Renders today's search_metrics_daily snapshot + delta vs the prior day +
 * a regression banner + highlights, and mails it to the operator. admin-only,
 * inert when OBSERVABILITY_ALERT_EMAIL is unset.
 *
 * Guard 1 (null ≠ 0): a NULL metric is rendered as "미측정" with its reason
 *   (Phase 3 golden-cohort / trace 데이터 없음), never as a bad 0.
 * Guard 2 (no duplicate alarm): active_search_keys is shown as a METRIC only —
 *   the 🔴 multi-key alarm fires from the dedicated key-alarm job (Phase 2-A),
 *   not from this report.
 */

import { config } from '@/config/index';
import { logger } from '@/utils/logger';
import { transporter } from '@/modules/skills/mailer';
import type { DailyMetrics } from './search-metrics-rollup';

const log = logger.child({ module: 'search-metrics-report' });

/** A scalar metric shown in the report table. dir = which direction is better. */
interface MetricSpec {
  key: keyof DailyMetrics;
  label: string;
  unit: string;
  dir: 'up' | 'down' | 'neutral';
}

const SPECS: MetricSpec[] = [
  { key: 'requests', label: '요청 수', unit: '', dir: 'neutral' },
  { key: 'cards_p50', label: '충분성 · 카드수 P50', unit: '', dir: 'up' },
  { key: 'pct_ge_50', label: '충분성 · %≥50', unit: '%', dir: 'up' },
  { key: 'pct_honest_partial', label: '충분성 · %honest-partial', unit: '%', dir: 'down' },
  { key: 'gc_median', label: '관련성 · gc 중앙값', unit: '', dir: 'up' },
  { key: 'pct_le_6mo', label: '신선도 · %≤6mo', unit: '%', dir: 'up' },
  { key: 'top_channel_share', label: '다양성 · top-channel share', unit: '%', dir: 'down' },
  { key: 'channel_hhi', label: '다양성 · HHI', unit: '', dir: 'down' },
  { key: 'pct_view_lt_1000', label: '정합 · %view<1000', unit: '%', dir: 'down' },
  { key: 'off_lang_drops', label: '정합 · off-lang drops', unit: '', dir: 'down' },
  { key: 'pool_active', label: '풀 · 활성', unit: '', dir: 'up' },
  { key: 'pool_embedded', label: '풀 · 임베딩', unit: '', dir: 'up' },
  { key: 'pool_ttl_expired_pct', label: '풀 · TTL만료%', unit: '%', dir: 'down' },
  { key: 'quota_units_total', label: '쿼타 · 일 units', unit: '', dir: 'neutral' },
  { key: 'active_search_keys', label: '쿼타 · 활성 SEARCH 키 (알람=2-A)', unit: '', dir: 'down' },
];

/** Metrics whose NULL means "Phase 3 golden-cohort offline", not "no data". */
const PHASE3_KEYS = new Set<keyof DailyMetrics>(['gc_median']);

/** Regression: a metric moved the wrong way by >= this fraction vs prior. */
const REGRESSION_FRAC = 0.15;

export interface ReportHighlights {
  /** A representative bad-mandala trace for the deep link (Trace Explorer). */
  worstTrace?: { traceId: string; mandalaId: string | null; cards: number } | null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' ? v : v == null ? null : Number(v);
}

/** Pure HTML builder. `prior` may be any object with the same field names. */
export function buildDailyReportHtml(
  metricDate: string,
  today: DailyMetrics,
  prior: Partial<Record<keyof DailyMetrics, unknown>> | null,
  highlights: ReportHighlights = {}
): { subject: string; html: string; regressions: string[] } {
  const noData = (today.requests ?? 0) === 0;
  const regressions: string[] = [];

  const cell = (spec: MetricSpec): string => {
    const t = num(today[spec.key]);
    if (t == null) {
      const reason = PHASE3_KEYS.has(spec.key)
        ? '미측정 (Phase 3 골든코호트)'
        : noData
          ? '미측정 (trace 데이터 없음 · flag OFF?)'
          : '미측정';
      return `<td>${reason}</td><td>—</td>`;
    }
    const p = prior ? num(prior[spec.key]) : null;
    let delta = '—';
    if (p != null) {
      const d = Math.round((t - p) * 100) / 100;
      const worse = (spec.dir === 'up' && d < 0) || (spec.dir === 'down' && d > 0);
      const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '·';
      const color = d === 0 || spec.dir === 'neutral' ? '#9aa' : worse ? '#e6675e' : '#5cc98a';
      delta = `<span style="color:${color}">${arrow} ${d > 0 ? '+' : ''}${d}</span>`;
      // Regression flag (only for directional metrics with a meaningful base).
      if (
        worse &&
        spec.dir !== 'neutral' &&
        Math.abs(p) > 0 &&
        Math.abs(d) / Math.abs(p) >= REGRESSION_FRAC
      ) {
        regressions.push(`${spec.label}: ${p}→${t}`);
      }
    }
    return `<td>${t}${spec.unit}</td><td>${delta}</td>`;
  };

  const rows = SPECS.map((s) => `<tr><td style="opacity:.85">${s.label}</td>${cell(s)}</tr>`).join(
    ''
  );

  const funnel = today.funnel
    ? Object.entries(today.funnel)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}=${v}`)
        .join(' · ')
    : '미측정 (trace 데이터 없음)';

  const banner = noData
    ? `<div style="background:#3a2a12;color:#f0c674;padding:10px;border-radius:6px">⚠ 어제 trace 0건 — 대부분 지표 미측정 (SEARCH_TRACE_ENABLED OFF 가능성). 값 0이 아니라 "측정 안 됨".</div>`
    : regressions.length
      ? `<div style="background:#3a1a1a;color:#e6675e;padding:10px;border-radius:6px">🔻 회귀 감지: ${regressions.join(' / ')}</div>`
      : `<div style="background:#152a1a;color:#5cc98a;padding:10px;border-radius:6px">✓ 전일 대비 회귀 없음</div>`;

  const worst = highlights.worstTrace;
  const highlightHtml = worst
    ? `<p style="opacity:.8">가장 빈약한 요청: mandala <code>${worst.mandalaId ?? '(wizard)'}</code> · ${worst.cards} 카드 · trace <code>${worst.traceId}</code> (Trace Explorer 딥링크 예정)</p>`
    : '';

  const subject = noData
    ? `Insighta 관측 ${metricDate} — trace 미측정`
    : regressions.length
      ? `🔻 Insighta 관측 ${metricDate} — 회귀 ${regressions.length}건`
      : `Insighta 관측 ${metricDate} — 정상`;

  const html = `<div style="font-family:system-ui,sans-serif;background:#0b0d10;color:#dfe3e8;padding:18px;max-width:640px">
    <h2 style="margin:0 0 4px">Insighta 검색 관측 일일 리포트</h2>
    <div style="opacity:.6;margin-bottom:12px">${metricDate} · algo=${today.algorithm_version ?? 'n/a'} · trace_flag=${String((today.flags_snapshot as { search_trace_enabled?: boolean })?.search_trace_enabled)}</div>
    ${banner}
    <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:13px">
      <tr style="opacity:.5;text-align:left"><th>지표</th><th>오늘</th><th>Δ 전일</th></tr>
      ${rows}
    </table>
    <p style="margin-top:12px;opacity:.8"><b>퍼널</b>: ${funnel}</p>
    ${highlightHtml}
    <p style="opacity:.4;font-size:11px;margin-top:16px">관측 전용 · 서빙 무변경 · gc/커버리지는 Phase 3 골든코호트 오프라인. 8키 알람은 별도(2-A).</p>
  </div>`;

  return { subject, html, regressions };
}

/** Send the daily report to the operator inbox (no-op when the email is unset). */
export async function sendDailyReport(
  metricDate: string,
  today: DailyMetrics,
  prior: Partial<Record<keyof DailyMetrics, unknown>> | null,
  highlights: ReportHighlights = {}
): Promise<boolean> {
  const to = config.observability.alertEmail;
  const { subject, html, regressions } = buildDailyReportHtml(metricDate, today, prior, highlights);
  if (!to) {
    log.info(
      `daily report ${metricDate} built (regressions=${regressions.length}) — email unset, skipped`
    );
    return false;
  }
  try {
    await transporter.sendMail({ from: config.gmail.smtpFrom, to, subject, html });
    log.info(`daily report emailed to ${to} (${metricDate}, regressions=${regressions.length})`);
    return true;
  } catch (err) {
    log.warn(
      `daily report email failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}
