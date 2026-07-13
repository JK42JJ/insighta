/**
 * Collapse watch — 15-min wizard-funnel guard (perf-monitor PR4, 2026-07-13).
 *
 * The daily report compares yesterday vs the day before — a 7/3-class
 * collapse surfaces up to 24h late. This job checks the LAST HOUR of new
 * mandalas every 15 minutes against the collapse-band thresholds
 * (src/config/collapse-watch.ts, shared with the diagnosis endpoint) and
 * mails immediately on violation.
 *
 * Supervisor review (2026-07-13) — alert-channel hardening:
 *  - Email alone re-runs a recorded failure (7/1 alarm buried under 173
 *    mails, 8 days unseen): unresolved violations RE-SEND daily (violation
 *    state persisted as a manual-source config_change_events row would be
 *    overkill — a tiny in-DB kv via pgboss singleton suffices: we re-alert
 *    when the violation persists past the cooldown AND escalate the subject
 *    with the running day count).
 *  - Dead-man switch: a daily heartbeat mail proves the watcher itself is
 *    alive — heartbeat ABSENCE is the alarm for a dead watcher/mailer.
 *  - Known risk: Google Workspace billing lapses 2026-08-04 → mailer dies;
 *    the dead-man silence covers that failure mode too.
 *
 * Windows with zero new mandalas are skipped (no false alarms overnight).
 * Flag: COLLAPSE_WATCH_ENABLED (unset = workers registered but no-op).
 */

import type PgBoss from 'pg-boss';
import { getPrismaClient } from '@/modules/database/client';
import {
  loadCollapseThresholds,
  isCollapseWatchEnabled,
  shouldAlert as shouldAlertPure,
  clearResolved as clearResolvedPure,
  type AlertState,
} from '@/config/collapse-watch';
import { transporter } from '@/modules/skills/mailer';
import { config } from '@/config/index';
import { logger } from '@/utils/logger';
import { getJobQueue } from '../manager';
import { JOB_NAMES, QUEUE_CONFIG } from '../types';

const log = logger.child({ module: 'collapse-watch' });

interface WatchViolation {
  metric: string;
  value: number;
  threshold: number;
  direction: 'above' | 'below';
}

/**
 * In-process alert state. Restart resets it — acceptable: the next 15-min
 * tick re-detects a persisting violation and re-alerts (at worst one extra
 * mail per restart, never a silent gap). Machine itself lives in the config
 * module (pure, unit-tested there).
 */
const alertState: AlertState = { lastAlertAt: new Map(), firstSeenAt: new Map() };
const shouldAlert = (metric: string, now: number) => shouldAlertPure(metric, now, alertState);
const clearResolved = (active: Set<string>) => clearResolvedPure(active, alertState);

async function measureLastHour(): Promise<{ mandalas: number; violations: WatchViolation[] }> {
  const db = getPrismaClient();
  const t = loadCollapseThresholds();
  const rows = await db.$queryRaw<
    {
      mandalas: number;
      place_off_p50_s: number | null;
      cards_p50: number | null;
      shorts: number;
      hit_rate: number | null;
      precompute_p95_s: number | null;
    }[]
  >`
    WITH m AS (
      SELECT um.id,
        (SELECT count(*)::int FROM user_video_states s WHERE s.mandala_id = um.id) AS cards,
        (SELECT count(*)::int FROM user_video_states s
          JOIN youtube_videos v ON v.id = s.video_id
          WHERE s.mandala_id = um.id AND v.duration_seconds > 0 AND v.duration_seconds <= 180) AS shorts,
        (SELECT extract(epoch FROM (min(s.created_at) - um.created_at))
          FROM user_video_states s WHERE s.mandala_id = um.id) AS first_card_off_s
      FROM user_mandalas um WHERE um.created_at > now() - interval '1 hour'
    ), p AS (
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE status = 'consumed')::int AS consumed,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (updated_at - created_at)))
          FILTER (WHERE status IN ('done','consumed')) AS dur_p95_s
      FROM mandala_wizard_precompute WHERE created_at > now() - interval '1 hour'
    )
    SELECT (SELECT count(*)::int FROM m) AS mandalas,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY first_card_off_s) FROM m) AS place_off_p50_s,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY cards) FROM m) AS cards_p50,
      (SELECT coalesce(sum(shorts), 0)::int FROM m) AS shorts,
      (SELECT CASE WHEN total > 0 THEN consumed::float / total END FROM p) AS hit_rate,
      (SELECT dur_p95_s FROM p) AS precompute_p95_s`;

  const w = rows[0];
  if (!w || w.mandalas === 0) return { mandalas: 0, violations: [] };

  const violations: WatchViolation[] = [];
  const check = (
    metric: string,
    value: number | null,
    threshold: number,
    direction: 'above' | 'below'
  ) => {
    if (value == null) return;
    if (direction === 'above' ? value > threshold : value < threshold) {
      violations.push({ metric, value, threshold, direction });
    }
  };
  check('place_off_p50_s', w.place_off_p50_s, t.placeOffP50MaxSec, 'above');
  check('hit_rate', w.hit_rate, t.hitRateMin, 'below');
  check('cards_p50', w.cards_p50, t.cardsP50Min, 'below');
  check('precompute_p95_s', w.precompute_p95_s, t.precomputeP95MaxSec, 'above');
  check('shorts_1h', w.shorts, t.shortsMax, 'above');
  return { mandalas: w.mandalas, violations };
}

async function recentChangeEventsHtml(): Promise<string> {
  try {
    const db = getPrismaClient();
    const events = await db.config_change_events.findMany({
      where: { created_at: { gt: new Date(Date.now() - 24 * 3600 * 1000) } },
      orderBy: { created_at: 'desc' },
      take: 10,
    });
    if (events.length === 0) {
      return '<p style="color:#e6a23c">직전 24h 변경 이벤트 없음 — <b>외부 원인 신호</b> (임베딩 제공자·YouTube). provider probe로 분기.</p>';
    }
    const rows = events
      .map((e) => {
        const diff = e.diff
          ? Object.entries(e.diff as Record<string, { from: string | null; to: string | null }>)
              .map(([k, v]) => `${k}:${v.from ?? '∅'}→${v.to ?? '∅'}`)
              .join(' ')
          : '';
        return `<tr><td>${e.created_at.toISOString().slice(5, 16)}</td><td>${e.source}</td><td>${(e.git_sha ?? '').slice(0, 8)}</td><td>${e.note ?? diff}</td></tr>`;
      })
      .join('');
    return `<p>직전 24h 변경 이벤트 (1순위 용의자):</p><table border="0" cellpadding="4" style="font-size:12px;color:#ccc">${rows}</table>`;
  } catch {
    return '';
  }
}

export async function handleCollapseWatch(jobs: PgBoss.Job | PgBoss.Job[]): Promise<void> {
  void (Array.isArray(jobs) ? jobs[0] : jobs);
  if (!isCollapseWatchEnabled()) return;
  const to = config.observability.alertEmail;
  if (!to) return;

  const { mandalas, violations } = await measureLastHour();
  if (mandalas === 0) return; // quiet hours — no data, no alarm

  const active = new Set(violations.map((v) => v.metric));
  clearResolved(active);
  if (violations.length === 0) return;

  const now = Date.now();
  const toSend = violations
    .map((v) => ({ v, s: shouldAlert(v.metric, now) }))
    .filter((x) => x.s.alert);
  if (toSend.length === 0) return;

  const maxDays = Math.max(...toSend.map((x) => x.s.escalationDays));
  const subject =
    (maxDays > 0 ? `🔻 [미해소 ${maxDays}일차] ` : '🔻 ') +
    `Insighta 붕괴워치 — 위반 ${toSend.length}건 (최근 1h, 만다라 ${mandalas}건)`;
  const list = toSend
    .map(
      ({ v }) =>
        `<li><b>${v.metric}</b> = ${Number(v.value.toFixed(2))} (${v.direction === 'above' ? '&gt;' : '&lt;'} ${v.threshold})</li>`
    )
    .join('');
  const html = `
    <div style="background:#111;color:#eee;padding:16px;font-family:sans-serif;font-size:13px">
      <h2 style="margin:0 0 8px">Insighta 붕괴워치</h2>
      <p style="background:#3a1a1a;color:#e6675e;padding:8px;border-radius:6px">최근 1시간 신규 만다라 ${mandalas}건에서 임계 위반:</p>
      <ul>${list}</ul>
      ${await recentChangeEventsHtml()}
      <p><a href="https://insighta.one/admin/performance" style="color:#7aa2f7">Performance Monitor</a> · 진단 JSON: /api/v1/admin/performance/diagnosis</p>
      <p style="color:#888;font-size:11px">15분 워치 · 지표별 재알림 6h 쿨다운 · 미해소 시 매일 에스컬레이션 · 관측 전용(서빙 무변경)</p>
    </div>`;
  await transporter.sendMail({ from: config.gmail.smtpFrom, to, subject, html });
  log.warn(
    `collapse alert sent: ${toSend.map((x) => x.v.metric).join(',')} (mandalas=${mandalas}, maxDays=${maxDays})`
  );
}

/** Dead-man heartbeat — daily "the watcher is alive" mail. Absence = alarm. */
export async function handleCollapseWatchHeartbeat(jobs: PgBoss.Job | PgBoss.Job[]): Promise<void> {
  void (Array.isArray(jobs) ? jobs[0] : jobs);
  if (!isCollapseWatchEnabled()) return;
  const to = config.observability.alertEmail;
  if (!to) return;
  const { mandalas, violations } = await measureLastHour();
  await transporter.sendMail({
    from: config.gmail.smtpFrom,
    to,
    subject: `💓 붕괴워치 heartbeat — 정상 가동 (활성 위반 ${violations.length}건)`,
    html: `<p>붕괴워치 dead-man heartbeat. 이 메일이 하루 이상 안 오면 워처/메일러가 죽은 것 — 그것이 알람입니다.</p><p>최근 1h: 만다라 ${mandalas}건, 활성 위반 ${violations.length}건.</p><p style="color:#888;font-size:11px">Workspace 결제 만료(2026-08-04) 시 메일러 사망도 이 침묵으로 드러남.</p>`,
  });
  log.info('collapse-watch heartbeat sent');
}

export async function registerCollapseWatchWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();
  await boss.work(JOB_NAMES.COLLAPSE_WATCH, handleCollapseWatch);
  await boss.schedule(JOB_NAMES.COLLAPSE_WATCH, QUEUE_CONFIG.COLLAPSE_WATCH_CRON);
  await boss.work(JOB_NAMES.COLLAPSE_WATCH_HEARTBEAT, handleCollapseWatchHeartbeat);
  await boss.schedule(
    JOB_NAMES.COLLAPSE_WATCH_HEARTBEAT,
    QUEUE_CONFIG.COLLAPSE_WATCH_HEARTBEAT_CRON
  );
  log.info(
    `collapse-watch registered (watch=${QUEUE_CONFIG.COLLAPSE_WATCH_CRON}, heartbeat=${QUEUE_CONFIG.COLLAPSE_WATCH_HEARTBEAT_CRON}, enabled=${isCollapseWatchEnabled()})`
  );
}
