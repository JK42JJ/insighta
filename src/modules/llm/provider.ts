/**
 * LLM Provider Interfaces
 *
 * Abstraction layer for embedding and generation providers.
 * Supports Gemini (cloud) and Ollama (local) backends.
 * Issue: #251 (MA-2: GraphDB Service Layer)
 */

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  readonly dimension: number;
  readonly name: string;
}

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
  format?: 'json' | 'text';
  /**
   * External AbortSignal — when fired, the in-flight request is cancelled.
   * Used by race-fallback patterns to discard losers without waiting for them.
   */
  signal?: AbortSignal;
}

export interface GenerationProvider {
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
  readonly name: string;
  /** Full model identifier for provenance tracking (e.g., "ollama/qwen3.5:9b") */
  readonly model: string;
}
