/**
 * Admin Search-Trace Explorer — read-only Card Journey for the v5 live search.
 *
 * Reconstructs, for one request (trace_id) or one mandala, the full journey from
 * §3 of the observability design SSOT: generated queries → raw YouTube results →
 * per-candidate keep/drop decision + reason → final cell. Powers the debug view
 * ("this mandala returned garbage — why?").
 *
 * Read-only over search_trace / search_trace_candidate. Never touches the serve
 * path (observation-only). Guarded by authenticate + authenticateAdmin, mirroring
 * admin/discover-traces.ts.
 */

import { FastifyPluginCallback } from 'fastify';
import { getPrismaClient } from '@/modules/database';

const RECENT_DEFAULT = 100;
const RECENT_MAX = 1000;
const CANDIDATE_CAP = 5000;

/** BigInt (view_count) is not JSON-serializable — coerce to number for the wire. */
function viewToNumber(v: bigint | null): number | null {
  return v == null ? null : Number(v);
}

/** Summary row shape shared by the list endpoints (no candidates). */
function toTraceSummary(r: {
  trace_id: string;
  mandala_id: string | null;
  user_id: string | null;
  trigger: string;
  started_at: Date;
  finished_at: Date | null;
  queries_generated: unknown;
  quota_units: number | null;
  queries_attempted: number | null;
  queries_succeeded: number | null;
  queries_failed: number | null;
  counts: unknown;
  outcome: unknown;
  algorithm_version: string | null;
  created_at: Date;
}) {
  return {
    trace_id: r.trace_id,
    mandala_id: r.mandala_id,
    user_id: r.user_id,
    trigger: r.trigger,
    started_at: r.started_at.toISOString(),
    finished_at: r.finished_at?.toISOString() ?? null,
    queries_generated: r.queries_generated,
    quota_units: r.quota_units,
    queries_attempted: r.queries_attempted,
    queries_succeeded: r.queries_succeeded,
    queries_failed: r.queries_failed,
    counts: r.counts,
    outcome: r.outcome,
    algorithm_version: r.algorithm_version,
    created_at: r.created_at.toISOString(),
  };
}

export const adminSearchTraceExplorerRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  /**
   * GET /api/v1/admin/search-trace/recent?limit=N&mandala_id=&trigger=
   * — most recent request traces (list view for the Explorer landing).
   */
  fastify.get<{ Querystring: { limit?: string; mandala_id?: string; trigger?: string } }>(
    '/recent',
    adminAuth,
    async (request, reply) => {
      const limit = Math.min(
        Number(request.query.limit ?? String(RECENT_DEFAULT)) || RECENT_DEFAULT,
        RECENT_MAX
      );
      const prisma = getPrismaClient();
      const rows = await prisma.search_trace.findMany({
        where: {
          ...(request.query.mandala_id ? { mandala_id: request.query.mandala_id } : {}),
          ...(request.query.trigger ? { trigger: request.query.trigger } : {}),
        },
        orderBy: { created_at: 'desc' },
        take: limit,
      });
      return reply.send({ count: rows.length, traces: rows.map(toTraceSummary) });
    }
  );

  /**
   * GET /api/v1/admin/search-trace/by-mandala/:mandalaId?limit=N
   * — request traces for one mandala, newest first.
   */
  fastify.get<{ Params: { mandalaId: string }; Querystring: { limit?: string } }>(
    '/by-mandala/:mandalaId',
    adminAuth,
    async (request, reply) => {
      const limit = Math.min(
        Number(request.query.limit ?? String(RECENT_DEFAULT)) || RECENT_DEFAULT,
        RECENT_MAX
      );
      const prisma = getPrismaClient();
      const rows = await prisma.search_trace.findMany({
        where: { mandala_id: request.params.mandalaId },
        orderBy: { created_at: 'desc' },
        take: limit,
      });
      return reply.send({
        mandalaId: request.params.mandalaId,
        count: rows.length,
        traces: rows.map(toTraceSummary),
      });
    }
  );

  /**
   * GET /api/v1/admin/search-trace/journey/:traceId
   *
   * The Card Journey (§3): the request row + every candidate with its keep/drop
   * decision, plus a pre-computed funnel (decision × drop_reason attrition) and
   * the placed cards grouped by cell — so the FE renders without re-aggregating.
   */
  fastify.get<{ Params: { traceId: string } }>(
    '/journey/:traceId',
    adminAuth,
    async (request, reply) => {
      const traceId = request.params.traceId;
      const prisma = getPrismaClient();

      const trace = await prisma.search_trace.findFirst({
        where: { trace_id: traceId },
        orderBy: { created_at: 'desc' },
      });
      if (!trace) {
        return reply.code(404).send({ error: 'trace_not_found', traceId });
      }

      const candidates = await prisma.search_trace_candidate.findMany({
        where: { trace_id: traceId },
        orderBy: [{ decision: 'asc' }, { final_cell_index: 'asc' }, { view_count: 'desc' }],
        take: CANDIDATE_CAP,
      });

      // Raw request/response timeline for the SAME flow. search_trace.trace_id
      // === video_discover_traces.run_id (add-cards.ts:574 writeSearchTrace uses
      // the discover runId as traceId; every recordTrace row shares that runId).
      // Surfaces the actual external-API req/rep per step so the operator can
      // read the full flow start→end (James: "실제 내용을 확인해야 개선 가능").
      const rawSteps = await prisma.video_discover_traces.findMany({
        where: { run_id: traceId },
        orderBy: { created_at: 'asc' },
        select: {
          step: true,
          status: true,
          request: true,
          response: true,
          error_message: true,
          latency_ms: true,
          created_at: true,
        },
      });

      // Funnel: decision × drop_reason attrition (drives the §4 funnel chart).
      const funnelMap = new Map<string, number>();
      // Placed cards grouped by cell — the "what the user actually got" view.
      const placedByCell = new Map<number, unknown[]>();

      const cand = candidates.map((c) => {
        const key = `${c.decision}:${c.drop_reason ?? '-'}`;
        funnelMap.set(key, (funnelMap.get(key) ?? 0) + 1);
        const row = {
          video_id: c.video_id,
          channel_id: c.channel_id,
          channel_title: c.channel_title,
          source_kind: c.source_kind,
          source_cell_index: c.source_cell_index,
          source_query_text: c.source_query_text,
          source_tier: c.source_tier,
          stage_reached: c.stage_reached,
          decision: c.decision,
          drop_reason: c.drop_reason,
          relevance_gc: c.relevance_gc,
          ts_rank: c.ts_rank,
          cosine: c.cosine,
          llm_pick_score: c.llm_pick_score,
          llm_pick_reason: c.llm_pick_reason,
          view_count: viewToNumber(c.view_count),
          duration_sec: c.duration_sec,
          published_at: c.published_at?.toISOString() ?? null,
          final_cell_level: c.final_cell_level,
          final_cell_index: c.final_cell_index,
        };
        if (c.final_cell_index != null) {
          const bucket = placedByCell.get(c.final_cell_index) ?? [];
          bucket.push(row);
          placedByCell.set(c.final_cell_index, bucket);
        }
        return row;
      });

      const funnel = [...funnelMap.entries()]
        .map(([key, count]) => {
          const [decision, drop_reason] = key.split(':');
          return { decision, drop_reason: drop_reason === '-' ? null : drop_reason, count };
        })
        .sort((a, b) => b.count - a.count);

      return reply.send({
        trace: toTraceSummary(trace),
        candidate_count: cand.length,
        funnel,
        placed_by_cell: [...placedByCell.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([cell, cards]) => ({ cell, cards })),
        candidates: cand,
        raw_steps: rawSteps.map((s) => ({
          step: s.step,
          status: s.status,
          request: s.request,
          response: s.response,
          error_message: s.error_message,
          latency_ms: s.latency_ms,
          at: s.created_at.toISOString(),
        })),
      });
    }
  );

  done();
};
