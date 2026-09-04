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
    llm: { budgetGateEnabled: true, dailyCostLimitUsd: 10 },
  },
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  },
}));

import {
  checkDailyBudget,
  creditBlockedFromCache,
  resetBudgetStateForTest,
  resetCreditStateForTest,
} from '@/modules/llm/cost-gate';
import { creditGate, creditBlockMessage, isCreditSkipMessage } from '@/modules/llm/credit-guard';

const MODEL = 'openrouter/anthropic/claude-haiku-4.5';

/** The ledger answers with today's successful spend. */
function spentToday(total: number) {
  mockQueryRaw.mockResolvedValue([{ total }]);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetBudgetStateForTest();
  resetCreditStateForTest();
});

describe('L2 — under the ceiling', () => {
  it('allows the call', async () => {
    spentToday(2.5);
    const d = await checkDailyBudget();
    expect(d).toEqual({ allowed: true, dailyTotal: 2.5, limit: 10 });
  });

  it('does not query the ledger once per call', async () => {
    spentToday(1);
    await checkDailyBudget();
    await checkDailyBudget();
    await checkDailyBudget();
    // A SUM() in front of every LLM call is the reason this is cached at all.
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('the shared gate lets it through', async () => {
    spentToday(1);
    const d = await creditGate(MODEL);
    expect(d.allowed).toBe(true);
  });
});

describe('L2 — at the ceiling', () => {
  it('refuses at exactly the limit, not just past it', async () => {
    spentToday(10);
    const d = await checkDailyBudget();
    expect(d.allowed).toBe(false);
  });

  it('refuses through the shared gate, which is what the call sites read', async () => {
    spentToday(12.34);
    const d = await creditGate(MODEL);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('daily_budget');
    expect(d.dailySpendUsd).toBe(12.34);
    expect(d.dailyLimitUsd).toBe(10);
  });

  it('says what was spent, so the log is actionable', async () => {
    spentToday(12.34);
    const msg = creditBlockMessage(await creditGate(MODEL));
    expect(msg).toContain('$12.34');
    expect(msg).toContain('$10.00');
    expect(msg).toContain('call not attempted');
  });

  it('tightens the cache once past the warning line', async () => {
    // Below the warn threshold a stale reading costs nothing. Above it,
    // staleness is exactly how far a burst overshoots the ceiling.
    spentToday(7);
    await checkDailyBudget();
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    await checkDailyBudget();
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    jest.spyOn(Date, 'now').mockRestore();
  });
});

describe('L2 — its refusal is not a provider 402', () => {
  it('is recognised as a skip, so no ledger row is written for it', async () => {
    spentToday(11);
    const msg = creditBlockMessage(await creditGate(MODEL));
    expect(isCreditSkipMessage(msg)).toBe(true);
  });

  it('carries none of the phrases that open the credit breaker', async () => {
    spentToday(11);
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
    const d = await checkDailyBudget();
    expect(d.allowed).toBe(true);
  });

  it('is a no-op when switched off', async () => {
    jest.resetModules();
    jest.doMock('@/config/index', () => ({
      config: { creditBreaker: { enabled: false }, llm: { budgetGateEnabled: false } },
    }));
    const gate = await import('@/modules/llm/cost-gate');
    gate.resetBudgetStateForTest();
    spentToday(999);
    expect((await gate.checkDailyBudget()).allowed).toBe(true);
    expect(mockQueryRaw).not.toHaveBeenCalled();
    jest.dontMock('@/config/index');
    jest.resetModules();
  });
});

describe('L2 — the chat route reads the same ceiling', () => {
  it('is not refused on a cold cache', () => {
    // Chat cannot await: a second async hop past req.pause() loses the body.
    // Nothing read yet means nothing to refuse on.
    expect(creditBlockedFromCache('openrouter')).toBeNull();
  });

  it('is refused once background work has seen the ceiling', async () => {
    spentToday(11);
    await checkDailyBudget();
    const d = creditBlockedFromCache('openrouter');
    expect(d?.allowed).toBe(false);
    expect(d?.reason).toBe('daily_budget');
  });

  it('is not refused while the day is still under budget', async () => {
    spentToday(3);
    await checkDailyBudget();
    expect(creditBlockedFromCache('openrouter')).toBeNull();
  });
});
