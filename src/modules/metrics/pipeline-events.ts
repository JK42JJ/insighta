/**
 * pipeline_events insert helper (CP437 paper §6.2).
 *
 * Stage-stamps a per-event metric row. Currently used by the v2-summary
 * upsert-direct route but the table is generic enough to host any future
 * pipeline stage (kg-bridge, video-discover etc).
 */

import { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'metrics/pipeline-events' });

export interface PipelineEventRow {
  stage: string;
  videoId: string;
  payload: Record<string, unknown>;
}

/**
 * INSERT a pipeline_events row. Failures are logged but not thrown — this
 * is a non-blocking telemetry path and must never regress the upstream
 * caller (v2-summary upsert).
 */
export async function recordPipelineEvent(row: PipelineEventRow): Promise<void> {
  try {
    const prisma = getPrismaClient();
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO public.pipeline_events (stage, video_id, payload)
      VALUES (${row.stage}, ${row.videoId}, ${JSON.stringify(row.payload)}::jsonb)
    `);
  } catch (err) {
    log.warn('pipeline_events insert failed (non-fatal)', {
      stage: row.stage,
      videoId: row.videoId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
