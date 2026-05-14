/**
 * Google Custom Search Engine (CSE) — module config (zod schema).
 *
 * CP458 T4-1 PoC: web search fallback for sparse-domain mandalas.
 * Design: unset env → enabled=false → routes return 503 graceful.
 * Mirrors billing/config.ts pattern (ADR-1/§7.1 rollback pattern).
 *
 * CLAUDE.md "Configuration Architecture: Secrets vs Config":
 * - GOOGLE_CSE_API_KEY = secret (GitHub Secrets).
 * - GOOGLE_CSE_CX      = variable/non-secret (CP392 rule: search engine ID
 *   is visible in the Programmable Search Engine dashboard URL, not sensitive).
 *
 * Prod activation: add GitHub Secret GOOGLE_CSE_API_KEY + Variable GOOGLE_CSE_CX,
 * then include in deploy.yml env injection block. (Separate PR from this PoC.)
 */

import { z } from 'zod';

const envSchema = z.object({
  GOOGLE_CSE_API_KEY: z.string().min(1).optional(),
  GOOGLE_CSE_CX: z.string().min(1).optional(),
});

export interface GoogleCseConfig {
  apiKey: string;
  cx: string;
  /** true only when both GOOGLE_CSE_API_KEY and GOOGLE_CSE_CX are set. */
  enabled: boolean;
}

/**
 * Parse and freeze Google CSE config from process.env at module load.
 * Returns `enabled=false` when any required env is missing (no throw).
 */
export function loadGoogleCseConfig(env: NodeJS.ProcessEnv = process.env): GoogleCseConfig {
  const parsed = envSchema.safeParse({
    GOOGLE_CSE_API_KEY: env['GOOGLE_CSE_API_KEY'],
    GOOGLE_CSE_CX: env['GOOGLE_CSE_CX'],
  });

  if (!parsed.success) {
    return disabledConfig();
  }

  const e = parsed.data;
  if (!e.GOOGLE_CSE_API_KEY || !e.GOOGLE_CSE_CX) {
    return disabledConfig();
  }

  return {
    apiKey: e.GOOGLE_CSE_API_KEY,
    cx: e.GOOGLE_CSE_CX,
    enabled: true,
  };
}

function disabledConfig(): GoogleCseConfig {
  return { apiKey: '', cx: '', enabled: false };
}

export const googleCseConfig = loadGoogleCseConfig();
