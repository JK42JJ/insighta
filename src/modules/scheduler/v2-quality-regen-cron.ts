/**
 * v2 Quality Regen cron — Phase 3 (CP488+, 2026-05-27).
 *
 * Background worker that drains `v2_quality_regen_queue` by re-running the
 * v2 generator on each critical video, re-auditing it, and resolving the
 * queue row. Design: docs/design/v2-quality-audit-system-2026-05-27.md §6.
 *
 * Operator-facing contract:
 * - Sit dormant until `V2_QUALITY_REGEN_ENABLED=true` flips the cron on.
 * - Every `V2_QUALITY_REGEN_CRON_SCHEDULE` tick (default every 30 min),
 *   claim the `V2_QUALITY_AUDIT_REGEN_BATCH_SIZE` highest-priority pending
 *   rows (default 5) and process them serially.
 * - For each row:
 *   1. Mark `status='in_progress'` + `attempted_at=now()`.
 *   2. Call `generateRichSummaryV2({videoId, forceRegen: true})`.
 *   3. Re-compute the 8-metric audit on the new row.
 *   4. If the new overall_score >= passScore → `status='resolved'`.
 *      Else → `status='failed'` (no auto-retry; operator can manually
 *      re-enqueue via the admin route).
 *   5. Always update `v2_quality_audit_log` with the new score so the
 *      audit history reflects regen attempts.
 *
 * Safety:
 * - `runInProgress` guard prevents overlap if a tick fires while the
 *   previous batch is still streaming (each video can take 30-60s due to
 *   LLM + captioner latency).
 * - Per-video try/catch — one failure doesn't kill the batch.
 * - No infinite retry loops — every queue row terminates at resolved or
 *   failed after one attempt.
 *
 * "Detection, not blocking" rule alignment: the worker reads the
 * regen_queue (written by the daily audit cron in Phase 1) and updates
 * `video_rich_summaries` in place. Users see the better v2 content on
 * their next view — no service-side blocking, no FE-side hiding.
 */

import * as cron from 'node-cron';

import { db } from '@/modules/database/client';
import { loadV2QualityAuditConfig } from '@/config/v2-quality-audit';
import { logger } from '@/utils/logger';

import {
  classifyScore,
  computeAuditScore,
  type AuditInputAtom,
  type AuditInputSection,
} from '../skills/rich-summary-quality-audit';
import { generateRichSummaryV2 } from '../skills/rich-summary-v2-generator';

const log = logger.child({ module: 'V2QualityRegenCron' });

let cronTask: cron.ScheduledTask | null = null;
let runInProgress = false;

interface RegenQueueRow {
  id: string;
  video_id: string;
  priority: number;
  reason: string | null;
  enqueued_at: Date;
}

interface RegeneratedRow {
  video_id: string;
  model: string | null;
  core: unknown;
  segments: unknown;
  duration_seconds: number | null;
}

export interface RegenBatchSummary {
  picked: number;
  resolved: number;
  failed: number;
  errors: number;
  elapsedMs: number;
}

function extractOneliner(core: unknown): string | null {
  if (!core || typeof core !== 'object') return null;
  const obj = core as Record<string, unknown>;
  const candidate = obj['one_liner'];
  return typeof candidate === 'string' ? candidate : null;
}

function extractSections(segments: unknown): AuditInputSection[] | null {
  if (!segments || typeof segments !== 'object') return null;
  const obj = segments as Record<string, unknown>;
  const arr = obj['sections'];
  if (!Array.isArray(arr)) return null;
  const out: AuditInputSection[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const fromSec = typeof e['from_sec'] === 'number' ? e['from_sec'] : null;
    const toSec = typeof e['to_sec'] === 'number' ? e['to_sec'] : null;
    if (fromSec == null || toSec == null) continue;
    out.push({ from_sec: fromSec, to_sec: toSec });
  }
  return out;
}

function extractAtoms(segments: unknown): AuditInputAtom[] | null {
  if (!segments || typeof segments !== 'object') return null;
  const obj = segments as Record<string, unknown>;
  const arr = obj['atoms'];
  if (!Array.isArray(arr)) return null;
  const out: AuditInputAtom[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const ts = typeof e['timestamp_sec'] === 'number' ? e['timestamp_sec'] : null;
    out.push({ timestamp_sec: ts });
  }
  return out;
}

/**
 * Re-fetch the freshly regenerated row + duration so the new audit score
 * reflects exactly what `generateRichSummaryV2` just wrote. Returns null
 * if the row vanished (would be a logic bug elsewhere).
 */
async function loadRegeneratedRow(videoId: string): Promise<RegeneratedRow | null> {
  const rows = await db.$queryRawUnsafe<RegeneratedRow[]>(
    `SELECT vrs.video_id, vrs.model, vrs.core, vrs.segments, yv.duration_seconds
       FROM video_rich_summaries vrs
       LEFT JOIN youtube_videos yv ON yv.youtube_video_id = vrs.video_id
      WHERE vrs.video_id = $1
      LIMIT 1`,
    videoId
  );
  return rows[0] ?? null;
}

/**
 * Regenerate a single queued video. Public-on-export so the admin
 * `/regen-trigger/:videoId` route can call it without re-implementing
 * the audit + queue resolution flow.
 *
 * @param videoId — video to regenerate
 * @param queueRowId — optional queue row to mark resolved/failed; pass null
 *   for manual ad-hoc triggers that should not touch the queue.
 * @returns the new audit overall_score, classification, and outcome string.
 */
export async function regenSingleVideo(
  videoId: string,
  queueRowId: string | null
): Promise<{
  videoId: string;
  outcome: 'resolved' | 'failed';
  reason: string;
  newScore: number | null;
}> {
  const config = loadV2QualityAuditConfig();

  if (queueRowId) {
    await db.v2_quality_regen_queue.update({
      where: { id: queueRowId },
      data: { status: 'in_progress', attempted_at: new Date() },
    });
  }

  let outcome: 'resolved' | 'failed' = 'failed';
  let reason = '';
  let newScore: number | null = null;

  try {
    const generationResult = await generateRichSummaryV2({
      videoId,
      forceRegen: true,
    });

    if (generationResult.kind !== 'pass') {
      reason = `generator_${generationResult.kind}:${'reason' in generationResult ? generationResult.reason : ''}`;
      log.info('regen: generator did not pass', { videoId, reason });
    } else {
      // Re-audit just this video using the freshly written row.
      const row = await loadRegeneratedRow(videoId);
      if (!row) {
        reason = 'post_regen_row_missing';
      } else {
        const score = computeAuditScore(
          {
            videoId,
            durationSeconds: row.duration_seconds,
            oneliner: extractOneliner(row.core),
            sections: extractSections(row.segments),
            atoms: extractAtoms(row.segments),
          },
          config.warningScore
        );
        newScore = score.overall;
        const classification = classifyScore(score.overall, config.passScore, config.warningScore);

        // Update today's audit_log row so the dashboard reflects regen.
        const today = new Date(new Date().toISOString().slice(0, 10));
        // Reuse the latest run id (if any) so the row stays joined to a
        // run; otherwise leave audit_run_id at the previous value.
        const latestRun = await db.v2_quality_audit_runs.findFirst({
          orderBy: { run_date: 'desc' },
          select: { id: true },
        });
        if (latestRun) {
          await db.v2_quality_audit_log.upsert({
            where: { video_id_audit_date: { video_id: videoId, audit_date: today } },
            create: {
              video_id: videoId,
              audit_date: today,
              audit_run_id: latestRun.id,
              overall_score: score.overall,
              m1_range_fit: score.m1RangeFit,
              m2_coverage_start: score.m2CoverageStart,
              m3_coverage_end: score.m3CoverageEnd,
              m4_atoms_range: score.m4AtomsRange,
              m5_atoms_distribution: score.m5AtomsDistribution,
              m6_atoms_sorted: score.m6AtomsSorted,
              m7_sections_gap: score.m7SectionsGap,
              m8_oneliner_len: score.m8OneLinerLen,
              model: row.model,
              duration_seconds: row.duration_seconds,
              violations: score.violations as unknown as object,
            },
            update: {
              overall_score: score.overall,
              m1_range_fit: score.m1RangeFit,
              m2_coverage_start: score.m2CoverageStart,
              m3_coverage_end: score.m3CoverageEnd,
              m4_atoms_range: score.m4AtomsRange,
              m5_atoms_distribution: score.m5AtomsDistribution,
              m6_atoms_sorted: score.m6AtomsSorted,
              m7_sections_gap: score.m7SectionsGap,
              m8_oneliner_len: score.m8OneLinerLen,
              model: row.model,
              duration_seconds: row.duration_seconds,
              violations: score.violations as unknown as object,
            },
          });
        }

        if (classification === 'pass') {
          outcome = 'resolved';
          reason = `pass_score=${score.overall}`;
        } else {
          reason = `still_${classification}:score=${score.overall}`;
        }
      }
    }
  } catch (err) {
    reason = `exception:${err instanceof Error ? err.message : String(err)}`;
    log.error('regen: exception', { videoId, error: reason });
  }

  if (queueRowId) {
    await db.v2_quality_regen_queue.update({
      where: { id: queueRowId },
      data: {
        status: outcome,
        reason,
        resolved_at: outcome === 'resolved' ? new Date() : null,
      },
    });
  }

  return { videoId, outcome, reason, newScore };
}

/**
 * Run a single regen batch — claim up to `batchSize` highest-priority
 * pending rows and process them serially. Exposed so the admin route can
 * call it on-demand.
 */
export async function runRegenBatchOnce(): Promise<RegenBatchSummary | null> {
  if (runInProgress) {
    log.info('regen batch skipped — previous batch still in progress');
    return null;
  }
  runInProgress = true;
  const t0 = Date.now();
  const config = loadV2QualityAuditConfig();

  try {
    const candidates = await db.$queryRawUnsafe<RegenQueueRow[]>(
      `SELECT id, video_id, priority, reason, enqueued_at
         FROM v2_quality_regen_queue
        WHERE status = 'pending'
        ORDER BY priority ASC, enqueued_at ASC
        LIMIT $1`,
      config.regenBatchSize
    );

    if (candidates.length === 0) {
      log.info('regen batch: no pending rows');
      return {
        picked: 0,
        resolved: 0,
        failed: 0,
        errors: 0,
        elapsedMs: Date.now() - t0,
      };
    }

    let resolved = 0;
    let failed = 0;
    let errors = 0;

    for (const c of candidates) {
      try {
        const result = await regenSingleVideo(c.video_id, c.id);
        if (result.outcome === 'resolved') resolved += 1;
        else failed += 1;
      } catch (err) {
        errors += 1;
        log.error('regen batch: per-item exception (already updated to failed)', {
          videoId: c.video_id,
          queueId: c.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const summary: RegenBatchSummary = {
      picked: candidates.length,
      resolved,
      failed,
      errors,
      elapsedMs: Date.now() - t0,
    };
    log.info('regen batch done', summary);
    return summary;
  } finally {
    runInProgress = false;
  }
}

export function startV2QualityRegenCron(): void {
  const config = loadV2QualityAuditConfig();
  if (!config.regenEnabled) {
    log.info('v2 quality regen cron disabled (V2_QUALITY_REGEN_ENABLED=false)');
    return;
  }
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
  if (!cron.validate(config.regenCronSchedule)) {
    log.error('v2 quality regen cron schedule invalid — not started', {
      schedule: config.regenCronSchedule,
    });
    return;
  }
  cronTask = cron.schedule(config.regenCronSchedule, () => {
    void runRegenBatchOnce();
  });
  log.info('v2 quality regen cron started', {
    schedule: config.regenCronSchedule,
    batchSize: config.regenBatchSize,
  });
}

export function stopV2QualityRegenCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    log.info('v2 quality regen cron stopped');
  }
}
