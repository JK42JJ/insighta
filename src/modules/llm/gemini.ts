/**
 * Gemini LLM Providers
 *
 * Cloud-based embedding and generation via Google Gemini API.
 * Extracted from ontology/embedding.ts for provider abstraction.
 */

import type { EmbeddingProvider, GenerationProvider, GenerateOptions } from './provider';
import { logLLMCall } from './call-logger';

const GEMINI_EMBED_MODEL = 'gemini-embedding-001';
const GEMINI_EMBED_DIMENSION = 768;
const GEMINI_EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:embedContent`;

const GEMINI_GENERATE_MODEL = 'gemini-pro';
const GEMINI_GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_GENERATE_MODEL}:generateContent`;

function getApiKey(): string {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  return apiKey;
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'gemini';
  readonly dimension = GEMINI_EMBED_DIMENSION;

  async embed(text: string): Promise<number[]> {
    const apiKey = getApiKey();

    const response = await fetch(`${GEMINI_EMBED_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${GEMINI_EMBED_MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: GEMINI_EMBED_DIMENSION,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Gemini embedding API error ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as { embedding: { values: number[] } };
    return data.embedding.values;
  }
}

export class GeminiGenerationProvider implements GenerationProvider {
  readonly name = 'gemini';
  readonly model = `gemini/${GEMINI_GENERATE_MODEL}`;

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const startTime = Date.now();
    const apiKey = getApiKey();

    const body: Record<string, unknown> = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: options?.temperature ?? 0.3,
        maxOutputTokens: options?.maxTokens ?? 1000,
      },
    };

    if (options?.format === 'json') {
      const genConfig = body['generationConfig'] as Record<string, unknown>;
      genConfig['responseMimeType'] = 'application/json';
    }

    let response: Response;
    try {
      response = await fetch(`${GEMINI_GENERATE_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      logLLMCall({
        module: 'gemini',
        model: this.model,
        latencyMs: Date.now() - startTime,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
      throw err;
    }

    if (!response.ok) {
      const errorBody = await response.text();
      logLLMCall({
        module: 'gemini',
        model: this.model,
        latencyMs: Date.now() - startTime,
        status: 'error',
        errorMessage: `API error ${response.status}: ${errorBody.slice(0, 200)}`,
      }).catch(() => {});
      throw new Error(`Gemini generation API error ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      logLLMCall({
        module: 'gemini',
        model: this.model,
        inputTokens: data.usageMetadata?.promptTokenCount,
        outputTokens: data.usageMetadata?.candidatesTokenCount,
        latencyMs: Date.now() - startTime,
        status: 'error',
        errorMessage: 'Empty response returned',
      }).catch(() => {});
      throw new Error('Gemini returned empty response');
    }

    // Fire-and-forget cost log
    logLLMCall({
      module: 'gemini',
      model: this.model,
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
      latencyMs: Date.now() - startTime,
      status: 'success',
    }).catch(() => {});

    return text;
  }
}
