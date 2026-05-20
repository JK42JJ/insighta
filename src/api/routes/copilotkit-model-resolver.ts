/**
 * Resolves which model name the CopilotKit chatbot route should hand to its
 * service adapter, given:
 *   - the configured provider (gemini / openrouter / local / qwen-runpod)
 *   - the optional CHATBOT_MODEL explicit override
 *   - the per-provider default models (passed in so this stays pure +
 *     side-effect-free for unit testing — `config/index.ts` runs zod env
 *     validation at module load and is awkward to import from jest).
 *
 * CP475+2 — pre-fix `CHATBOT_MODEL` had a hard-coded default of
 * `google/gemini-2.5-flash`. The route then force-injected that model
 * name into every provider's adapter, so the RunPod path sent
 * `model=google/gemini-2.5-flash` to vLLM and the Pod returned 404
 * (`The model 'google/gemini-2.5-flash' does not exist`).
 *
 * Fix: `CHATBOT_MODEL` is now optional. When unset, this resolver picks
 * the provider's native default (vLLM `insighta-chatbot`, openrouter
 * `google/gemini-2.5-flash`, etc).
 */

export type ChatbotProvider = 'gemini' | 'openrouter' | 'local' | 'qwen-runpod';

export interface ProviderDefaults {
  /** Gemini-via-OpenRouter / direct OpenRouter default — same model id. */
  openrouter: string;
  /** Local Ollama default (e.g. configured generateModel). */
  local: string;
  /** vLLM served-model-name on the RunPod Pod. */
  qwenRunpod: string;
}

export function resolveChatbotModel(
  provider: ChatbotProvider,
  explicit: string | undefined,
  defaults: ProviderDefaults
): string {
  if (explicit && explicit.length > 0) return explicit;
  switch (provider) {
    case 'gemini':
    case 'openrouter':
      return defaults.openrouter;
    case 'local':
      return defaults.local;
    case 'qwen-runpod':
      return defaults.qwenRunpod;
  }
}
