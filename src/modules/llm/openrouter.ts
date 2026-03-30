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
  get model(): string {
    return `openrouter/${config.openrouter.model}`;
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const apiKey = config.openrouter.apiKey;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }

    const body: Record<string, unknown> = {
      model: config.openrouter.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      // Disable thinking/reasoning mode — Qwen3 models consume token budget on reasoning,
      // leaving content empty. See troubleshooting.md "Qwen3 thinking 모드 → 빈 응답".
      reasoning: { enabled: false },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
        throw new Error(`OpenRouter request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content: string; reasoning?: string } }>;
    };

    const message = data.choices?.[0]?.message;
    const content = message?.content || message?.reasoning;
    if (!content) {
      throw new Error('OpenRouter returned empty response');
    }

    return content;
  }
}
