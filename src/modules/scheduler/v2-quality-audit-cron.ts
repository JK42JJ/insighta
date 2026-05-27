/**
 * v2 Quality Audit cron (CP488+, 2026-05-27).
 *
 * Daily scheduled scan over every `video_rich_summaries` row with
 * `template_version='v2'`. For each row it pulls the matching
 * `youtube_videos.duration_seconds` + extracts sections/atoms/one_liner
 * from `segments`/`core`, then computes 8 quality metrics via the pure
 * `computeAuditScore` function and persists one row per video to
 * `v2_quality_audit_log`. A per-run summary lands in
 * `v2_quality_audit_runs`. Critical rows enqueue into
 * `v2_quality_regen_queue` for a future Phase 3 background worker.
 *
 * Hard Rule alignment:
 * - "Detection, not blocking" — no DB row is auto-hidden. The cron only
 *   reads + writes audit tables.
 * - "No hardcoded thresholds" — pass/warning scores + scan limit are
 *   sourced from `loadV2QualityAuditConfig`.
 * - "Schema may be ahead of cron" — when `V2_QUALITY_AUDIT_ENABLED=false`,
 *   `startV2QualityAuditCron()` logs and returns, so the schema can ship
 *   to prod with zero behavioural surface.
 *
 * Concurrency: in-process `runInProgress` guard prevents overlap if the
 * cron fires while a previous run is still streaming through ~1,800 rows
 * (a full run takes ~30s on Supabase pooler, well under the 24h cadence,
 * but the guard is a cheap safety net).
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

const log = logger.child({ module: 'V2QualityAuditCron' });

let cronTask: cron.ScheduledTask | null = null;
let runInProgress = false;

interface V2Row {
  video_id: string;
  model: string | null;
  core: unknown;
  segments: unknown;
  duration_seconds: number | null;
}

export interface AuditRunSummary {
  runId: string;
  total: number;
  pass: number;
  warning: number;
  critical: number;
  avgScore: number;
  elapsedMs: number;
  enqueuedForRegen: number;
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
 * Run a single audit pass over every v2 row up to `scanLimit`. Idempotent
 * w.r.t. the unique `(video_id, audit_date)` constraint — same-day
 * re-runs upsert the score. Returns a `null` summary when disabled.
 */
export async function runV2AuditOnce(): Promise<AuditRunSummary | null> {
  if (runInProgress) {
    log.info('audit skipped — previous run still in progress');
    return null;
  }
  runInProgress = true;
  const t0 = Date.now();
  const config = loadV2QualityAuditConfig();

  try {
    const runRow = await db.v2_quality_audit_runs.create({
      data: {
        run_date: new Date(new Date().toISOString().slice(0, 10)),
        total_videos: 0,
        pass_count: 0,
        warning_count: 0,
        critical_count: 0,
        avg_score: null,
        started_at: new Date(),
        status: 'running',
      },
    });

    const rows: V2Row[] = await db.$queryRawUnsafe<V2Row[]>(
      `SELECT vrs.video_id, vrs.model, vrs.core, vrs.segments, yv.duration_seconds
         FROM video_rich_summaries vrs
         LEFT JOIN youtube_videos yv ON yv.youtube_video_id = vrs.video_id
        WHERE vrs.template_version = 'v2'
        LIMIT $1`,
      config.scanLimit
    );

    let pass = 0;
    let warning = 0;
    let critical = 0;
    let scoreSum = 0;
    const byModel: Record<string, { count: number; scoreSum: number }> = {};
    const byViolation: Record<string, number> = {};
    const enqueueIds: Array<{ videoId: string; reason: string }> = [];

    const auditDate = new Date(new Date().toISOString().slice(0, 10));

    for (const row of rows) {
      const score = computeAuditScore(
        {
          videoId: row.video_id,
          durationSeconds: row.duration_seconds,
          oneliner: extractOneliner(row.core),
          sections: extractSections(row.segments),
          atoms: extractAtoms(row.segments),
        },
        config.warningScore
      );

      const classification = classifyScore(score.overall, config.passScore, config.warningScore);
      if (classification === 'pass') pass += 1;
      else if (classification === 'warning') warning += 1;
      else critical += 1;

      scoreSum += score.overall;

      const modelKey = row.model ?? 'unknown';
      const bucket = byModel[modelKey] ?? { count: 0, scoreSum: 0 };
      bucket.count += 1;
      bucket.scoreSum += score.overall;
      byModel[modelKey] = bucket;

      for (const violation of score.violations) {
        byViolation[violation.metric] = (byViolation[violation.metric] ?? 0) + 1;
      }

      await db.v2_quality_audit_log.upsert({
        where: {
          video_id_audit_date: {
            video_id: row.video_id,
            audit_date: auditDate,
          },
        },
        create: {
          video_id: row.video_id,
          audit_date: auditDate,
          audit_run_id: runRow.id,
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
          audit_run_id: runRow.id,
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

      if (classification === 'critical') {
        const topViolation = score.violations[0];
        enqueueIds.push({
          videoId: row.video_id,
          reason: topViolation
            ? `${topViolation.metric} score=${topViolation.score} (${topViolation.detail})`
            : `overall_score=${score.overall}`,
        });
      }
    }

    // Enqueue critical rows for regen (Phase 3 worker reads). Skip rows
    // already pending to avoid duplicate enqueues across audit days.
    let enqueuedCount = 0;
    for (const item of enqueueIds) {
      const existing = await db.v2_quality_regen_queue.findFirst({
        where: { video_id: item.videoId, status: 'pending' },
      });
      if (existing) continue;
      await db.v2_quality_regen_queue.create({
        data: {
          video_id: item.videoId,
          priority: 3, // critical = high priority (1-10, lower = sooner)
          reason: item.reason,
        },
      });
      enqueuedCount += 1;
    }

    const total = rows.length;
    const avgScore = total === 0 ? 0 : scoreSum / total;
    const byModelOut: Record<string, { count: number; avg_score: number }> = {};
    for (const [model, bucket] of Object.entries(byModel)) {
      byModelOut[model] = {
        count: bucket.count,
        avg_score: bucket.count === 0 ? 0 : Math.round(bucket.scoreSum / bucket.count),
      };
    }

    await db.v2_quality_audit_runs.update({
      where: { id: runRow.id },
      data: {
        total_videos: total,
        pass_count: pass,
        warning_count: warning,
        critical_count: critical,
        avg_score: avgScore,
        by_model: byModelOut,
        by_violation: byViolation,
        completed_at: new Date(),
        status: 'completed',
      },
    });

    const elapsedMs = Date.now() - t0;
    log.info('v2 quality audit run complete', {
      runId: runRow.id,
      total,
      pass,
      warning,
      critical,
      avgScore: Math.round(avgScore),
      enqueuedForRegen: enqueuedCount,
      elapsedMs,
    });

    return {
      runId: runRow.id,
      total,
      pass,
      warning,
      critical,
      avgScore,
      elapsedMs,
      enqueuedForRegen: enqueuedCount,
    };
  } catch (err) {
    log.error('v2 quality audit run failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    runInProgress = false;
  }
}

export function startV2QualityAuditCron(): void {
  const config = loadV2QualityAuditConfig();
  if (!config.enabled) {
    log.info('v2 quality audit cron disabled (V2_QUALITY_AUDIT_ENABLED=false)');
    return;
  }
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
  if (!cron.validate(config.cronSchedule)) {
    log.error('v2 quality audit cron schedule invalid — not started', {
      schedule: config.cronSchedule,
    });
    return;
  }
  cronTask = cron.schedule(config.cronSchedule, () => {
    void runV2AuditOnce();
  });
  log.info('v2 quality audit cron started', {
    schedule: config.cronSchedule,
    passScore: config.passScore,
    warningScore: config.warningScore,
    scanLimit: config.scanLimit,
  });
}

export function stopV2QualityAuditCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    log.info('v2 quality audit cron stopped');
  }
}
