import { FastifyInstance } from 'fastify';
import { getPrismaClient } from '@/modules/database/client';
import { config } from '@/config/index';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'admin/feature-status' });

/**
 * Does each user-facing feature actually work right now?
 *
 * Not "is the process up" — /health answers that, and it answered yes all day
 * on 2026-07-28 while curation cards rendered black and a 20-video week showed
 * three. The gap between "deployed" and "works" was only ever visible by
 * querying prod by hand, which made every answer slow and some of them wrong.
 *
 * Each check states the ONE fact that decides whether the feature works, and
 * that fact is measured, never inferred from a flag or a deploy. A feature can
 * be shipped, enabled, and still broken; only the data says which.
 *
 * ok   — works
 * warn — degraded: some users see less than they should
 * fail — does not work
 */

type Level = 'ok' | 'warn' | 'fail';

interface Check {
  key: string;
  label: string;
  status: Level;
  /** the measurement, in one line, always with its numbers */
  detail: string;
  /** what to do about it, when it is not ok */
  action?: string;
}

const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));

/**
 * Curation items are ids; the deck reads title and thumbnail from video_pool.
 * An item whose video is missing or inactive there renders as nothing — the
 * count says 20, the screen shows 3. This is the check that would have caught
 * that in a second instead of an afternoon.
 */
async function checkCurationRenderable(prisma: ReturnType<typeof getPrismaClient>): Promise<Check> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ items: bigint; renderable: bigint; subs: bigint; empty_subs: bigint }>
  >(`
    WITH latest AS (
      SELECT ci.subscription_id, ci.video_id,
             (vp.video_id IS NOT NULL AND vp.is_active) AS renderable
        FROM curation_items ci
        JOIN curation_subscriptions s ON s.id = ci.subscription_id AND s.is_active
        LEFT JOIN video_pool vp ON vp.video_id = ci.video_id
       WHERE ci.week_of >= (CURRENT_DATE - INTERVAL '14 days')
    )
    SELECT COUNT(*) AS items,
           COUNT(*) FILTER (WHERE renderable) AS renderable,
           COUNT(DISTINCT subscription_id) AS subs,
           COUNT(DISTINCT subscription_id) FILTER (WHERE NOT renderable) AS empty_subs
      FROM latest
  `);
  const r = rows[0];
  const items = Number(r?.items ?? 0);
  const renderable = Number(r?.renderable ?? 0);
  const subs = Number(r?.subs ?? 0);
  const p = pct(renderable, items);

  if (items === 0) {
    return {
      key: 'curation.renderable',
      label: '큐레이션 카드가 화면에 보이는가',
      status: 'warn',
      detail: '최근 2주 편성이 없습니다',
      action: '주간 스케줄러가 도는지 확인하세요',
    };
  }
  return {
    key: 'curation.renderable',
    label: '큐레이션 카드가 화면에 보이는가',
    status: p >= 90 ? 'ok' : p >= 50 ? 'warn' : 'fail',
    detail: `최근 2주 ${items}편 중 ${renderable}편(${p}%)이 표시 가능 · 구독 ${subs}개`,
    ...(p < 90 && {
      action: '나머지는 video_pool 에 없거나 비활성입니다. 메타데이터 백필이 필요합니다',
    }),
  };
}

/** A channel curation whose channels never produced a renderable item is the
 *  black-card symptom, stated directly. */
async function checkChannelMode(prisma: ReturnType<typeof getPrismaClient>): Promise<Check> {
  if (!config.curationChannelSource.enabled) {
    return {
      key: 'curation.channel',
      label: '채널로 받기',
      status: 'warn',
      detail: 'CURATION_CHANNEL_SOURCE_ENABLED 가 꺼져 있습니다',
      action: '켜기 전까지 채널을 등록해도 기존 방식으로 편성됩니다',
    };
  }
  const rows = await prisma.$queryRawUnsafe<Array<{ subs: bigint; blank: bigint }>>(`
    WITH ch AS (
      SELECT DISTINCT s.id
        FROM curation_subscriptions s
        JOIN curation_channels c ON c.subscription_id = s.id
       WHERE s.is_active
    )
    SELECT COUNT(*) AS subs,
           COUNT(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM curation_items ci
               JOIN video_pool vp ON vp.video_id = ci.video_id AND vp.is_active
              WHERE ci.subscription_id = ch.id
           )) AS blank
      FROM ch
  `);
  const subs = Number(rows[0]?.subs ?? 0);
  const blank = Number(rows[0]?.blank ?? 0);

  if (subs === 0) {
    return {
      key: 'curation.channel',
      label: '채널로 받기',
      status: 'ok',
      detail: '등록된 채널 구독이 없습니다 (기능은 켜져 있음)',
    };
  }
  return {
    key: 'curation.channel',
    label: '채널로 받기',
    status: blank === 0 ? 'ok' : 'fail',
    detail: `채널 구독 ${subs}개 중 ${blank}개가 빈 화면`,
    ...(blank > 0 && { action: '해당 영상의 메타데이터가 video_pool 에 없습니다' }),
  };
}

/** The weekly promise: did the scheduler fire, and did it produce anything. */
async function checkWeeklySchedule(prisma: ReturnType<typeof getPrismaClient>): Promise<Check> {
  const jobs = await prisma.$queryRawUnsafe<Array<{ createdon: Date; state: string }>>(`
    SELECT createdon, state FROM pgboss.job
     WHERE name = 'curation-weekly' ORDER BY createdon DESC LIMIT 1
  `);
  const last = jobs[0];
  if (!last) {
    return {
      key: 'curation.weekly',
      label: '주간 자동 편성',
      status: 'fail',
      detail: '주간 작업이 한 번도 실행된 적 없습니다',
      action: 'pg-boss 스케줄 등록을 확인하세요',
    };
  }
  const hoursAgo = Math.round((Date.now() - last.createdon.getTime()) / 3_600_000);
  const builds = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`
    SELECT COUNT(*) AS n FROM pgboss.job
     WHERE name = 'curation-build' AND createdon > now() - INTERVAL '8 days'
  `);
  const n = Number(builds[0]?.n ?? 0);

  // The scan runs daily; more than ~26h since the last one means it stopped.
  const stale = hoursAgo > 26;
  return {
    key: 'curation.weekly',
    label: '주간 자동 편성',
    status: stale ? 'fail' : n === 0 ? 'warn' : 'ok',
    detail: `마지막 스캔 ${hoursAgo}시간 전 (${last.state}) · 최근 8일 빌드 ${n}건`,
    ...(stale && { action: '크론이 멈췄습니다' }),
    ...(!stale && n === 0 && { action: '스캔은 도는데 아무것도 만들지 않았습니다' }),
  };
}

/** Judging only filters what has been judged. */
async function checkTopicJudge(prisma: ReturnType<typeof getPrismaClient>): Promise<Check> {
  const rows = await prisma.$queryRawUnsafe<Array<{ total: bigint; judged: bigint }>>(`
    SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE judge_state IS NOT NULL) AS judged
      FROM trend_signals
  `);
  const total = Number(rows[0]?.total ?? 0);
  const judged = Number(rows[0]?.judged ?? 0);
  const p = pct(judged, total);
  return {
    key: 'suggest.judge',
    label: '추천 주제 판정 (유해·부적합 차단)',
    status: p >= 95 ? 'ok' : p >= 50 ? 'warn' : 'fail',
    detail: `${judged}/${total} (${p}%) 판정 완료`,
    ...(p < 95 && { action: '미판정 주제는 걸러지지 않고 그대로 제안됩니다' }),
  };
}

/** Whether anything can be mailed at all. */
async function checkEmail(prisma: ReturnType<typeof getPrismaClient>): Promise<Check> {
  const enabled = process.env['TRANSACTIONAL_EMAIL_ENABLED'] === 'true';
  const rows = await prisma.$queryRawUnsafe<Array<{ sent: bigint; failed: bigint }>>(`
    SELECT COUNT(*) FILTER (WHERE status = 'sent') AS sent,
           COUNT(*) FILTER (WHERE status = 'failed') AS failed
      FROM email_broadcast_sends
     WHERE sent_at > now() - INTERVAL '30 days'
  `);
  const sent = Number(rows[0]?.sent ?? 0);
  const failed = Number(rows[0]?.failed ?? 0);
  return {
    key: 'email',
    label: '메일 발송',
    status: !enabled ? 'warn' : failed > 0 ? 'warn' : 'ok',
    detail: enabled
      ? `발송 가능 · 최근 30일 성공 ${sent} / 실패 ${failed}`
      : 'TRANSACTIONAL_EMAIL_ENABLED 가 꺼져 있습니다',
  };
}

export async function adminFeatureStatusRoutes(fastify: FastifyInstance) {
  // GET /api/v1/admin/feature-status — one screen, one answer per feature.
  fastify.get(
    '/feature-status',
    { onRequest: [fastify.authenticate, fastify.authenticateAdmin] },
    async (_request, reply) => {
      const prisma = getPrismaClient();

      // One slow or broken check must not hide the others.
      const settled = await Promise.allSettled([
        checkCurationRenderable(prisma),
        checkChannelMode(prisma),
        checkWeeklySchedule(prisma),
        checkTopicJudge(prisma),
        checkEmail(prisma),
      ]);

      const checks: Check[] = settled.map((s, i) => {
        if (s.status === 'fulfilled') return s.value;
        log.warn('feature check threw', { index: i, error: String(s.reason) });
        return {
          key: `check-${i}`,
          label: '점검 실패',
          status: 'fail' as Level,
          detail: `확인할 수 없습니다: ${String(s.reason).slice(0, 120)}`,
        };
      });

      const worst: Level = checks.some((c) => c.status === 'fail')
        ? 'fail'
        : checks.some((c) => c.status === 'warn')
          ? 'warn'
          : 'ok';

      return reply.send({
        status: 'ok',
        data: { overall: worst, checked_at: new Date().toISOString(), checks },
      });
    }
  );
}
