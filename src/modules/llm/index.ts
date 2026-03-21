/**
 * LLM Module — Provider Factory
 *
 * Creates embedding and generation providers based on LLM_PROVIDER config.
 * - 'auto': Try Ollama health check → fallback to Gemini
 * - 'gemini': Always Gemini
 * - 'ollama': Always Ollama
 *
 * Issue: #251 (MA-2: GraphDB Service Layer)
 */

import type { EmbeddingProvider, GenerationProvider } from './provider';
import { GeminiEmbeddingProvider, GeminiGenerationProvider } from './gemini';
import { OllamaEmbeddingProvider, OllamaGenerationProvider, isOllamaAvailable } from './ollama';
import { OpenRouterGenerationProvider } from './openrouter';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export type { EmbeddingProvider, GenerationProvider, GenerateOptions } from './provider';

let cachedEmbeddingProvider: EmbeddingProvider | null = null;
let cachedGenerationProvider: GenerationProvider | null = null;

/**
 * Create an embedding provider based on LLM_PROVIDER config.
 * Caches the result after first resolution.
 */
export async function createEmbeddingProvider(): Promise<EmbeddingProvider> {
  if (cachedEmbeddingProvider) {
    return cachedEmbeddingProvider;
  }

  const provider = config.llm.provider;

  if (provider === 'gemini') {
    cachedEmbeddingProvider = new GeminiEmbeddingProvider();
    logger.info('Embedding provider: Gemini (explicit)');
    return cachedEmbeddingProvider;
  }

  if (provider === 'ollama') {
    cachedEmbeddingProvider = new OllamaEmbeddingProvider();
    logger.info('Embedding provider: Ollama (explicit)');
    return cachedEmbeddingProvider;
  }

  // auto: try Ollama first
  if (await isOllamaAvailable()) {
    cachedEmbeddingProvider = new OllamaEmbeddingProvider();
    logger.info('Embedding provider: Ollama (auto-detected)');
    return cachedEmbeddingProvider;
  }

  cachedEmbeddingProvider = new GeminiEmbeddingProvider();
  logger.info('Embedding provider: Gemini (Ollama unavailable, fallback)');
  return cachedEmbeddingProvider;
}

/**
 * Create a generation provider based on LLM_PROVIDER config.
 * Caches the result after first resolution.
 */
export async function createGenerationProvider(): Promise<GenerationProvider> {
  if (cachedGenerationProvider) {
    return cachedGenerationProvider;
  }

  const provider = config.llm.provider;

  if (provider === 'gemini') {
    cachedGenerationProvider = new GeminiGenerationProvider();
    logger.info('Generation provider: Gemini (explicit)');
    return cachedGenerationProvider;
  }

  if (provider === 'ollama') {
    cachedGenerationProvider = new OllamaGenerationProvider();
    logger.info('Generation provider: Ollama (explicit)');
    return cachedGenerationProvider;
  }

  if (provider === 'openrouter') {
    cachedGenerationProvider = new OpenRouterGenerationProvider();
    logger.info('Generation provider: OpenRouter (explicit)', { model: config.openrouter.model });
    return cachedGenerationProvider;
  }

  // auto: try Ollama first → OpenRouter (if key exists) → Gemini
  if (await isOllamaAvailable()) {
    cachedGenerationProvider = new OllamaGenerationProvider();
    logger.info('Generation provider: Ollama (auto-detected)');
    return cachedGenerationProvider;
  }

  if (config.openrouter.apiKey) {
    cachedGenerationProvider = new OpenRouterGenerationProvider();
    logger.info('Generation provider: OpenRouter (Ollama unavailable, fallback)', {
      model: config.openrouter.model,
    });
    return cachedGenerationProvider;
  }

  cachedGenerationProvider = new GeminiGenerationProvider();
  logger.info('Generation provider: Gemini (Ollama+OpenRouter unavailable, fallback)');
  return cachedGenerationProvider;
}

/**
 * Reset cached providers (useful for testing or config changes).
 */
export function resetProviders(): void {
  cachedEmbeddingProvider = null;
  cachedGenerationProvider = null;
}
