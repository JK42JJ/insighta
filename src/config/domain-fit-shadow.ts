/**
 * Domain-fit shadow config (R13-1 — search redesign, domain-fit shadow
 * classifier; R14-1 rescoped goal-level).
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
 * R14-1: classification target is the mandala's `centerGoal` (goal-level),
 * not the per-cell subgoal — R13-2's offline sim found per-cell subgoal
 * scoring produced a 25.8% false-not-fit rate on a known-clean mandala
 * (docs/qa/domain-fit-r13-2-sim-results.md §a), well above the <10% bar;
 * goal-level scoring measured 6.5% on the same style of real data.
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
  /**
   * R14-1 — additive scalar-capture pass (T3_SCALAR, a SEPARATE Ollama call
   * per candidate). Default false: the binary-only call stays the default
   * (half the load). When true, the shadow log also carries a 0.0-1.0
   * confidence per candidate, giving a real gradient for a future rerank
   * simulation (see docs/qa/domain-fit-r13-2-sim-results.md §c — the binary
   * label + a synthetic proxy score could not differentiate multipliers).
   */
  DOMAIN_FIT_SHADOW_SCALAR: boolFlag.default(false as unknown as string),
  /**
   * R19 — WRITE-edge shadow (docs/qa/domain-fit-r14-write-gate-and-goal-level.md
   * §R14-2 file:line). SEPARATE flag from the master `DOMAIN_FIT_SHADOW`
   * (which only gates the serve-side read-path hooks in v3/executor.ts) so
   * the two observability surfaces — "what got served" vs "what got
   * written to video_pool" — can be toggled independently. Same frozen T3
   * classifier + connection config as the master flag; only the on/off
   * switch is distinct. Default false = zero extra Ollama calls, zero
   * extra DB lookups at either WRITE-edge call site.
   */
  DOMAIN_FIT_WRITE_SHADOW: boolFlag.default(false as unknown as string),
});

export interface DomainFitShadowConfig {
  enabled: boolean;
  ollamaUrl: string;
  model: string;
  timeoutMs: number;
  concurrency: number;
  maxCandidates: number;
  scalarEnabled: boolean;
  /** R19 — independent flag for the two WRITE-edge shadow hooks (reuse-loop + /like). */
  writeShadowEnabled: boolean;
}

const DEFAULTS: DomainFitShadowConfig = {
  enabled: false,
  ollamaUrl: 'http://100.91.173.17:11434',
  model: 'mandala-gen:latest',
  timeoutMs: 5000,
  concurrency: 4,
  maxCandidates: 40,
  scalarEnabled: false,
  writeShadowEnabled: false,
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
    DOMAIN_FIT_SHADOW_SCALAR: env['DOMAIN_FIT_SHADOW_SCALAR'],
    DOMAIN_FIT_WRITE_SHADOW: env['DOMAIN_FIT_WRITE_SHADOW'],
  });
  if (!parsed.success) return { ...DEFAULTS };
  return {
    enabled: parsed.data.DOMAIN_FIT_SHADOW,
    ollamaUrl: parsed.data.DOMAIN_FIT_SHADOW_OLLAMA_URL,
    model: parsed.data.DOMAIN_FIT_SHADOW_MODEL,
    timeoutMs: parsed.data.DOMAIN_FIT_SHADOW_TIMEOUT_MS,
    concurrency: parsed.data.DOMAIN_FIT_SHADOW_CONCURRENCY,
    maxCandidates: parsed.data.DOMAIN_FIT_SHADOW_MAX_CANDIDATES,
    scalarEnabled: parsed.data.DOMAIN_FIT_SHADOW_SCALAR,
    writeShadowEnabled: parsed.data.DOMAIN_FIT_WRITE_SHADOW,
  };
}
