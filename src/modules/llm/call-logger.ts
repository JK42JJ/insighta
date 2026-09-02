/**
 * LLM Call Logger
 *
 * Fire-and-forget DB logging for every LLM API call.
 * Errors inside this module are caught and logged — they MUST NOT propagate
 * to the caller. A logging failure should never break a user-facing LLM call.
 */

import { getPrismaClient } from '@/modules/database/client';
import { calculateCost } from '@/config/llm-pricing';
import { isCreditExhaustionError, noteCreditExhaustion, noteCreditRecovered } from './cost-gate';
import { isCreditSkipMessage } from './credit-guard';
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
  // A call the breaker refused never reached a provider, so it is not a call.
  // Four sites raise that refusal from inside the try block that writes this
  // row; dropping it here rather than restructuring four call paths keeps
  // `llm_call_logs` a record of calls, which is what every count read off it
  // — the cost gate, the admin panel, the waste audit — assumes it is.
  if (isCreditSkipMessage(entry.errorMessage)) return;

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

    // Every call path reaches this function, which makes it the one place that
    // can notice the provider has stopped accepting work at all. Detecting it
    // here rather than at six call sites means none of them has to know the
    // difference between "try again" and "the account is empty".
    if (entry.status === 'error' && isCreditExhaustionError(entry.errorMessage)) {
      await noteCreditExhaustion(entry.model, entry.module);
    } else if (entry.status === 'success') {
      // A call that went through is the only evidence that credits are back.
      // Cheap when nothing is open: this returns immediately unless the
      // breaker for this provider is currently shut.
      await noteCreditRecovered(entry.model);
    }
  } catch (err) {
    // CRITICAL: logging failure must NOT propagate to the LLM call
    log.error('Failed to log LLM call', {
      module: entry.module,
      model: entry.model,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
