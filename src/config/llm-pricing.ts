/**
 * LLM Pricing SSOT
 *
 * Per-token costs for known models, sourced from provider APIs.
 * Prices are in USD per token (NOT per 1K tokens).
 *
 * OpenRouter prices fetched from https://openrouter.ai/api/v1/models on 2026-04-27.
 * Gemini prices: gemini-pro is a local alias for GEMINI_GENERATE_MODEL — zero-cost
 * placeholder until Gemini billing is confirmed via google.com/pricing.
 * Ollama models are local inference: zero cost.
 *
 * IMPORTANT: Re-fetch from OpenRouter API when adding new models:
 *   curl -s https://openrouter.ai/api/v1/models | python3 -c "
 *     import sys, json; data = json.load(sys.stdin)
 *     for m in data['data']:
 *       p = m.get('pricing', {})
 *       print(m['id'], p.get('prompt'), p.get('completion'))
 *   "
 */

export interface LLMPricing {
  /** Cost per input token in USD */
  inputPerToken: number;
  /** Cost per output token in USD */
  outputPerToken: number;
  /** Where this price was sourced from */
  source: string;
}

/**
 * Known model pricing table.
 * Key is the canonical model ID without provider prefix
 * (e.g., 'qwen/qwen3-30b-a3b', NOT 'openrouter/qwen/qwen3-30b-a3b').
 */
export const LLM_PRICING: Record<string, LLMPricing> = {
  // --- OpenRouter: Qwen family (sourced 2026-04-27) ---
  'qwen/qwen3-30b-a3b': {
    inputPerToken: 0.00000008,
    outputPerToken: 0.00000028,
    source: 'openrouter.ai/api/v1/models',
  },
  'qwen/qwen3.5-9b': {
    inputPerToken: 0.0000001,
    outputPerToken: 0.00000015,
    source: 'openrouter.ai/api/v1/models',
  },
  'qwen/qwen3-30b-a3b-thinking-2507': {
    inputPerToken: 0.00000008,
    outputPerToken: 0.0000004,
    source: 'openrouter.ai/api/v1/models',
  },
  'qwen/qwen3-30b-a3b-instruct-2507': {
    inputPerToken: 0.00000009,
    outputPerToken: 0.0000003,
    source: 'openrouter.ai/api/v1/models',
  },

  // --- OpenRouter: Google Gemini family (sourced 2026-04-27) ---
  'google/gemini-2.5-flash': {
    inputPerToken: 0.0000003,
    outputPerToken: 0.0000025,
    source: 'openrouter.ai/api/v1/models',
  },
  'google/gemini-2.5-flash-lite': {
    inputPerToken: 0.0000001,
    outputPerToken: 0.0000004,
    source: 'openrouter.ai/api/v1/models',
  },

  // --- Ollama: Local inference (zero cost) ---
  // config.ollama.generateModel default = 'qwen3.5:9b'
  'qwen3.5:9b': {
    inputPerToken: 0,
    outputPerToken: 0,
    source: 'local',
  },
  'mandala-gen': {
    inputPerToken: 0,
    outputPerToken: 0,
    source: 'local',
  },

  // --- Gemini direct API (via gemini.ts, not OpenRouter) ---
  // gemini-pro is the GEMINI_GENERATE_MODEL constant in gemini.ts.
  // Direct Gemini API billing is tracked via Google Cloud — this entry
  // is a placeholder so cost_usd is not null for Gemini calls.
  // Update when confirmed from Google AI pricing page.
  'gemini-pro': {
    inputPerToken: 0.0000005,
    outputPerToken: 0.0000015,
    source: 'ai.google.dev/pricing (placeholder)',
  },
};

/**
 * Calculate the cost of an LLM call in USD.
 *
 * Strips provider prefixes before looking up pricing:
 *   'openrouter/qwen/qwen3-30b-a3b' -> 'qwen/qwen3-30b-a3b'
 *   'ollama/qwen3.5:9b'             -> 'qwen3.5:9b'
 *   'gemini/gemini-pro'             -> 'gemini-pro'
 *
 * @returns Cost in USD, or null if the model is not in the pricing table.
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number | null {
  // Strip known provider prefixes
  const normalizedModel = model
    .replace(/^openrouter\//, '')
    .replace(/^ollama\//, '')
    .replace(/^gemini\//, '');

  const pricing = LLM_PRICING[normalizedModel];
  if (!pricing) return null; // unknown model — cost_usd stays NULL

  return inputTokens * pricing.inputPerToken + outputTokens * pricing.outputPerToken;
}
