/**
 * Live-search gate config (D-01 2026-07-03 — add-cards quality wiring).
 *
 * The add-cards live path (v5) exposes candidates with NO relevance or
 * language-audio judge — the floor-canary incident proved a trust-only gate
 * kills niche topics, so this gate wires the RELEVANCE axis (shared Haiku
 * scorer, gc<min = hidden) plus an AUDIO-LANGUAGE check (defaultAudioLanguage
 * from the existing videos.list call) onto the EXPOSED slice only (top-N by
 * pick score; the tail is never scored, it is demoted below scored results).
 *
 * Default OFF (unset = legacy, no gate). Rollback = flip env, no code revert.
 * Single-sourced in docker-compose.prod.yml environment per CONFIG-SSOT.
 */

import { z } from 'zod';

const boolFlag = z.preprocess((v) => {
  if (v == null || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}, z.boolean());

export const liveSearchGateEnvSchema = z.object({
  LIVE_SEARCH_GC_GATE: boolFlag.default(false as unknown as string),
  /** Exposed slice scored per round; tail beyond this is demoted, not scored. */
  LIVE_SEARCH_GC_TOP_N: z.coerce.number().int().min(1).max(100).default(20),
  /** Haiku scoring concurrency (single wave when >= TOP_N keeps p95 low). */
  LIVE_SEARCH_GC_BURST: z.coerce.number().int().min(1).max(50).default(20),
  /** Candidates scoring below this are hidden from the exposed results. */
  LIVE_SEARCH_GC_MIN: z.coerce.number().int().min(0).max(100).default(60),
});

export interface LiveSearchGateConfig {
  enabled: boolean;
  topN: number;
  burst: number;
  relevanceMin: number;
}

export function loadLiveSearchGateConfig(
  env: NodeJS.ProcessEnv = process.env
): LiveSearchGateConfig {
  const parsed = liveSearchGateEnvSchema.safeParse({
    LIVE_SEARCH_GC_GATE: env['LIVE_SEARCH_GC_GATE'],
    LIVE_SEARCH_GC_TOP_N: env['LIVE_SEARCH_GC_TOP_N'],
    LIVE_SEARCH_GC_BURST: env['LIVE_SEARCH_GC_BURST'],
    LIVE_SEARCH_GC_MIN: env['LIVE_SEARCH_GC_MIN'],
  });
  if (!parsed.success) {
    return { enabled: false, topN: 20, burst: 20, relevanceMin: 60 };
  }
  return {
    enabled: parsed.data.LIVE_SEARCH_GC_GATE,
    topN: parsed.data.LIVE_SEARCH_GC_TOP_N,
    burst: parsed.data.LIVE_SEARCH_GC_BURST,
    relevanceMin: parsed.data.LIVE_SEARCH_GC_MIN,
  };
}
