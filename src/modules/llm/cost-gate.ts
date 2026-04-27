/**
 * LLM Cost Gate
 *
 * §1.5 hard stop: blocks individual calls that exceed the per-call USD threshold,
 * warns on calls approaching the threshold, and enforces an optional daily budget.
 *
 * Thresholds are named constants — no magic numbers.
 */

import { getPrismaClient } from '@/modules/database/client';
import { calculateCost } from '@/config/llm-pricing';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'CostGate' });

/** Emit a warn-level log when a single call is estimated above this amount (USD) */
const SINGLE_CALL_WARN_USD = 0.5;

/** Block a single call when its estimated cost exceeds this amount (USD) */
const SINGLE_CALL_BLOCK_USD = 5.0;

export interface SingleCallCheckResult {
  allowed: boolean;
  estimatedCost: number | null;
  warning?: string;
}

export interface DailyCostCheckResult {
  allowed: boolean;
  dailyTotal: number;
  limit: number | null;
}

/**
 * Check whether a single LLM call is within acceptable cost bounds.
 *
 * - Unknown pricing → always allowed (cost_usd will be NULL in the log).
 * - estimatedCost > SINGLE_CALL_BLOCK_USD ($5) → blocked.
 * - estimatedCost > SINGLE_CALL_WARN_USD ($0.5) → allowed with warning.
 *
 * @param model - Full model identifier (provider prefix included)
 * @param estimatedInputTokens - Estimated prompt token count
 * @param estimatedOutputTokens - Estimated completion token count
 */
export function checkSingleCallCost(
  model: string,
  estimatedInputTokens: number,
  estimatedOutputTokens: number
): SingleCallCheckResult {
  const cost = calculateCost(model, estimatedInputTokens, estimatedOutputTokens);

  // Unknown pricing — allow but return null cost
  if (cost === null) {
    return { allowed: true, estimatedCost: null };
  }

  if (cost > SINGLE_CALL_BLOCK_USD) {
    log.error('LLM call BLOCKED — cost exceeds hard limit', {
      model,
      estimatedCost: cost,
      limitUsd: SINGLE_CALL_BLOCK_USD,
      estimatedInputTokens,
      estimatedOutputTokens,
    });
    return {
      allowed: false,
      estimatedCost: cost,
      warning: `Blocked: estimated cost $${cost.toFixed(4)} exceeds $${SINGLE_CALL_BLOCK_USD.toFixed(2)} hard limit`,
    };
  }

  if (cost > SINGLE_CALL_WARN_USD) {
    log.warn('LLM call cost warning — above warn threshold', {
      model,
      estimatedCost: cost,
      warnThresholdUsd: SINGLE_CALL_WARN_USD,
    });
    return {
      allowed: true,
      estimatedCost: cost,
      warning: `Warning: estimated cost $${cost.toFixed(4)} exceeds $${SINGLE_CALL_WARN_USD.toFixed(2)} warn threshold`,
    };
  }

  return { allowed: true, estimatedCost: cost };
}

/**
 * Check whether the daily LLM spend is within the configured budget.
 *
 * Reads the optional LLM_DAILY_COST_LIMIT_USD env var. If the var is not set
 * or is not a valid number, the gate is disabled and always returns allowed.
 *
 * Queries llm_call_logs for today's successful call costs.
 */
export async function checkDailyCostLimit(): Promise<DailyCostCheckResult> {
  const limitStr = process.env['LLM_DAILY_COST_LIMIT_USD'];
  if (!limitStr) {
    return { allowed: true, dailyTotal: 0, limit: null };
  }

  const limit = parseFloat(limitStr);
  if (!Number.isFinite(limit)) {
    return { allowed: true, dailyTotal: 0, limit: null };
  }

  const prisma = getPrismaClient();
  const result = await prisma.$queryRaw<[{ total: number }]>`
    SELECT COALESCE(SUM(cost_usd), 0)::float AS total
    FROM llm_call_logs
    WHERE created_at >= CURRENT_DATE
      AND status = 'success'
  `;

  const dailyTotal = result[0]?.total ?? 0;

  if (dailyTotal >= limit) {
    log.error('Daily LLM cost limit reached — calls will be blocked', {
      dailyTotal,
      limit,
    });
    return { allowed: false, dailyTotal, limit };
  }

  return { allowed: true, dailyTotal, limit };
}
