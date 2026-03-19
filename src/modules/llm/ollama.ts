/**
 * Ollama LLM Providers
 *
 * Local inference via Ollama API for embedding and generation.
 * Dev-only — falls back to Gemini in production or when Ollama is unavailable.
 */

import type { EmbeddingProvider, GenerationProvider, GenerateOptions } from './provider';
import { config } from '../../config';

const OLLAMA_EMBED_DIMENSION = 768;
const HEALTH_CHECK_TIMEOUT_MS = 2000;

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly dimension = OLLAMA_EMBED_DIMENSION;

  private get baseUrl(): string {
    return config.ollama.url;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollama.embedModel,
        input: text,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Ollama embed API error ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as { embeddings: number[][] };

    if (!data.embeddings?.[0]) {
      throw new Error('Ollama returned empty embedding');
    }

    return data.embeddings[0];
  }
}

export class OllamaGenerationProvider implements GenerationProvider {
  readonly name = 'ollama';
  get model(): string { return `ollama/${config.ollama.generateModel}`; }

  private get baseUrl(): string {
    return config.ollama.url;
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    // Use /api/chat with think:false to disable qwen3 thinking mode.
    // Thinking mode consumes tokens internally and returns empty response.
    const body: Record<string, unknown> = {
      model: config.ollama.generateModel,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      think: false,
      options: {
        temperature: options?.temperature ?? 0.3,
      },
    };

    if (options?.maxTokens) {
      const opts = body['options'] as Record<string, unknown>;
      opts['num_predict'] = options.maxTokens;
    }

    if (options?.format === 'json') {
      body['format'] = 'json';
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Ollama generate API error ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as { message?: { content: string } };
    const content = data.message?.content;

    if (!content) {
      throw new Error('Ollama returned empty response');
    }

    return content;
  }
}

/**
 * Check if Ollama is running and responsive.
 */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

    const response = await fetch(`${config.ollama.url}/api/tags`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}
