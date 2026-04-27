/**
 * LLM Call Logger
 *
 * Fire-and-forget DB logging for every LLM API call.
 * Errors inside this module are caught and logged — they MUST NOT propagate
 * to the caller. A logging failure should never break a user-facing LLM call.
 */

import { getPrismaClient } from '@/modules/database/client';
import { calculateCost } from '@/config/llm-pricing';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'LLMCallLogger' });

export interface LLMCallLogEntry {
  /** Source module or skill (e.g., 'openrouter', 'rich_summary', 'mandala') */
  module: string;
  /** Full model identifier including provider prefix (e.g., 'openrouter/qwen/qwen3-30b-a3b') */
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  status: 'success' | 'error' | 'blocked';
  errorMessage?: string;
  /** Optional: user UUID for per-user cost attribution */
  userId?: string;
  /** Optional: YouTube video ID for per-video cost attribution */
  videoId?: string;
}

/**
 * Log an LLM call to the llm_call_logs table.
 *
 * This function is safe to call without awaiting — it swallows all errors
 * internally. Use `.catch(() => {})` at the call site for fire-and-forget.
 *
 * @param entry - Call metadata to persist
 */
export async function logLLMCall(entry: LLMCallLogEntry): Promise<void> {
  try {
    const prisma = getPrismaClient();

    const costUsd =
      entry.inputTokens != null && entry.outputTokens != null
        ? calculateCost(entry.model, entry.inputTokens, entry.outputTokens)
        : null;

    await prisma.llm_call_logs.create({
      data: {
        module: entry.module,
        model: entry.model,
        input_tokens: entry.inputTokens ?? null,
        output_tokens: entry.outputTokens ?? null,
        cost_usd: costUsd,
        latency_ms: entry.latencyMs ?? null,
        status: entry.status,
        error_message: entry.errorMessage ?? null,
        user_id: entry.userId ?? null,
        video_id: entry.videoId ?? null,
      },
    });
  } catch (err) {
    // CRITICAL: logging failure must NOT propagate to the LLM call
    log.error('Failed to log LLM call', {
      module: entry.module,
      model: entry.model,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
