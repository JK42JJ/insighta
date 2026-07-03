/**
 * Domain-fit shadow config (R13-1 — search redesign, per-cell domain-fit
 * shadow classifier).
 *
 * Runs the FROZEN T3 local-Ollama binary classifier (docs/qa/domain-fit-probe-T3.md,
 * R12-validated) against the v3 recruited candidate set (post keyword/embedding
 * recruit + applyMandalaFilterWithStats — see mandala-filter integration in
 * `src/skills/plugins/video-discover/v3/executor.ts`) and LOGS fit/not-fit +
 * the candidate's current rank via the existing `recordTrace` instrumentation
 * (`src/modules/discover-tracing`). enforce-0: no rerank multiplier is ever
 * applied to the serve order — this flag only turns on ASYNC, POST-SERVE
 * logging calls to a local Mac Mini Ollama instance.
 *
 * Compliance: inference is local-only (Mac Mini via Tailscale). No Anthropic /
 * OpenRouter / YouTube API calls are made by this module.
 *
 * Default OFF (unset = legacy, zero behavior change, zero extra calls).
 * Rollback = flip env off, no code revert.
 */

import { z } from 'zod';

// Treat only "true"/"1"/"yes" as true (same idiom as inflow-gate.ts /
// relevance-rubric.ts — avoids z.coerce.boolean making "false" truthy).
const boolFlag = z.preprocess((v) => {
  if (v == null || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}, z.boolean());

export const domainFitShadowEnvSchema = z.object({
  /** Master flag. false (default) = no-op, byte-identical to pre-R13 behavior. */
  DOMAIN_FIT_SHADOW: boolFlag.default(false as unknown as string),
  /**
   * Tailscale address of the Mac Mini running `mandala-gen:latest`. Frozen
   * per docs/qa/domain-fit-probe-T3.md. Deliberately NOT the generic
   * OLLAMA_URL (that one defaults to localhost and a different model/endpoint
   * shape — see src/modules/llm/ollama.ts /api/chat vs this module's raw
   * /api/generate) so this shadow path never silently rides on unrelated
   * Ollama config changes.
   */
  DOMAIN_FIT_SHADOW_OLLAMA_URL: z.string().default('http://100.91.173.17:11434'),
  DOMAIN_FIT_SHADOW_MODEL: z.string().default('mandala-gen:latest'),
  /** Per-call timeout — a hung Mac Mini call must never leak past this. */
  DOMAIN_FIT_SHADOW_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  /** Bounded concurrency for the local Ollama burst (mirrors inflow-gate SCORE_BURST). */
  DOMAIN_FIT_SHADOW_CONCURRENCY: z.coerce.number().int().positive().max(16).default(4),
  /**
   * Hard cap on candidates scored per recruited set. Local Ollama is
   * single-instance — an unbounded fan-out on a 100+ candidate cell would
   * both hammer the Mac Mini (feedback_no_repeated_hammering.md) and delay
   * the shadow log write. Excess candidates are simply not scored (partial
   * shadow coverage, never a serve-path effect).
   */
  DOMAIN_FIT_SHADOW_MAX_CANDIDATES: z.coerce.number().int().positive().max(200).default(40),
});

export interface DomainFitShadowConfig {
  enabled: boolean;
  ollamaUrl: string;
  model: string;
  timeoutMs: number;
  concurrency: number;
  maxCandidates: number;
}

const DEFAULTS: DomainFitShadowConfig = {
  enabled: false,
  ollamaUrl: 'http://100.91.173.17:11434',
  model: 'mandala-gen:latest',
  timeoutMs: 5000,
  concurrency: 4,
  maxCandidates: 40,
};

export function loadDomainFitShadowConfig(
  env: NodeJS.ProcessEnv = process.env
): DomainFitShadowConfig {
  const parsed = domainFitShadowEnvSchema.safeParse({
    DOMAIN_FIT_SHADOW: env['DOMAIN_FIT_SHADOW'],
    DOMAIN_FIT_SHADOW_OLLAMA_URL: env['DOMAIN_FIT_SHADOW_OLLAMA_URL'],
    DOMAIN_FIT_SHADOW_MODEL: env['DOMAIN_FIT_SHADOW_MODEL'],
    DOMAIN_FIT_SHADOW_TIMEOUT_MS: env['DOMAIN_FIT_SHADOW_TIMEOUT_MS'],
    DOMAIN_FIT_SHADOW_CONCURRENCY: env['DOMAIN_FIT_SHADOW_CONCURRENCY'],
    DOMAIN_FIT_SHADOW_MAX_CANDIDATES: env['DOMAIN_FIT_SHADOW_MAX_CANDIDATES'],
  });
  if (!parsed.success) return { ...DEFAULTS };
  return {
    enabled: parsed.data.DOMAIN_FIT_SHADOW,
    ollamaUrl: parsed.data.DOMAIN_FIT_SHADOW_OLLAMA_URL,
    model: parsed.data.DOMAIN_FIT_SHADOW_MODEL,
    timeoutMs: parsed.data.DOMAIN_FIT_SHADOW_TIMEOUT_MS,
    concurrency: parsed.data.DOMAIN_FIT_SHADOW_CONCURRENCY,
    maxCandidates: parsed.data.DOMAIN_FIT_SHADOW_MAX_CANDIDATES,
  };
}
