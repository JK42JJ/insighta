/**
 * Summarization Module Types
 *
 * Data structures for AI-powered video summarization
 */

/**
 * Summarization level
 */
export type SummarizationLevel = 'short' | 'medium' | 'detailed';

/**
 * Summary metadata
 */
export interface VideoSummary {
  videoId: string;
  level: SummarizationLevel;
  summary: string;
  keyPoints: string[];
  keywords: string[];
  timestamps?: KeyTimestamp[];
}

/**
 * Key timestamp in video
 */
export interface KeyTimestamp {
  time: number; // in seconds
  description: string;
}

/**
 * Summarization options
 */
export interface SummarizationOptions {
  level?: SummarizationLevel;
  language?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Summarization result
 */
export interface SummarizationResult {
  success: boolean;
  videoId: string;
  summary?: VideoSummary;
  error?: string;
}

/**
 * AI Provider configuration
 */
export type AIProvider = 'openai' | 'anthropic' | 'local';

export interface AIConfig {
  provider: AIProvider;
  apiKey?: string;
  model?: string;
  baseUrl?: string; // For local LLMs
}
