/**
 * The budget gate, switched off.
 *
 * Its own file because proving this needs a different `config`, and the way to
 * get one mid-file — `jest.resetModules()` + `doMock` — swaps the module
 * instance underneath the dynamic `import('./cost-gate')` inside `creditGate`.
 * Every case after it in the same file then sets up one instance and asserts
 * against another. That cost an hour once; a second file costs nothing.
 */

const mockQueryRaw = jest.fn();

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({ $queryRaw: mockQueryRaw, $executeRaw: jest.fn() }),
}));

jest.mock('@/config/index', () => ({
  config: {
    creditBreaker: { enabled: false },
    llm: { budgetGateEnabled: false, dailyCostLimitUsd: 10, monthlyCostLimitUsd: 50 },
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
} from '@/modules/llm/cost-gate';
import { creditGate } from '@/modules/llm/credit-guard';

beforeEach(() => {
  jest.clearAllMocks();
  resetBudgetStateForTest();
  mockQueryRaw.mockResolvedValue([{ daily: 999, monthly: 999 }]);
});

describe('LLM_BUDGET_GATE_ENABLED=false', () => {
  it('allows the call however far past both ceilings the ledger is', async () => {
    const d = await checkSpendCaps();
    expect(d.allowed).toBe(true);
  });

  it('does not touch the ledger at all', async () => {
    await checkSpendCaps();
    // Off has to mean off. A gate that still queries is a gate that still
    // costs, and this flag exists so it can be taken out of the path.
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it('lets the shared gate through', async () => {
    const d = await creditGate('openrouter/anthropic/claude-haiku-4.5');
    expect(d.allowed).toBe(true);
  });

  it('never refuses the chat route', () => {
    expect(creditBlockedFromCache('openrouter')).toBeNull();
  });
});
