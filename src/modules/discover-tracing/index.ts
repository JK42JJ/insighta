/**
 * Discover Tracing — per-step request/response capture for the wizard →
 * dashboard video-discovery pipeline (CP457+ instrumentation).
 *
 * Goals (user-requested):
 *   - Capture LLM prompts/responses, YouTube search/videos.list calls,
 *     Cohere rerank, embedding batches, and the final SQL results so the
 *     pipeline can be inspected after the fact ("verify the actual
 *     requests + responses produced the cards the user sees").
 *
 * Design:
 *   - AsyncLocalStorage propagates `{ mandalaId, userId, runId }` through
 *     async call chains without touching every function signature.
 *   - `traceCall(step, request, fn)` wraps an external call: measures
 *     latency, captures response on success, error_message on failure,
 *     fires a non-blocking DB insert. Wrapper always returns the inner
 *     promise's resolution so callers never need a code branch.
 *   - Flag-gated by `V3_TRACE_ENABLED` (default false). When off, the
 *     wrapper is a thin pass-through with negligible overhead.
 *   - DB write is fire-and-forget (`void` promise). A DB outage never
 *     blocks the user pipeline.
 *   - Payload size cap = 64KB per field (truncate w/ marker). LLM
 *     responses with huge bodies don't blow up the row.
 *
 * Cross-ref: prisma/migrations/discover-traces/001_create_video_discover_traces.sql
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { config } from '@/config/index';
import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'discover-tracing' });

const TRACE_ENABLED = config.discoverTracing.enabled;

const PAYLOAD_BYTE_CAP = 64 * 1024;

export interface TraceContext {
  mandalaId: string | null;
  userId: string | null;
  runId: string;
}

const als = new AsyncLocalStorage<TraceContext>();

/**
 * Run `fn` inside a fresh trace context. Generates a `runId` so all calls
 * during this invocation share one row group in the traces table. Call
 * this at the entry of each user-facing pipeline path:
 *   - `executor.execute()` (mandala-id)
 *   - `runDiscoverEphemeral()` (wizard precompute)
 *   - REST /recommendations + SSE backlog (read paths)
 */
export function withTraceContext<T>(
  ctx: { mandalaId: string | null; userId: string | null; runId?: string },
  fn: () => Promise<T>
): Promise<T> {
  const bound: TraceContext = {
    mandalaId: ctx.mandalaId,
    userId: ctx.userId,
    runId: ctx.runId ?? randomUUID(),
  };
  return als.run(bound, fn);
}

/**
 * Current context, or null when not inside `withTraceContext`. Callers
 * should treat null as "tracing disabled for this call site" and skip
 * the write.
 */
export function getTraceContext(): TraceContext | null {
  return als.getStore() ?? null;
}

function truncatePayload(value: unknown): unknown {
  if (value == null) return value;
  try {
    const s = JSON.stringify(value);
    if (s.length <= PAYLOAD_BYTE_CAP) return value;
    return {
      __truncated: true,
      __original_bytes: s.length,
      preview: s.slice(0, PAYLOAD_BYTE_CAP - 200),
    };
  } catch {
    return { __unserialisable: true, __typeof: typeof value };
  }
}

interface WriteRowArgs {
  step: string;
  status: 'ok' | 'error' | 'skipped' | 'fallback';
  request: unknown;
  response: unknown;
  errorMessage?: string | null;
  latencyMs: number;
}

function fireAndForgetWrite(args: WriteRowArgs): void {
  const ctx = als.getStore();
  if (!ctx) return; // no context bound → don't write
  // Promise floats; caller never awaits. .catch silences unhandled rejection.
  void (async () => {
    try {
      const prisma = getPrismaClient();
      await prisma.video_discover_traces.create({
        data: {
          run_id: ctx.runId,
          mandala_id: ctx.mandalaId,
          user_id: ctx.userId,
          step: args.step.slice(0, 80),
          status: args.status,
          request: truncatePayload(args.request) as Prisma.InputJsonValue,
          response: truncatePayload(args.response) as Prisma.InputJsonValue,
          error_message: args.errorMessage?.slice(0, 2000) ?? null,
          latency_ms: args.latencyMs,
        },
      });
    } catch (err) {
      log.warn(
        `trace write failed step=${args.step}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  })();
}

/**
 * Wraps an external/internal call. Captures request + response or error,
 * writes a trace row (fire-and-forget). Returns the inner promise so
 * callers never branch on tracing state.
 *
 * Usage:
 *   const result = await traceCall(
 *     'tier2.search.list',
 *     { query, regionCode, order },
 *     () => searchVideos({ ... }),
 *   );
 */
export async function traceCall<T>(
  step: string,
  request: unknown,
  fn: () => Promise<T>
): Promise<T> {
  if (!TRACE_ENABLED) return fn();
  const ctx = als.getStore();
  if (!ctx) return fn(); // no context → skip trace
  const t0 = Date.now();
  try {
    const response = await fn();
    fireAndForgetWrite({
      step,
      status: 'ok',
      request,
      response,
      latencyMs: Date.now() - t0,
    });
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fireAndForgetWrite({
      step,
      status: 'error',
      request,
      response: null,
      errorMessage: msg,
      latencyMs: Date.now() - t0,
    });
    throw err;
  }
}

/**
 * Synchronously record a step (no inner async fn). Useful for capturing
 * SQL query results or in-memory transforms after the fact.
 */
export function recordTrace(args: {
  step: string;
  status: 'ok' | 'error' | 'skipped' | 'fallback';
  request?: unknown;
  response?: unknown;
  errorMessage?: string;
  latencyMs?: number;
}): void {
  if (!TRACE_ENABLED) return;
  fireAndForgetWrite({
    step: args.step,
    status: args.status,
    request: args.request ?? null,
    response: args.response ?? null,
    errorMessage: args.errorMessage ?? null,
    latencyMs: args.latencyMs ?? 0,
  });
}

export const TRACE_FLAG = { enabled: TRACE_ENABLED };
