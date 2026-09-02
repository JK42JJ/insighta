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
// L6: Provider credit exhaustion — the breaker
// ---------------------------------------------------------------------------
//
// L1-L5 defend against spending too much. This one defends against the state
// after the money is gone, which behaves differently: the provider answers 402
// to everything, instantly and for days, and every call site reads that as one
// more transient failure. On 2026-08-30 that produced 163 identical failures
// inside one minute, and on 09-01 three scheduler windows each fired the same
// 18 doomed calls — 54 in a day, none of which could have succeeded.
//
// The first version of this recorded the state and blocked nothing, which left
// that behaviour exactly as it was. It also held the state in a module-level
// Map, so with two API pods a 402 seen by one was invisible to the other and a
// restart erased it. Both are fixed here: the state lives in Postgres, and
// `checkProviderCredit` is a gate the call sites pass through.
//
// Shape: closed → open on a 402 → one probe allowed every ten minutes → closed
// again when a probe succeeds. A breaker with no probe never closes, and one
// that lets everything probe is not a breaker.

import type { CreditGateDecision } from './credit-types';

/** How long the breaker stays shut before letting one call through to test. */
const CREDIT_PROBE_INTERVAL_MS = 10 * 60 * 1000;

/**
 * How long a provider's state is trusted without re-reading it.
 *
 * A batch fires its calls within a minute or two, so one read covers the whole
 * burst. Long enough to stop a query per call, short enough that a top-up made
 * in the admin screen is picked up promptly.
 */
const CREDIT_CACHE_TTL_MS = 30 * 1000;

interface CachedCredit {
  exhausted: boolean;
  /** Epoch ms. Only meaningful when `exhausted`. */
  nextProbeAt: number;
  since: Date | null;
  hits: number;
  lastModule: string | null;
  readAt: number;
}

const creditCache = new Map<string, CachedCredit>();

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
 * Should this call be made at all?
 *
 * Call sites ask before spending a round trip. `allowed: false` means the
 * provider is known to be refusing for want of credits and this call would
 * certainly fail; what to do about that is the call site's decision, because
 * skipping a reranker and skipping a chat reply are not the same thing.
 *
 * Fails open. A breaker that cannot read its own state must not be the reason
 * a working provider goes unused, so any error here allows the call and says
 * so in the log.
 */
export async function checkProviderCredit(model: string): Promise<CreditGateDecision> {
  const provider = providerOf(model);
  if (!config.creditBreaker.enabled) return { allowed: true, provider };
  const now = Date.now();

  const cached = creditCache.get(provider);
  if (cached && now - cached.readAt < CREDIT_CACHE_TTL_MS) {
    if (!cached.exhausted) return { allowed: true, provider };
    // Still shut, and the probe is not due — refuse without touching the DB.
    if (now < cached.nextProbeAt) {
      return {
        allowed: false,
        provider,
        reason: 'credit_exhausted',
        since: cached.since,
        hits: cached.hits,
      };
    }
    // Probe due. Fall through: claiming it has to be atomic across pods.
  }

  try {
    const prisma = getPrismaClient();
    const rows = await prisma.$queryRaw<
      { exhausted_at: Date; hits: number; last_module: string | null; next_probe_at: Date }[]
    >`
      SELECT exhausted_at, hits, last_module, next_probe_at
        FROM llm_provider_credit_state
       WHERE provider = ${provider} AND cleared_at IS NULL
    `;

    if (rows.length === 0) {
      creditCache.set(provider, {
        exhausted: false,
        nextProbeAt: 0,
        since: null,
        hits: 0,
        lastModule: null,
        readAt: now,
      });
      return { allowed: true, provider };
    }

    const row = rows[0];
    if (!row) return { allowed: true, provider };
    creditCache.set(provider, {
      exhausted: true,
      nextProbeAt: row.next_probe_at.getTime(),
      since: row.exhausted_at,
      hits: row.hits,
      lastModule: row.last_module,
      readAt: now,
    });

    if (row.next_probe_at.getTime() > now) {
      return {
        allowed: false,
        provider,
        reason: 'credit_exhausted',
        since: row.exhausted_at,
        hits: row.hits,
      };
    }

    // Probe is due. Exactly one caller may take it: the WHERE clause is the
    // lock, so of N concurrent callers the other N-1 update zero rows.
    const claimed = await prisma.$executeRaw`
      UPDATE llm_provider_credit_state
         SET next_probe_at = now() + make_interval(secs => ${CREDIT_PROBE_INTERVAL_MS / 1000}),
             updated_at = now()
       WHERE provider = ${provider}
         AND cleared_at IS NULL
         AND next_probe_at <= now()
    `;

    if (claimed === 1) {
      log.info('LLM credit breaker: probing whether the provider is back', {
        provider,
        outFor: `${Math.round((now - row.exhausted_at.getTime()) / 60000)}m`,
      });
      creditCache.set(provider, {
        exhausted: true,
        nextProbeAt: now + CREDIT_PROBE_INTERVAL_MS,
        since: row.exhausted_at,
        hits: row.hits,
        lastModule: row.last_module,
        readAt: now,
      });
      return { allowed: true, provider, isProbe: true };
    }

    return {
      allowed: false,
      provider,
      reason: 'credit_exhausted',
      since: row.exhausted_at,
      hits: row.hits,
    };
  } catch (err) {
    log.warn('LLM credit breaker could not read its state — allowing the call', {
      provider,
      error: err instanceof Error ? err.message : String(err),
    });
    return { allowed: true, provider };
  }
}

/**
 * Record that a provider answered with credit exhaustion.
 *
 * Called from the ledger writer, which every call path reaches, so this sees
 * all of them without any call site knowing it exists. Writing here rather
 * than at the call sites is also what makes the count honest: `hits` is every
 * refusal, including the ones from paths added later.
 */
const CREDIT_NOTE_DEDUPE_MS = 5 * 1000;
const lastNoted = new Map<string, number>();

export async function noteCreditExhaustion(model: string, module: string): Promise<void> {
  const provider = providerOf(model);
  const wasOpen = creditCache.get(provider)?.exhausted === true;

  if (!config.creditBreaker.enabled) return;

  // One HTTP refusal, one increment. Two detectors reach this — the call site
  // and the ledger writer — and without this `hits` would count detectors.
  const last = lastNoted.get(provider) ?? 0;
  if (Date.now() - last < CREDIT_NOTE_DEDUPE_MS) return;
  lastNoted.set(provider, Date.now());

  try {
    await getPrismaClient().$executeRaw`
      INSERT INTO llm_provider_credit_state
             (provider, exhausted_at, hits, last_module, next_probe_at, cleared_at, updated_at)
      VALUES (${provider}, now(), 1, ${module},
              now() + make_interval(secs => ${CREDIT_PROBE_INTERVAL_MS / 1000}), NULL, now())
      ON CONFLICT (provider) DO UPDATE SET
        -- A refusal during an open spell continues it; one after a recovery
        -- starts a new spell, so the timestamp answers "since when" correctly.
        exhausted_at = CASE WHEN llm_provider_credit_state.cleared_at IS NULL
                            THEN llm_provider_credit_state.exhausted_at ELSE now() END,
        hits         = CASE WHEN llm_provider_credit_state.cleared_at IS NULL
                            THEN llm_provider_credit_state.hits + 1 ELSE 1 END,
        last_module  = ${module},
        next_probe_at = now() + make_interval(secs => ${CREDIT_PROBE_INTERVAL_MS / 1000}),
        cleared_at   = NULL,
        updated_at   = now()
    `;
  } catch (err) {
    log.error('LLM credit breaker could not record exhaustion', {
      provider,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  creditCache.set(provider, {
    exhausted: true,
    nextProbeAt: Date.now() + CREDIT_PROBE_INTERVAL_MS,
    since: new Date(),
    hits: (creditCache.get(provider)?.hits ?? 0) + 1,
    lastModule: module,
    readAt: Date.now(),
  });

  // Loud on the way in, quiet after. A thousand identical alerts is the same
  // as none, and the breaker now means there will not be a thousand.
  if (!wasOpen) {
    log.error('LLM provider is out of credits — calls are now blocked until it recovers', {
      provider,
      module,
      probeEvery: `${CREDIT_PROBE_INTERVAL_MS / 60000}m`,
    });
  }
}

/**
 * A call succeeded, so the provider is taking work again.
 *
 * A successful call is the only evidence allowed to close the breaker. Nothing
 * expires on a timer: an account that is empty on Friday is still empty on
 * Monday, and a breaker that reopens itself on the clock is how the 54-calls-a-
 * day pattern survived a cooldown in the first place.
 *
 * Guarded by the local cache so the ordinary path — provider healthy, nothing
 * to clear — costs nothing.
 */
export async function noteCreditRecovered(
  model: string,
  opts: { force?: boolean } = {}
): Promise<void> {
  const provider = providerOf(model);
  // The guard is an optimisation for the hot path, and it reads this pod's
  // cache. An operator action — the admin balance check — has to clear the
  // row whichever pod it lands on, including one whose cache is cold, so it
  // passes `force`. Other pods pick the change up when their own 30-second
  // cache next expires.
  if (!opts.force && creditCache.get(provider)?.exhausted !== true) return;

  try {
    await getPrismaClient().$executeRaw`
      UPDATE llm_provider_credit_state
         SET cleared_at = now(), updated_at = now()
       WHERE provider = ${provider} AND cleared_at IS NULL
    `;
    creditCache.set(provider, {
      exhausted: false,
      nextProbeAt: 0,
      since: null,
      hits: 0,
      lastModule: null,
      readAt: Date.now(),
    });
    log.info('LLM provider is answering again — breaker closed', { provider });
  } catch (err) {
    log.error('LLM credit breaker could not record recovery', {
      provider,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface CreditStatus {
  provider: string;
  outOfCredits: boolean;
  since: string;
  hits: number;
  lastModule: string | null;
  nextProbeAt: string;
}

/**
 * Providers currently refusing for want of credits. Empty is the healthy
 * answer; a non-empty list means every feature behind that provider is
 * degraded right now.
 */
export async function getCreditStatus(): Promise<CreditStatus[]> {
  try {
    const rows = await getPrismaClient().$queryRaw<
      {
        provider: string;
        exhausted_at: Date;
        hits: number;
        last_module: string | null;
        next_probe_at: Date;
      }[]
    >`
      SELECT provider, exhausted_at, hits, last_module, next_probe_at
        FROM llm_provider_credit_state
       WHERE cleared_at IS NULL
       ORDER BY exhausted_at
    `;
    return rows.map((r) => ({
      provider: r.provider,
      outOfCredits: true,
      since: r.exhausted_at.toISOString(),
      hits: r.hits,
      lastModule: r.last_module,
      nextProbeAt: r.next_probe_at.toISOString(),
    }));
  } catch (err) {
    log.error('LLM credit status unavailable', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * The breaker's answer without awaiting anything.
 *
 * The chat route pauses the request stream and can afford exactly one async
 * hop before the body is lost — PR #737 and the first CP477+15 ship both
 * returned 400 "Invalid JSON payload" by adding a second. So that route reads
 * the cache instead of the table.
 *
 * `null` means "no cached opinion, let the call through". A cold cache
 * therefore costs one real 402, after which the ledger writer fills the cache
 * and every later request is refused without a round trip.
 */
export function creditBlockedFromCache(provider: string): CreditGateDecision | null {
  if (!config.creditBreaker.enabled) return null;
  const c = creditCache.get(provider);
  if (!c || !c.exhausted) return null;
  if (Date.now() >= c.nextProbeAt) return null; // a probe is due — let it try
  return {
    allowed: false,
    provider,
    reason: 'credit_exhausted',
    since: c.since,
    hits: c.hits,
  };
}

/** Test seam — the cache is module-level and would otherwise leak between cases. */
export function resetCreditStateForTest(): void {
  creditCache.clear();
  lastNoted.clear();
}
