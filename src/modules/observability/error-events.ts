// error-events recorder — persist a subsystem failure that otherwise reaches
// only ephemeral winston logs, so the daily error-log-check job (which reads DB
// tables) can see it. Fire-and-forget: never throws into the caller and swallows
// its own DB errors — recording a failure must not create a second failure on a
// path that is already degraded. Mirrors logLLMCall (llm/call-logger.ts).
//
// Use ONLY for the log-only blind spots (book-fill hard-fails, embedding
// failures). Domains with their own error column (llm_call_logs.status,
// mandala_*_error, pgboss.job state='failed', skill_runs.error) stay authoritative
// there — do NOT double-write those.

import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'observability/error-events' });

export interface ErrorEventInput {
  /** Coarse subsystem bucket, e.g. 'book_fill' | 'embedding'. */
  subsystem: string;
  /** Specific failure stage, e.g. 'topic_synthesis_hardfail'. */
  stage: string;
  /** 'error' (real failure) | 'warn' (degraded-but-recovered). Default 'error'. */
  severity?: 'error' | 'warn';
  /** Human-readable reason (hard_fail string / caught message). No secrets. */
  message?: string;
  /** Structured correlation payload (reason, cell, provider, …). No secrets. */
  context?: Record<string, unknown>;
  mandalaId?: string;
  videoId?: string;
}

/**
 * Append one error_events row. Best-effort: returns void, never rejects. A DB
 * failure here is logged at warn and dropped (the caller is already handling its
 * own failure — this is pure observability).
 */
export function recordErrorEvent(input: ErrorEventInput): void {
  const prisma = getPrismaClient();
  prisma.error_events
    .create({
      data: {
        subsystem: input.subsystem,
        stage: input.stage,
        severity: input.severity ?? 'error',
        message: input.message ?? null,
        context: (input.context ?? undefined) as never,
        mandala_id: input.mandalaId ?? null,
        video_id: input.videoId ?? null,
      },
    })
    .catch((err: unknown) => {
      log.warn(
        `error_events write failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
    });
}
