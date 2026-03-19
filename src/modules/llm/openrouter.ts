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

export class OpenRouterGenerationProvider implements GenerationProvider {
  readonly name = 'openrouter';
  get model(): string { return `openrouter/${config.openrouter.model}`; }

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
    };

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://insighta.one',
        'X-Title': 'Insighta',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenRouter returned empty response');
    }

    return content;
  }
}
