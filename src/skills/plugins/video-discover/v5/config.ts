/**
 * v5 (LLM-pick) budget knobs.
 *
 * Latency target: 12s total. Breakdown:
 *   - YouTube fanout: ≤ 2.5s   (8 parallel × 1.5s each, allSettled)
 *   - LLM batches:    ≤ 3.5s   (5 parallel Haiku calls)
 *   - videos.list:    ≤ 0.8s   (1 call, picked ids only)
 *   - DB exclude:     ≤ 0.5s
 *   - buffer:         ≥ 4.7s
 */

import { z } from 'zod';

const v5EnvSchema = z.object({
  V5_MAX_QUERIES: z.coerce.number().int().min(1).max(20).default(8),
  V5_SEARCH_TIMEOUT_MS: z.coerce.number().int().min(500).max(8000).default(2000),
  V5_SEARCH_MAX_RESULTS: z.coerce.number().int().min(10).max(50).default(25),
  V5_TARGET_PICKS: z.coerce.number().int().min(10).max(60).default(30),
  V5_DEDUP_HARDCAP: z.coerce.number().int().min(40).max(400).default(120),
  // CP491 — short gate. Over-pick by this factor before dropping Shorts so
  // the final count holds at targetPicks (drop happens pre-final-slice).
  V5_SHORT_OVERPICK_FACTOR: z.coerce.number().min(1).max(3).default(1.5),
  // Hard wall-clock cap for the whole short-probe phase (shared deadline
  // across all probes). 0 disables the gate. Fail-open past this.
  V5_SHORT_PROBE_DEADLINE_MS: z.coerce.number().int().min(0).max(15000).default(8000),
});

export interface V5Config {
  maxQueries: number;
  searchTimeoutMs: number;
  searchMaxResults: number;
  targetPicks: number;
  dedupHardCap: number;
  shortOverpickFactor: number;
  shortProbeDeadlineMs: number;
}

let cached: V5Config | null = null;

export function getV5Config(env: NodeJS.ProcessEnv = process.env): V5Config {
  if (cached) return cached;
  const p = v5EnvSchema.parse(env);
  cached = {
    maxQueries: p.V5_MAX_QUERIES,
    searchTimeoutMs: p.V5_SEARCH_TIMEOUT_MS,
    searchMaxResults: p.V5_SEARCH_MAX_RESULTS,
    targetPicks: p.V5_TARGET_PICKS,
    dedupHardCap: p.V5_DEDUP_HARDCAP,
    shortOverpickFactor: p.V5_SHORT_OVERPICK_FACTOR,
    shortProbeDeadlineMs: p.V5_SHORT_PROBE_DEADLINE_MS,
  };
  return cached;
}

export function resetV5ConfigForTest(): void {
  cached = null;
}
