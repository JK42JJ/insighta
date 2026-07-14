/**
 * Web-search module config — language-routed evidence source for book
 * research/factcheck (2026-07-14 provider swap, benchmark-driven).
 *
 * Replaces Google CSE (closed to new customers, dies 2027-01-01). Providers
 * chosen by a 110-query benchmark on real prod mandala titles (see
 * docs/handoffs/web-search-provider-eval-2026-07-14.md):
 *  - Korean queries  → Naver Open API (hit@3 76%, official-domain strength)
 *  - en/ja/zh queries → OpenRouter web plugin (Exa) — real page extracts,
 *    direct URLs, best citable-evidence rate (vs Gemini grounding's expiring
 *    redirect URLs + synthesized snippets = disqualified for evidence)
 *
 * Unset env → that leg disabled; both unset → enabled=false (graceful,
 * research yields 0 / factcheck runs without web evidence — fill-book logs
 * the degradation loudly).
 */

import { z } from 'zod';

const envSchema = z.object({
  NAVER_CLIENT_ID: z.string().min(1).optional(),
  NAVER_CLIENT_SECRET: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_WEB_SEARCH_MODEL: z.string().min(1).optional(),
});

export interface WebSearchConfig {
  naverClientId: string;
  naverClientSecret: string;
  /** Korean leg (Naver Open API). */
  naverEnabled: boolean;
  openrouterApiKey: string;
  /** Carrier model for the OpenRouter web plugin (annotations extractor). */
  openrouterWebModel: string;
  /** Global (en/ja/zh) leg via OpenRouter web plugin. */
  globalEnabled: boolean;
  /** true when at least one leg is usable. */
  enabled: boolean;
}

const DEFAULT_WEB_MODEL = 'openai/gpt-4o-mini';

export function loadWebSearchConfig(env: NodeJS.ProcessEnv = process.env): WebSearchConfig {
  const parsed = envSchema.safeParse({
    NAVER_CLIENT_ID: env['NAVER_CLIENT_ID'],
    NAVER_CLIENT_SECRET: env['NAVER_CLIENT_SECRET'],
    OPENROUTER_API_KEY: env['OPENROUTER_API_KEY'],
    OPENROUTER_WEB_SEARCH_MODEL: env['OPENROUTER_WEB_SEARCH_MODEL'],
  });

  if (!parsed.success) {
    return disabledConfig();
  }

  const e = parsed.data;
  const naverEnabled = Boolean(e.NAVER_CLIENT_ID && e.NAVER_CLIENT_SECRET);
  const globalEnabled = Boolean(e.OPENROUTER_API_KEY);

  return {
    naverClientId: e.NAVER_CLIENT_ID ?? '',
    naverClientSecret: e.NAVER_CLIENT_SECRET ?? '',
    naverEnabled,
    openrouterApiKey: e.OPENROUTER_API_KEY ?? '',
    openrouterWebModel: e.OPENROUTER_WEB_SEARCH_MODEL ?? DEFAULT_WEB_MODEL,
    globalEnabled,
    enabled: naverEnabled || globalEnabled,
  };
}

function disabledConfig(): WebSearchConfig {
  return {
    naverClientId: '',
    naverClientSecret: '',
    naverEnabled: false,
    openrouterApiKey: '',
    openrouterWebModel: DEFAULT_WEB_MODEL,
    globalEnabled: false,
    enabled: false,
  };
}
