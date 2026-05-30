/**
 * LLM picker config — model selection for /add-cards v5 path.
 *
 * Pluggable so user can swap Haiku ↔ Sonnet ↔ Gemini Flash without code change.
 * Defaults pinned to Haiku 4.5 via OpenRouter per CP490+ directive.
 */

import { z } from 'zod';

const llmPickerEnvSchema = z.object({
  LLM_PICKER_MODEL: z.string().default('anthropic/claude-haiku-4.5'),
  LLM_PICKER_BATCH_SIZE: z.coerce.number().int().min(4).max(40).default(12),
  LLM_PICKER_MAX_PARALLEL: z.coerce.number().int().min(1).max(12).default(5),
  LLM_PICKER_TIMEOUT_MS: z.coerce.number().int().min(2000).max(15000).default(5000),
  LLM_PICKER_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.2),
});

export interface LlmPickerConfig {
  model: string;
  batchSize: number;
  maxParallel: number;
  timeoutMs: number;
  temperature: number;
}

let cached: LlmPickerConfig | null = null;

export function getLlmPickerConfig(env: NodeJS.ProcessEnv = process.env): LlmPickerConfig {
  if (cached) return cached;
  const parsed = llmPickerEnvSchema.parse(env);
  cached = {
    model: parsed.LLM_PICKER_MODEL,
    batchSize: parsed.LLM_PICKER_BATCH_SIZE,
    maxParallel: parsed.LLM_PICKER_MAX_PARALLEL,
    timeoutMs: parsed.LLM_PICKER_TIMEOUT_MS,
    temperature: parsed.LLM_PICKER_TEMPERATURE,
  };
  return cached;
}

export function resetLlmPickerConfigForTest(): void {
  cached = null;
}
