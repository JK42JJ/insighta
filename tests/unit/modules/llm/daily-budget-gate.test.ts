/**
 * The daily budget gate (cost-gate L2), now that something calls it.
 *
 * L1 through L5 were written after the 2026-04-14 incident and shipped with
 * zero callers. Only L6 was wired, and L6 answers a different question: it
 * fires when the provider returns 402, which is to say after the money is
 * gone. On 2026-06-25 this account spent $36.18 in one day across calls that
 * every one of them succeeded — nothing L6 can see, and nothing that would
 * have stopped it.
 *
 * These pin what wiring L2 has to mean:
 *
 *   - under the ceiling the call goes through, and the ledger is not queried
 *     once per call
 *   - at the ceiling every call site refuses, because they share one door
 *   - the refusal is not mistaken for a provider 402, which would latch the
 *     credit breaker shut on a day the provider was working fine
 *   - a ledger that cannot be read allows the call, rather than stopping work
 *   - credit exhaustion still wins, because "will fail" is more specific than
 *     "must not"
 */

const mockQueryRaw = jest.fn();
const mockExecuteRaw = jest.fn();

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({ $queryRaw: mockQueryRaw, $executeRaw: mockExecuteRaw }),
}));

jest.mock('@/config/index', () => ({
  config: {
    // L6 off: these cases are about the budget layer, and a breaker reading
    // the same mocked client would answer for it.
    creditBreaker: { enabled: false },
    llm: { budgetGateEnabled: true, dailyCostLimitUsd: 10, monthlyCostLimitUsd: 50 },
  },
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  },
}));

import {
  checkSpendCaps,
  creditBlockedFromCache,
  resetBudgetStateForTest,
  resetCreditStateForTest,
} from '@/modules/llm/cost-gate';
import { creditGate, creditBlockMessage, isCreditSkipMessage } from '@/modules/llm/credit-guard';

const MODEL = 'openrouter/anthropic/claude-haiku-4.5';

/** The ledger answers with today's successful spend. */
function spent(daily: number, monthly = daily) {
  mockQueryRaw.mockResolvedValue([{ daily, monthly }]);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetBudgetStateForTest();
  resetCreditStateForTest();
});

describe('L2 — under the ceiling', () => {
  it('allows the call', async () => {
    spent(2.5);
    const d = await checkSpendCaps();
    expect(d.allowed).toBe(true);
    expect(d.dailyTotal).toBe(2.5);
    expect(d.dailyLimit).toBe(10);
    expect(d.monthlyLimit).toBe(50);
  });

  it('does not query the ledger once per call', async () => {
    spent(1);
    await checkSpendCaps();
    await checkSpendCaps();
    await checkSpendCaps();
    // A SUM() in front of every LLM call is the reason this is cached at all.
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('the shared gate lets it through', async () => {
    spent(1);
    const d = await creditGate(MODEL);
    expect(d.allowed).toBe(true);
  });
});

describe('L2 — at the ceiling', () => {
  it('refuses at exactly the limit, not just past it', async () => {
    spent(10);
    const d = await checkSpendCaps();
    expect(d.allowed).toBe(false);
  });

  it('refuses through the shared gate, which is what the call sites read', async () => {
    spent(12.34);
    const d = await creditGate(MODEL);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('daily_budget');
    expect(d.spendUsd).toBe(12.34);
    expect(d.limitUsd).toBe(10);
  });

  it('says what was spent, so the log is actionable', async () => {
    spent(12.34);
    const msg = creditBlockMessage(await creditGate(MODEL));
    expect(msg).toContain('$12.34');
    expect(msg).toContain('$10.00');
    expect(msg).toContain('call not attempted');
  });

  it('tightens the cache once past the warning line', async () => {
    // Below the warn threshold a stale reading costs nothing. Above it,
    // staleness is exactly how far a burst overshoots the ceiling.
    spent(7);
    await checkSpendCaps();
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    await checkSpendCaps();
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    jest.spyOn(Date, 'now').mockRestore();
  });
});

describe('L2 — its refusal is not a provider 402', () => {
  it('is recognised as a skip, so no ledger row is written for it', async () => {
    spent(11);
    const msg = creditBlockMessage(await creditGate(MODEL));
    expect(isCreditSkipMessage(msg)).toBe(true);
  });

  it('carries none of the phrases that open the credit breaker', async () => {
    spent(11);
    const msg = creditBlockMessage(await creditGate(MODEL));
    // Latching the breaker on a budget refusal would stop a working provider
    // for ten minutes at a time on a day nothing was wrong with it.
    for (const phrase of ['402', 'insufficient', 'credit', 'quota']) {
      expect(msg.toLowerCase()).not.toContain(phrase);
    }
  });
});

describe('L2 — failure modes', () => {
  it('allows the call when the ledger cannot be read', async () => {
    mockQueryRaw.mockRejectedValue(new Error('connection refused'));
    const d = await checkSpendCaps();
    expect(d.allowed).toBe(true);
  });
});

describe('L2 — the chat route reads the same ceiling', () => {
  it('is not refused on a cold cache', () => {
    // Chat cannot await: a second async hop past req.pause() loses the body.
    // Nothing read yet means nothing to refuse on.
    expect(creditBlockedFromCache('openrouter')).toBeNull();
  });

  it('is refused once background work has seen the ceiling', async () => {
    spent(11);
    await checkSpendCaps();
    const d = creditBlockedFromCache('openrouter');
    expect(d?.allowed).toBe(false);
    expect(d?.reason).toBe('daily_budget');
  });

  it('is not refused while the day is still under budget', async () => {
    spent(3);
    await checkSpendCaps();
    expect(creditBlockedFromCache('openrouter')).toBeNull();
  });
});

describe('L3 — the monthly cap', () => {
  it('refuses at the monthly ceiling even on a quiet day', async () => {
    // $2 spent today, $50 this month. The day is fine; the month is not.
    spent(2, 50);
    const d = await checkSpendCaps();
    expect(d.allowed).toBe(false);
    expect(d.scope).toBe('monthly');
  });

  it('reports the month, not the day, when the month is what stopped it', async () => {
    spent(2, 51.5);
    const d = await creditGate(MODEL);
    expect(d.reason).toBe('monthly_cap');
    // A daily figure here would describe the wrong ceiling to whoever reads
    // the log, and the two numbers differ by an order of magnitude.
    expect(d.spendUsd).toBe(51.5);
    expect(d.limitUsd).toBe(50);
    expect(creditBlockMessage(d)).toContain('monthly allowance');
  });

  it('is checked before the day, because a month cannot be waited out', async () => {
    // Both over. Tomorrow clears the day; nothing clears the month.
    spent(11, 60);
    expect((await checkSpendCaps()).scope).toBe('monthly');
  });

  it('answers both windows from one query', async () => {
    spent(3, 20);
    await checkSpendCaps();
    // The day is a subset of the month; two SUMs would double the load for a
    // number contained in the other.
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('tightens the cache once past the monthly alert line', async () => {
    spent(0.5, 35);
    await checkSpendCaps();
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    await checkSpendCaps();
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    jest.spyOn(Date, 'now').mockRestore();
  });

  it('refuses the chat route on the monthly cap too', async () => {
    spent(1, 55);
    await checkSpendCaps();
    const d = creditBlockedFromCache('openrouter');
    expect(d?.reason).toBe('monthly_cap');
  });

  it('its refusal is a skip, and opens no breaker', async () => {
    spent(1, 55);
    const msg = creditBlockMessage(await creditGate(MODEL));
    expect(isCreditSkipMessage(msg)).toBe(true);
    for (const phrase of ['402', 'insufficient', 'credit', 'quota']) {
      expect(msg.toLowerCase()).not.toContain(phrase);
    }
  });
});
