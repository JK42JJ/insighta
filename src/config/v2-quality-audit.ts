/**
 * v2 Quality Audit config (CP488+, 2026-05-27).
 *
 * Phase 1 MVP per docs/design/v2-quality-audit-system-2026-05-27.md.
 * Mirrors the shape of `src/config/rich-summary.ts`: a zod schema with
 * sensible defaults and a single `loadV2QualityAuditConfig()` accessor.
 *
 * Default state on PR merge: DISABLED. The cron registers a no-op when
 * `V2_QUALITY_AUDIT_ENABLED=false`, so schema + scheduler can ship to prod
 * with zero behavioural surface. Operator flips the env once the admin
 * dashboard table is reviewed (`gh variable set V2_QUALITY_AUDIT_ENABLED true`).
 */

import { z } from 'zod';

const boolFlag = z.preprocess((v) => {
  if (v == null || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}, z.boolean());

const positiveInt = z.preprocess(
  (v) => (v == null || v === '' ? undefined : Number(v)),
  z.number().finite().int().positive().optional()
);

export const v2QualityAuditEnvSchema = z.object({
  V2_QUALITY_AUDIT_ENABLED: boolFlag.default(false as unknown as string),
  V2_QUALITY_AUDIT_CRON_SCHEDULE: z
    .preprocess((v) => (v == null || v === '' ? '0 4 * * *' : String(v).trim()), z.string())
    .default('0 4 * * *'),
  V2_QUALITY_AUDIT_PASS_SCORE: positiveInt.transform((v) => v ?? 85),
  V2_QUALITY_AUDIT_WARNING_SCORE: positiveInt.transform((v) => v ?? 70),
  /** Max rows scanned per run. Default 5,000 covers current ~1,800 v2 row population with headroom. */
  V2_QUALITY_AUDIT_SCAN_LIMIT: positiveInt.transform((v) => v ?? 5000),
  /** Phase 3 batch size — videos processed per regen tick. Default 5 = ~2.5-5 min of LLM work per tick. */
  V2_QUALITY_AUDIT_REGEN_BATCH_SIZE: positiveInt.transform((v) => v ?? 5),
  /** Phase 3 — regen worker activation flag. Default OFF; safe to ship code without enabling. */
  V2_QUALITY_REGEN_ENABLED: boolFlag.default(false as unknown as string),
  /** Phase 3 — regen worker cron schedule. Default every 30 min (5 × 48 = 240 videos/day max throughput). */
  V2_QUALITY_REGEN_CRON_SCHEDULE: z
    .preprocess((v) => (v == null || v === '' ? '*/30 * * * *' : String(v).trim()), z.string())
    .default('*/30 * * * *'),
  /** When true, the CI smoke test exercises a real OpenRouter call. Default OFF — env-gated for cost control. */
  V2_QUALITY_AUDIT_SMOKE_ENABLED: boolFlag.default(false as unknown as string),
});

export interface V2QualityAuditConfig {
  enabled: boolean;
  cronSchedule: string;
  passScore: number;
  warningScore: number;
  scanLimit: number;
  regenBatchSize: number;
  /** Phase 3 — when true, the regen cron schedules itself; default false. */
  regenEnabled: boolean;
  /** Phase 3 — regen cron schedule (default every 30 min). */
  regenCronSchedule: string;
  smokeEnabled: boolean;
}

const FALLBACK_CONFIG: V2QualityAuditConfig = {
  enabled: false,
  cronSchedule: '0 4 * * *',
  passScore: 85,
  warningScore: 70,
  scanLimit: 5000,
  regenBatchSize: 5,
  regenEnabled: false,
  regenCronSchedule: '*/30 * * * *',
  smokeEnabled: false,
};

export function loadV2QualityAuditConfig(
  env: NodeJS.ProcessEnv = process.env
): V2QualityAuditConfig {
  const parsed = v2QualityAuditEnvSchema.safeParse({
    V2_QUALITY_AUDIT_ENABLED: env['V2_QUALITY_AUDIT_ENABLED'],
    V2_QUALITY_AUDIT_CRON_SCHEDULE: env['V2_QUALITY_AUDIT_CRON_SCHEDULE'],
    V2_QUALITY_AUDIT_PASS_SCORE: env['V2_QUALITY_AUDIT_PASS_SCORE'],
    V2_QUALITY_AUDIT_WARNING_SCORE: env['V2_QUALITY_AUDIT_WARNING_SCORE'],
    V2_QUALITY_AUDIT_SCAN_LIMIT: env['V2_QUALITY_AUDIT_SCAN_LIMIT'],
    V2_QUALITY_AUDIT_REGEN_BATCH_SIZE: env['V2_QUALITY_AUDIT_REGEN_BATCH_SIZE'],
    V2_QUALITY_REGEN_ENABLED: env['V2_QUALITY_REGEN_ENABLED'],
    V2_QUALITY_REGEN_CRON_SCHEDULE: env['V2_QUALITY_REGEN_CRON_SCHEDULE'],
    V2_QUALITY_AUDIT_SMOKE_ENABLED: env['V2_QUALITY_AUDIT_SMOKE_ENABLED'],
  });
  if (!parsed.success) {
    return FALLBACK_CONFIG;
  }
  return {
    enabled: parsed.data.V2_QUALITY_AUDIT_ENABLED,
    cronSchedule: parsed.data.V2_QUALITY_AUDIT_CRON_SCHEDULE,
    passScore: parsed.data.V2_QUALITY_AUDIT_PASS_SCORE,
    warningScore: parsed.data.V2_QUALITY_AUDIT_WARNING_SCORE,
    scanLimit: parsed.data.V2_QUALITY_AUDIT_SCAN_LIMIT,
    regenBatchSize: parsed.data.V2_QUALITY_AUDIT_REGEN_BATCH_SIZE,
    regenEnabled: parsed.data.V2_QUALITY_REGEN_ENABLED,
    regenCronSchedule: parsed.data.V2_QUALITY_REGEN_CRON_SCHEDULE,
    smokeEnabled: parsed.data.V2_QUALITY_AUDIT_SMOKE_ENABLED,
  };
}
