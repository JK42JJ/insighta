/**
 * Inflow-gate config (CP500++ PR-3 — wizard relevance judge).
 *
 * The wizard v5 path (V5_PICKER_MODE=cell_binning) places cards with NO
 * relevance judge, unlike v3 (cosine center gate) and pool-serve (Haiku gate).
 * This flag pair gates a Layer-2 relevance judge on the wizard path only.
 *
 * 2-stage canary (mirrors the RELEVANCE_RUBRIC_ENABLED → BATCH_GATE_PRUNE split):
 *   INFLOW_GATE_ENABLED — run the judge and TRACE would-cut, but DO NOT drop
 *     (score/log-only; zero behavior change). Observe traces first.
 *   INFLOW_GATE_CUT — actually drop slots below the threshold. Separate flag,
 *     separate [GO], flipped only after would-cut traces look clean.
 *
 * Default: both OFF (unset = legacy, no judge, no cut). Rollback = flip env,
 * no code revert. Single-sourced in docker-compose.prod.yml environment per
 * CONFIG-SSOT (PR-1); never written to .env by deploy.yml.
 */

import { z } from 'zod';

// Treat only "true"/"1"/"yes" as true (avoids z.coerce.boolean making "false"
// truthy) — same idiom as src/config/relevance-rubric.ts.
const boolFlag = z.preprocess((v) => {
  if (v == null || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}, z.boolean());

export const inflowGateEnvSchema = z.object({
  INFLOW_GATE_ENABLED: boolFlag.default(false as unknown as string),
  INFLOW_GATE_CUT: boolFlag.default(false as unknown as string),
  /** Slots scoring below this gate pct are would-cut (stage 1) / dropped (stage 2). */
  INFLOW_GATE_RELEVANCE_MIN: z.coerce.number().int().min(0).max(100).default(60),
});

export interface InflowGateConfig {
  enabled: boolean;
  cut: boolean;
  relevanceMin: number;
}

export function loadInflowGateConfig(env: NodeJS.ProcessEnv = process.env): InflowGateConfig {
  const parsed = inflowGateEnvSchema.safeParse({
    INFLOW_GATE_ENABLED: env['INFLOW_GATE_ENABLED'],
    INFLOW_GATE_CUT: env['INFLOW_GATE_CUT'],
    INFLOW_GATE_RELEVANCE_MIN: env['INFLOW_GATE_RELEVANCE_MIN'],
  });
  if (!parsed.success) {
    return { enabled: false, cut: false, relevanceMin: 60 };
  }
  return {
    enabled: parsed.data.INFLOW_GATE_ENABLED,
    cut: parsed.data.INFLOW_GATE_CUT,
    relevanceMin: parsed.data.INFLOW_GATE_RELEVANCE_MIN,
  };
}
