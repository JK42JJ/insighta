/**
 * OpenRouter LLM Provider
 *
 * Cloud-based generation via OpenRouter API (OpenAI-compatible format).
 * Generation only — embedding uses Gemini/Ollama providers.
 * Issue: #251 (MA-2: GraphDB Service Layer)
 */

import type { GenerationProvider, GenerateOptions } from './provider';
import { config } from '../../config';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MAX_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 120_000;

export class OpenRouterGenerationProvider implements GenerationProvider {
  readonly name = 'openrouter';
  private readonly modelOverride?: string;

  constructor(modelOverride?: string) {
    this.modelOverride = modelOverride;
  }

  get model(): string {
    return `openrouter/${this.modelOverride ?? config.openrouter.model}`;
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const apiKey = config.openrouter.apiKey;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }

    const activeModel = this.modelOverride ?? config.openrouter.model;

    const body: Record<string, unknown> = {
      model: activeModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
    };

    // Disable thinking/reasoning mode for Qwen models only — Qwen3 consumes
    // token budget on reasoning, leaving content empty.
    // See troubleshooting.md "Qwen3 thinking 모드 → 빈 응답".
    // Claude/Anthropic models do not support this field and will error if sent.
    if (activeModel.includes('qwen')) {
      body['reasoning'] = { enabled: false };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    // Forward external abort (e.g. race-fallback discarding the LLM loser)
    // into the same controller so the underlying fetch is cancelled too.
    const externalSignal = options?.signal;
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    let response: Response;
    try {
      response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://insighta.one',
          'X-Title': 'Insighta',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // Distinguish "external cancel" from internal timeout for clearer logs.
        if (externalSignal?.aborted) {
          throw new Error('OpenRouter request cancelled by external signal');
        }
        throw new Error(`OpenRouter request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content: string; reasoning?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    // Log token usage for performance analysis
    if (data.usage) {
      console.info(
        `[OpenRouter] model=${activeModel} prompt=${data.usage.prompt_tokens} completion=${data.usage.completion_tokens} total=${data.usage.total_tokens}`
      );
    }

    const message = data.choices?.[0]?.message;
    const content = message?.content;
    if (!content) {
      const hasReasoning = !!message?.reasoning;
      throw new Error(
        `OpenRouter returned empty content${hasReasoning ? ' (reasoning-only response detected — CoT leakage blocked)' : ''}`
      );
    }

    return content;
  }
}
