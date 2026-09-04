/**
 * The rollback path.
 *
 * `LLM_CREDIT_BREAKER_ENABLED=false` has to put the system back to calling the
 * provider regardless — no code revert, no redeploy of a different image. A
 * kill-switch nobody has pulled is a kill-switch nobody knows works, so it is
 * pulled here.
 */

const mockQueryRaw = jest.fn();
const mockExecuteRaw = jest.fn();

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({ $queryRaw: mockQueryRaw, $executeRaw: mockExecuteRaw }),
}));
jest.mock('@/config/index', () => ({
  config: { creditBreaker: { enabled: false }, llm: { budgetGateEnabled: false } },
}));
jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  },
}));

import {
  checkProviderCredit,
  creditBlockedFromCache,
  noteCreditExhaustion,
  resetCreditStateForTest,
} from '@/modules/llm/cost-gate';

beforeEach(() => {
  resetCreditStateForTest();
  mockQueryRaw.mockReset();
  mockExecuteRaw.mockReset();
});

test('the gate allows everything and reads nothing', async () => {
  mockQueryRaw.mockResolvedValue([
    {
      exhausted_at: new Date(),
      hits: 99,
      last_module: 'trend-extract',
      next_probe_at: new Date(Date.now() + 600_000),
    },
  ]);
  const d = await checkProviderCredit('openrouter/x');
  expect(d.allowed).toBe(true);
  expect(mockQueryRaw).not.toHaveBeenCalled();
});

test('a refusal is not recorded, so switching back on starts from a clean state', async () => {
  await noteCreditExhaustion('openrouter/x', 'trend-extract');
  expect(mockExecuteRaw).not.toHaveBeenCalled();
});

test('the chat route is never refused', async () => {
  await noteCreditExhaustion('openrouter/x', 'copilotkit');
  expect(creditBlockedFromCache('openrouter')).toBeNull();
});
