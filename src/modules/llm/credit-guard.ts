/**
 * The call sites' door onto the credit breaker.
 *
 * Two reasons this is not just `checkProviderCredit` imported directly:
 *
 * 1. `cost-gate` pulls Prisma in through `database/client`, and four of the
 *    six call sites are unit-tested with an injected fetch and no database.
 *    A static import there fails at module load. The dynamic import keeps the
 *    dependency at call time, where it can be caught.
 * 2. It fails open, in one place. If the breaker cannot be reached the call
 *    goes ahead: a breaker that cannot read its own state must never be the
 *    reason a working provider sits unused.
 */

import type { CreditGateDecision } from './credit-types';

/**
 * May this model be called right now?
 *
 * `model` is the same string the site logs — `openrouter/anthropic/claude-...`
 * — so the provider the breaker keys on is the provider the ledger records.
 *
 * Two layers answer, in this order:
 *
 *   L6, the credit breaker — the provider is out of money and would refuse.
 *   L2, the daily budget   — the provider would answer, and that is the point.
 *
 * Credit is asked first because it is the more specific fact: if the account
 * is empty, saying "over budget" would describe a spend that cannot happen.
 *
 * Nine call sites read this one decision, so wiring L2 here is what put it in
 * front of every one of them without editing any. That mattered: L2 has been
 * written and unwired since the 4/14 incident, and 2026-06-25 spent $36.18 in
 * a day through calls that all succeeded — nothing L6 can see.
 */
export async function creditGate(model: string): Promise<CreditGateDecision> {
  const slash = model.indexOf('/');
  const provider = slash > 0 ? model.slice(0, slash) : model;
  try {
    const { checkProviderCredit, checkSpendCaps } = await import('./cost-gate');

    const credit = await checkProviderCredit(model);
    if (!credit.allowed) return credit;

    const caps = await checkSpendCaps();
    if (!caps.allowed) {
      const monthly = caps.scope === 'monthly';
      return {
        allowed: false,
        provider,
        reason: monthly ? 'monthly_cap' : 'daily_budget',
        spendUsd: monthly ? caps.monthlyTotal : caps.dailyTotal,
        limitUsd: monthly ? caps.monthlyLimit : caps.dailyLimit,
      };
    }
    return credit;
  } catch {
    return { allowed: true, provider };
  }
}

/**
 * What the site says when it refuses.
 *
 * Deliberately free of "402", "insufficient credit" and the other phrases
 * `isCreditExhaustionError` matches. If a skip message were mistaken for a
 * real refusal, recording it would push the probe deadline forward and the
 * breaker would never get to test for recovery — it would latch shut.
 */
const SKIP_MARKER = 'is refusing new work (breaker open since';
const BUDGET_MARKER = 'has spent its';

export function creditBlockMessage(d: CreditGateDecision): string {
  if (d.reason === 'daily_budget' || d.reason === 'monthly_cap') {
    const window = d.reason === 'monthly_cap' ? 'monthly allowance' : 'daily allowance';
    const spent = (d.spendUsd ?? 0).toFixed(2);
    const limit = (d.limitUsd ?? 0).toFixed(2);
    return (
      `provider ${d.provider} ${BUDGET_MARKER} ${window} ` +
      `($${spent} of $${limit}) — call not attempted`
    );
  }
  const since = d.since ? d.since.toISOString() : 'recently';
  return (
    `provider ${d.provider} ${SKIP_MARKER} ${since}, ${d.hits ?? 0} refusals) ` +
    `— call not attempted`
  );
}

/**
 * Was this error a gate refusing, rather than a provider?
 *
 * Four call sites raise the refusal from inside the try block that writes
 * their ledger row, so the row would say a call failed when no call was made.
 * `llm_call_logs` is a record of calls; the breaker table is the record of the
 * outage. The ledger writer drops these on the way in.
 */
export function isCreditSkipMessage(message: string | undefined): boolean {
  if (!message) return false;
  return message.includes(SKIP_MARKER) || message.includes(BUDGET_MARKER);
}

/**
 * Record a refusal now, not on the next tick.
 *
 * The ledger writer already detects credit exhaustion, but the call sites
 * invoke it fire-and-forget (`void import(...)`) so the state can land after
 * the caller has already started its next chunk. A loop of eighteen chunks
 * would then make several calls before the breaker shut — "usually stops"
 * rather than "stops". Awaiting this on the error branch closes that window:
 * by the time the next iteration asks the gate, the answer is in.
 *
 * A no-op unless the message really is a credit refusal, and deduplicated
 * against the ledger writer's own detection.
 */
export async function noteCreditRefusal(
  model: string,
  module: string,
  message: string
): Promise<void> {
  try {
    const { isCreditExhaustionError, noteCreditExhaustion } = await import('./cost-gate');
    if (!isCreditExhaustionError(message)) return;
    await noteCreditExhaustion(model, module);
  } catch {
    // The breaker is an optimisation. Never let it break the call path.
  }
}
