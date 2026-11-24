/**
 * Measurement record writer (SHADOW MODE). Flag-gated by
 * MEASUREMENT_RECORD_ENABLED (default off = no-op). Fire-and-forget: never
 * awaited by callers, never throws, never affects ranking/filtering.
 */
import { config } from '@/config/index';
import { MEASUREMENT_VERSION } from '@/config/measurement-record';
import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
import type { MeasurementRecord } from './types';

const log = logger.child({ module: 'measurement' });

const VIDEO_ID_MAX = 20;

function cap(v: string, n: number): string {
  return v.length > n ? v.slice(0, n) : v;
}

/** Map a record to candidate_features columns (pure; exported for tests). */
export function toRow(r: MeasurementRecord): Record<string, unknown> {
  return {
    run_id: r.runId,
    branch: r.branch,
    video_id: cap(r.videoId, VIDEO_ID_MAX),
    cell: r.cell ?? null,
    source_kind: r.sourceKind ?? null,
    keyword: r.keyword ?? null,
    discovery_paths: r.discoveryPaths ?? null,
    video: r.video ?? undefined,
    reaction: r.reaction ?? undefined,
    channel: r.channel ?? undefined,
    comment_signals: r.commentSignals ?? undefined,
    filter_trace: r.filterTrace ?? undefined,
    relevance_score: r.relevanceScore ?? null,
    measurement_version: MEASUREMENT_VERSION,
  };
}

/** Upsert rows on (run_id, video_id). Returns immediately; swallows errors. */
export function writeMeasurementRecords(records: readonly MeasurementRecord[]): void {
  if (!config.measurementRecord.enabled) return;
  if (records.length === 0) return;
  const rows = records.map(toRow);

  void (async () => {
    try {
      const prisma = getPrismaClient();
      for (const row of rows) {
        const { run_id, video_id, ...rest } = row as { run_id: string; video_id: string };
        await prisma.candidate_features.upsert({
          where: { run_id_video_id: { run_id, video_id } },
          create: { run_id, video_id, ...rest } as never,
          update: rest as never,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.debug(`measurement write failed (swallowed): ${msg}`);
    }
  })();
}
