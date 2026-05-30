/**
 * VideoPicker registry — resolve impl by env LLM_PICKER_MODEL slug.
 *
 * Current impls: OpenRouter-backed (covers Haiku / Sonnet / Gemini / etc).
 * Future direct-API impls (Anthropic Messages / Gemini API) can register here
 * without touching the executor.
 */

import { OpenRouterVideoPicker } from './openrouter-picker';
import { getLlmPickerConfig } from '../../config/llm-picker';
import type { VideoPicker } from './types';

let cached: VideoPicker | null = null;

export function getVideoPicker(): VideoPicker {
  if (cached) return cached;
  const cfg = getLlmPickerConfig();
  cached = new OpenRouterVideoPicker(cfg.model);
  return cached;
}

export function resetVideoPickerForTest(): void {
  cached = null;
}

export function setVideoPickerForTest(picker: VideoPicker): void {
  cached = picker;
}
