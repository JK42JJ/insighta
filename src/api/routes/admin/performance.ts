/**
 * Admin performance API (perf-monitor PR2, design 2026-07-13).
 *
 * GET  /api/v1/admin/performance/diagnosis
 *   One-call diagnosis for a fresh operator/CC session — the 7/3 collapse
 *   took 2 days of forensics; this endpoint is that forensics precomputed:
 *   current runtime (git_sha + flag fingerprint), 30d change events, 7d
 *   daily KPI series, threshold violations (24h window), weak runs, and the
 *   external-cause interpretation rule (supervisor review 2026-07-13).
 *
 * POST /api/v1/admin/performance/events
 *   Manual timeline marker — incidents, provider probes, experiment notes.
 *   The boot self-report can't see EXTERNAL regressions (DeepInfra hang had
 *   zero code/config change); operators pin them here so the timeline stays
 *   complete.
 *
 * Read paths are read-only over existing tables; serving untouched.
 * Guarded by authenticate + authenticateAdmin (admin route hard rule).
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { getPrismaClient } from '@/modules/database/client';
import { createSuccessResponse } from '../../schemas/common.schema';
import { buildFlagsFingerprint, getGitSha } from '@/config/config-change-events';
import { loadCollapseThresholds } from '@/config/collapse-watch';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'admin/performance' });

const INTERPRETATION_RULES = [
  'KPI 하락 + 동시간대 변경 이벤트(마커) 부재 = 외부 원인 신호(임베딩 제공자·YouTube·네트워크). provider probe로 분기하고, 확인된 인시던트는 수동 마커(POST events)로 타임라인에 고정할 것.',
  '마커 존재 시 해당 diff의 flag/SHA가 1순위 용의자 — 마커 전/후 KPI 대조로 확정.',
  'kpi_7d의 세밀 지표(게이트 통과율·embed p95)는 video_discover_traces 7일 TTL 안에서만 산출 — 그 이전 구간은 search_metrics_daily 롤업이 소스.',
] as const;

const ManualEventSchema = z.object({
  note: z.string().min(1).max(2000),
  experiment: z.enum(['candidate', 'adopted', 'reverted']).optional(),
  experiment_criteria: z.string().max(2000).optional(),
});

interface KpiDayRow {
  day: string;
  mandalas: number;
  place_off_p50_s: number | null;
  place_off_p95_s: number | null;
  cards_p50: number | null;
  cells_p50: number | null;
  shorts: number;
  deboost_rate: number | null;
}

export async function adminPerformanceRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };
  const db = getPrismaClient();

  fastify.get('/diagnosis', adminAuth, async (_request: FastifyRequest, reply: FastifyReply) => {
    const thresholds = loadCollapseThresholds();

    // ── per-day mandala KPIs (7d) — uvs offsets, cards, cells, shorts, deboost
    const kpiDays = await db.$queryRaw<KpiDayRow[]>`
      WITH m AS (
        SELECT um.id, um.created_at,
          (SELECT count(*)::int FROM user_video_states s WHERE s.mandala_id = um.id) AS cards,
          (SELECT count(DISTINCT s.cell_index)::int FROM user_video_states s
            WHERE s.mandala_id = um.id AND s.cell_index IS NOT NULL) AS cells,
          (SELECT count(*)::int FROM user_video_states s
            JOIN youtube_videos v ON v.id = s.video_id
            WHERE s.mandala_id = um.id AND v.duration_seconds > 0 AND v.duration_seconds <= 180) AS shorts,
          (SELECT count(*)::int FROM user_video_states s
            WHERE s.mandala_id = um.id AND s.relevance_pct = 2) AS deboosted,
          (SELECT extract(epoch FROM (min(s.created_at) - um.created_at))
            FROM user_video_states s WHERE s.mandala_id = um.id) AS first_card_off_s
        FROM user_mandalas um
        WHERE um.created_at > now() - interval '7 days'
      )
      SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day,
        count(*)::int AS mandalas,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY first_card_off_s) AS place_off_p50_s,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY first_card_off_s) AS place_off_p95_s,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY cards) AS cards_p50,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY cells) AS cells_p50,
        sum(shorts)::int AS shorts,
        CASE WHEN sum(cards) > 0 THEN sum(deboosted)::float / sum(cards) END AS deboost_rate
      FROM m GROUP BY created_at::date ORDER BY 1`;

    // ── precompute HIT rate + duration (7d, per day)
    const precomputeDays = await db.$queryRaw<
      {
        day: string;
        total: number;
        consumed: number;
        dur_p50_s: number | null;
        dur_p95_s: number | null;
      }[]
    >`
      SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day,
        count(*)::int AS total,
        count(*) FILTER (WHERE status = 'consumed')::int AS consumed,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (updated_at - created_at)))
          FILTER (WHERE status IN ('done','consumed')) AS dur_p50_s,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (updated_at - created_at)))
          FILTER (WHERE status IN ('done','consumed')) AS dur_p95_s
      FROM mandala_wizard_precompute
      WHERE created_at > now() - interval '7 days'
      GROUP BY created_at::date ORDER BY 1`;

    // ── trace-derived (7d TTL): gate pass ratio + embed p95
    const traceAgg = await db.$queryRaw<
      { day: string; gate_pass_ratio: number | null; embed_p95_ms: number | null }[]
    >`
      SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day,
        avg(CASE WHEN step LIKE 'mandala_filter.semantic_gate%'
              AND (response->'stats'->>'input')::float > 0
            THEN (response->'stats'->>'output')::float / (response->'stats'->>'input')::float
            END) AS gate_pass_ratio,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)
          FILTER (WHERE step = 'embed.batch') AS embed_p95_ms
      FROM video_discover_traces
      WHERE created_at > now() - interval '7 days'
        AND (step LIKE 'mandala_filter.semantic_gate%' OR step = 'embed.batch')
      GROUP BY created_at::date ORDER BY 1`;

    // ── 24h violation check against thresholds
    const last24 = await db.$queryRaw<
      {
        place_off_p50_s: number | null;
        cards_p50: number | null;
        shorts: number;
        deboost_rate: number | null;
        hit_rate: number | null;
        precompute_p95_s: number | null;
        gate_pass_ratio: number | null;
        embed_p95_ms: number | null;
        mandalas: number;
      }[]
    >`
      WITH m AS (
        SELECT um.id, um.created_at,
          (SELECT count(*)::int FROM user_video_states s WHERE s.mandala_id = um.id) AS cards,
          (SELECT count(*)::int FROM user_video_states s
            JOIN youtube_videos v ON v.id = s.video_id
            WHERE s.mandala_id = um.id AND v.duration_seconds > 0 AND v.duration_seconds <= 180) AS shorts,
          (SELECT count(*)::int FROM user_video_states s
            WHERE s.mandala_id = um.id AND s.relevance_pct = 2) AS deboosted,
          (SELECT extract(epoch FROM (min(s.created_at) - um.created_at))
            FROM user_video_states s WHERE s.mandala_id = um.id) AS first_card_off_s
        FROM user_mandalas um WHERE um.created_at > now() - interval '24 hours'
      ), p AS (
        SELECT count(*)::int AS total,
          count(*) FILTER (WHERE status = 'consumed')::int AS consumed,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (updated_at - created_at)))
            FILTER (WHERE status IN ('done','consumed')) AS dur_p95_s
        FROM mandala_wizard_precompute WHERE created_at > now() - interval '24 hours'
      ), t AS (
        SELECT avg(CASE WHEN step LIKE 'mandala_filter.semantic_gate%'
                AND (response->'stats'->>'input')::float > 0
              THEN (response->'stats'->>'output')::float / (response->'stats'->>'input')::float END) AS gate_pass_ratio,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)
            FILTER (WHERE step = 'embed.batch') AS embed_p95_ms
        FROM video_discover_traces
        WHERE created_at > now() - interval '24 hours'
          AND (step LIKE 'mandala_filter.semantic_gate%' OR step = 'embed.batch')
      )
      SELECT
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY first_card_off_s) FROM m) AS place_off_p50_s,
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY cards) FROM m) AS cards_p50,
        (SELECT coalesce(sum(shorts), 0)::int FROM m) AS shorts,
        (SELECT CASE WHEN sum(cards) > 0 THEN sum(deboosted)::float / sum(cards) END FROM m) AS deboost_rate,
        (SELECT CASE WHEN total > 0 THEN consumed::float / total END FROM p) AS hit_rate,
        (SELECT dur_p95_s FROM p) AS precompute_p95_s,
        (SELECT gate_pass_ratio FROM t) AS gate_pass_ratio,
        (SELECT embed_p95_ms FROM t) AS embed_p95_ms,
        (SELECT count(*)::int FROM m) AS mandalas`;

    const w = last24[0];
    const violations: {
      metric: string;
      value: number;
      threshold: number;
      direction: 'above' | 'below';
    }[] = [];
    if (w && w.mandalas > 0) {
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
      check('place_off_p50_s', w.place_off_p50_s, thresholds.placeOffP50MaxSec, 'above');
      check('hit_rate', w.hit_rate, thresholds.hitRateMin, 'below');
      check('cards_p50', w.cards_p50, thresholds.cardsP50Min, 'below');
      check('precompute_p95_s', w.precompute_p95_s, thresholds.precomputeP95MaxSec, 'above');
      check('shorts_24h', w.shorts, thresholds.shortsMax, 'above');
      check('gate_pass_ratio', w.gate_pass_ratio, thresholds.gatePassRatioMin, 'below');
      check('embed_p95_ms', w.embed_p95_ms, thresholds.embedP95MaxMs, 'above');
      check('deboost_rate', w.deboost_rate, thresholds.deboostRateMax, 'above');
    }

    // ── weak runs (7d, cards < threshold) with trace pointer
    const weakRuns = await db.$queryRaw<
      { mandala_id: string; created_at: Date; cards: number; goal: string | null }[]
    >`
      SELECT um.id AS mandala_id, um.created_at,
        (SELECT count(*)::int FROM user_video_states s WHERE s.mandala_id = um.id) AS cards,
        (SELECT l.center_goal FROM user_mandala_levels l
          WHERE l.mandala_id = um.id AND l.depth = 0 LIMIT 1) AS goal
      FROM user_mandalas um
      WHERE um.created_at > now() - interval '7 days'
        AND (SELECT count(*) FROM user_video_states s WHERE s.mandala_id = um.id) < ${thresholds.cardsP50Min}
      ORDER BY um.created_at DESC LIMIT 20`;

    const events = await db.config_change_events.findMany({
      where: { created_at: { gt: new Date(Date.now() - 30 * 24 * 3600 * 1000) } },
      orderBy: { created_at: 'desc' },
      take: 100,
    });

    return reply.send(
      createSuccessResponse({
        generated_at: new Date().toISOString(),
        interpretation: { rules: INTERPRETATION_RULES },
        current: { git_sha: getGitSha(), flags: buildFlagsFingerprint() },
        thresholds,
        window_24h: w ?? null,
        violations,
        kpi_7d: { mandala_days: kpiDays, precompute_days: precomputeDays, trace_days: traceAgg },
        events_30d: events,
        weak_runs_7d: weakRuns,
      })
    );
  });

  fastify.post('/events', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = ManualEventSchema.parse(request.body ?? {});
    const row = await db.config_change_events.create({
      data: {
        source: 'manual',
        git_sha: getGitSha(),
        note: body.note,
        experiment: body.experiment ?? null,
        experiment_criteria: body.experiment_criteria ?? null,
      },
    });
    log.info(`manual perf event: ${body.note.slice(0, 80)} (experiment=${body.experiment ?? '-'})`);
    return reply.send(createSuccessResponse({ id: row.id, created_at: row.created_at }));
  });
}
