/**
 * LLM Cost Gate — §1.5 (enhanced, 4/14 incident prevention)
 *
 * Layers:
 *   L1 — Single call:   warn $0.50, block $5.00
 *   L2 — Daily budget:  warn $5, block $10 (LLM_DAILY_COST_LIMIT_USD)
 *   L3 — Monthly budget: alert $30, throttle $50 (LLM_MONTHLY_COST_LIMIT_USD)
 *   L4 — Module concentration: single module > 60% daily → alert
 *   L5 — User rate limit: 100 calls/hour per user_id → throttle
 */

import { config } from '@/config/index';
import { getPrismaClient } from '@/modules/database/client';
import { calculateCost } from '@/config/llm-pricing';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'CostGate' });

// --- L1: Single call thresholds ---
const SINGLE_CALL_WARN_USD = 0.5;
const SINGLE_CALL_BLOCK_USD = 5.0;

// --- L2: Daily aggregate thresholds ---
const DAILY_WARN_USD = 5.0;
const DAILY_BLOCK_USD_DEFAULT = 10.0;

// --- L3: Monthly aggregate thresholds ---
const MONTHLY_ALERT_USD = 30.0;
const MONTHLY_THROTTLE_USD_DEFAULT = 50.0;

// --- L4: Module concentration ---
const MODULE_CONCENTRATION_ALERT_RATIO = 0.6;

// --- L5: User rate limit ---
const USER_RATE_LIMIT_PER_HOUR = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SingleCallCheckResult {
  allowed: boolean;
  estimatedCost: number | null;
  warning?: string;
}

export interface DailyCostCheckResult {
  allowed: boolean;
  dailyTotal: number;
  limit: number;
  warning?: string;
}

export interface MonthlyCostCheckResult {
  allowed: boolean;
  monthlyTotal: number;
  limit: number;
  throttled?: boolean;
  warning?: string;
}

export interface ModuleConcentrationResult {
  alert: boolean;
  topModule: string | null;
  ratio: number;
  warning?: string;
}

export interface UserRateLimitResult {
  allowed: boolean;
  callCount: number;
  limit: number;
  warning?: string;
}

// ---------------------------------------------------------------------------
// L1: Single call gate (sync — no DB)
// ---------------------------------------------------------------------------

export function checkSingleCallCost(
  model: string,
  estimatedInputTokens: number,
  estimatedOutputTokens: number
): SingleCallCheckResult {
  const cost = calculateCost(model, estimatedInputTokens, estimatedOutputTokens);

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

// ---------------------------------------------------------------------------
// L2: Daily aggregate gate
// ---------------------------------------------------------------------------

export async function checkDailyCostLimit(): Promise<DailyCostCheckResult> {
  const limit = config.llm.dailyCostLimitUsd ?? DAILY_BLOCK_USD_DEFAULT;

  const prisma = getPrismaClient();
  const result = await prisma.$queryRaw<[{ total: number }]>`
    SELECT COALESCE(SUM(cost_usd), 0)::float AS total
    FROM llm_call_logs
    WHERE created_at >= CURRENT_DATE
      AND status = 'success'
  `;

  const dailyTotal = result[0]?.total ?? 0;

  if (dailyTotal >= limit) {
    log.error('Daily LLM cost BLOCKED — limit reached', { dailyTotal, limit });
    return {
      allowed: false,
      dailyTotal,
      limit,
      warning: `Blocked: daily spend $${dailyTotal.toFixed(2)} >= $${limit.toFixed(2)} limit`,
    };
  }

  if (dailyTotal >= DAILY_WARN_USD) {
    log.warn('Daily LLM cost warning', { dailyTotal, warnAt: DAILY_WARN_USD, limit });
    return {
      allowed: true,
      dailyTotal,
      limit,
      warning: `Warning: daily spend $${dailyTotal.toFixed(2)} >= $${DAILY_WARN_USD.toFixed(2)} threshold`,
    };
  }

  return { allowed: true, dailyTotal, limit };
}

// ---------------------------------------------------------------------------
// L3: Monthly aggregate gate
// ---------------------------------------------------------------------------

export async function checkMonthlyCostLimit(): Promise<MonthlyCostCheckResult> {
  const limit = config.llm.monthlyCostLimitUsd ?? MONTHLY_THROTTLE_USD_DEFAULT;

  const prisma = getPrismaClient();
  const result = await prisma.$queryRaw<[{ total: number }]>`
    SELECT COALESCE(SUM(cost_usd), 0)::float AS total
    FROM llm_call_logs
    WHERE created_at >= date_trunc('month', CURRENT_DATE)
      AND status = 'success'
  `;

  const monthlyTotal = result[0]?.total ?? 0;

  if (monthlyTotal >= limit) {
    log.error('Monthly LLM cost THROTTLED — essential calls only', { monthlyTotal, limit });
    return {
      allowed: false,
      monthlyTotal,
      limit,
      throttled: true,
      warning: `Throttled: monthly spend $${monthlyTotal.toFixed(2)} >= $${limit.toFixed(2)} limit`,
    };
  }

  if (monthlyTotal >= MONTHLY_ALERT_USD) {
    log.warn('Monthly LLM cost alert', { monthlyTotal, alertAt: MONTHLY_ALERT_USD, limit });
    return {
      allowed: true,
      monthlyTotal,
      limit,
      warning: `Alert: monthly spend $${monthlyTotal.toFixed(2)} >= $${MONTHLY_ALERT_USD.toFixed(2)} threshold`,
    };
  }

  return { allowed: true, monthlyTotal, limit };
}

// ---------------------------------------------------------------------------
// L4: Module concentration alert
// ---------------------------------------------------------------------------

export async function checkModuleConcentration(): Promise<ModuleConcentrationResult> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRaw<{ module: string; total: number; ratio: number }[]>`
    WITH daily AS (
      SELECT module, COALESCE(SUM(cost_usd), 0)::float AS total
      FROM llm_call_logs
      WHERE created_at >= CURRENT_DATE AND status = 'success'
      GROUP BY module
    ),
    grand AS (
      SELECT COALESCE(SUM(total), 0) AS grand_total FROM daily
    )
    SELECT d.module, d.total,
           CASE WHEN g.grand_total > 0 THEN d.total / g.grand_total ELSE 0 END AS ratio
    FROM daily d, grand g
    ORDER BY d.total DESC
    LIMIT 1
  `;

  const top = rows[0];
  if (!top || top.ratio < MODULE_CONCENTRATION_ALERT_RATIO) {
    return { alert: false, topModule: top?.module ?? null, ratio: top?.ratio ?? 0 };
  }

  log.warn('Module concentration alert — single module dominates daily cost', {
    module: top.module,
    ratio: top.ratio,
    total: top.total,
  });

  return {
    alert: true,
    topModule: top.module,
    ratio: top.ratio,
    warning: `Alert: module "${top.module}" uses ${(top.ratio * 100).toFixed(0)}% of daily cost`,
  };
}

// ---------------------------------------------------------------------------
// L5: User rate limit
// ---------------------------------------------------------------------------

export async function checkUserRateLimit(userId: string | null): Promise<UserRateLimitResult> {
  if (!userId) {
    return { allowed: true, callCount: 0, limit: USER_RATE_LIMIT_PER_HOUR };
  }

  const prisma = getPrismaClient();
  const result = await prisma.$queryRaw<[{ cnt: number }]>`
    SELECT COUNT(*)::int AS cnt
    FROM llm_call_logs
    WHERE created_at >= NOW() - INTERVAL '1 hour'
      AND module LIKE ${'%' + userId + '%'}
  `;

  const callCount = result[0]?.cnt ?? 0;

  if (callCount >= USER_RATE_LIMIT_PER_HOUR) {
    log.warn('User rate limit exceeded — throttling', { userId, callCount });
    return {
      allowed: false,
      callCount,
      limit: USER_RATE_LIMIT_PER_HOUR,
      warning: `Throttled: user ${userId} made ${callCount} calls in last hour (limit: ${USER_RATE_LIMIT_PER_HOUR})`,
    };
  }

  return { allowed: true, callCount, limit: USER_RATE_LIMIT_PER_HOUR };
}

// ---------------------------------------------------------------------------
// L6: Provider credit exhaustion
// ---------------------------------------------------------------------------
//
// L1-L5 defend against spending too much. This one defends against the state
// after the money is gone, which behaves differently: the provider answers 402
// to everything, instantly and for days, and every call site treats that as one
// more transient failure. On 2026-08-30 that produced forty-odd identical
// failures inside a single minute, none of which could have succeeded.
//
// Nothing here blocks a call on its own. It records the state, so the callers
// that should stop can ask, and so an operator learns from a dashboard rather
// than from an invoice.

/** Credit exhaustion is a standing state, not a blip. Re-probe after this. */
const CREDIT_COOLDOWN_MS = 15 * 60 * 1000;

interface CreditState {
  /** When the provider last answered 402. */
  since: Date;
  /** Consecutive 402s observed since the state was entered. */
  hits: number;
  /** Module that saw the most recent one — the first place a user notices. */
  lastModule: string;
}

const creditState = new Map<string, CreditState>();

/** Provider key from a logged model id (`openrouter/anthropic/...`). */
function providerOf(model: string): string {
  const slash = model.indexOf('/');
  return slash > 0 ? model.slice(0, slash) : model;
}

/**
 * Does an error from a provider mean "no credits" rather than "try again"?
 *
 * Matched on the message because the call sites record a string, not a status:
 * they each shape their own error text, and rewriting six of them to carry a
 * structured code would be a larger change than this needs to be.
 */
export function isCreditExhaustionError(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('402') ||
    m.includes('insufficient credit') ||
    m.includes('insufficient_quota') ||
    m.includes('quota exceeded') ||
    m.includes('exceeded your current quota')
  );
}

/**
 * Record that a provider answered with credit exhaustion. Called from the
 * ledger writer, which every call path now reaches, so this sees all of them
 * without any call site knowing it exists.
 */
export function noteCreditExhaustion(model: string, module: string): void {
  const provider = providerOf(model);
  const prev = creditState.get(provider);
  const first = !prev || Date.now() - prev.since.getTime() > CREDIT_COOLDOWN_MS;

  creditState.set(provider, {
    since: first ? new Date() : prev.since,
    hits: first ? 1 : prev.hits + 1,
    lastModule: module,
  });

  // Loud once, quiet after. A thousand identical alerts is the same as none.
  if (first) {
    log.error('LLM provider is out of credits — calls will fail until topped up', {
      provider,
      module,
    });
  }
}

export interface CreditStatus {
  provider: string;
  outOfCredits: boolean;
  since: string;
  hits: number;
  lastModule: string;
}

/**
 * Providers currently believed to be out of credits. Empty is the healthy
 * answer. Entries older than the cooldown are dropped on read rather than on a
 * timer, so nothing has to be scheduled to keep this honest.
 */
export function getCreditStatus(): CreditStatus[] {
  const now = Date.now();
  const out: CreditStatus[] = [];
  for (const [provider, s] of creditState) {
    if (now - s.since.getTime() > CREDIT_COOLDOWN_MS) {
      creditState.delete(provider);
      continue;
    }
    out.push({
      provider,
      outOfCredits: true,
      since: s.since.toISOString(),
      hits: s.hits,
      lastModule: s.lastModule,
    });
  }
  return out;
}

/** Test seam — the state is module-level and would otherwise leak between cases. */
export function resetCreditStateForTest(): void {
  creditState.clear();
}
