/**
 * The credit breaker (cost-gate L6).
 *
 * Written after the first version of L6 shipped with no tests, recorded the
 * state and blocked nothing, and left production making 54 doomed calls a day
 * against an empty account. These pin the behaviour that was missing:
 *
 *   - a known-out provider is refused without a round trip
 *   - exactly one caller gets the recovery probe
 *   - a probe that succeeds closes the breaker
 *   - the breaker fails OPEN when it cannot read its own state
 *   - a skip message is never mistaken for a real refusal, which would push
 *     the probe deadline forward forever and latch the breaker shut
 */

const mockQueryRaw = jest.fn();
const mockExecuteRaw = jest.fn();

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({ $queryRaw: mockQueryRaw, $executeRaw: mockExecuteRaw }),
}));

// The breaker is off under Jest on purpose (see config.creditBreaker): suites
// simulate 402s against one shared database, and a breaker opened by one would
// refuse calls in another. These tests are about the breaker itself, so they
// turn it on and supply their own state through the mocked client above.
jest.mock('@/config/index', () => ({
  // L2 off here on purpose: these cases are about L6 in isolation, and a
  // budget gate reading the same mocked client would answer for it.
  config: { creditBreaker: { enabled: true }, llm: { budgetGateEnabled: false } },
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  },
}));

import {
  checkProviderCredit,
  creditBlockedFromCache,
  isCreditExhaustionError,
  noteCreditExhaustion,
  noteCreditRecovered,
  resetCreditStateForTest,
} from '@/modules/llm/cost-gate';
import { creditBlockMessage } from '@/modules/llm/credit-guard';

const MINUTE = 60 * 1000;

/** A row as the table returns it: open, with the probe due in `probeInMs`. */
function openRow(probeInMs: number, hits = 3) {
  return [
    {
      exhausted_at: new Date(Date.now() - 30 * MINUTE),
      hits,
      last_module: 'trend-extract',
      next_probe_at: new Date(Date.now() + probeInMs),
    },
  ];
}

beforeEach(() => {
  resetCreditStateForTest();
  mockQueryRaw.mockReset();
  mockExecuteRaw.mockReset();
});

describe('isCreditExhaustionError', () => {
  test.each([
    'API error 402: exceed your available credits',
    'HTTP 402: requires more credits',
    'OpenRouter HTTP 402',
    'insufficient credit remaining',
    'RESOURCE_EXHAUSTED: quota exceeded',
  ])('recognises %s', (msg) => {
    expect(isCreditExhaustionError(msg)).toBe(true);
  });

  test.each(['HTTP 500 upstream error', 'timeout after 30000ms', 'ECONNRESET', undefined])(
    'does not claim %s',
    (msg) => {
      expect(isCreditExhaustionError(msg)).toBe(false);
    }
  );

  /**
   * The latch regression.
   *
   * `noteCreditExhaustion` pushes the probe deadline ten minutes out on every
   * refusal it records. If a skip message were recognised as a refusal, each
   * skipped call would push the deadline again and the probe would never come
   * due — the breaker would never reopen, even after a top-up.
   */
  test('a skip message is not a refusal', () => {
    const msg = creditBlockMessage({
      allowed: false,
      provider: 'openrouter',
      reason: 'credit_exhausted',
      since: new Date(),
      hits: 12,
    });
    expect(isCreditExhaustionError(msg)).toBe(false);
  });
});

describe('checkProviderCredit', () => {
  test('allows the call when no row exists', async () => {
    mockQueryRaw.mockResolvedValue([]);
    const d = await checkProviderCredit('openrouter/anthropic/claude-haiku');
    expect(d.allowed).toBe(true);
    expect(d.provider).toBe('openrouter');
  });

  test('refuses while the probe is not due', async () => {
    mockQueryRaw.mockResolvedValue(openRow(5 * MINUTE, 18));
    const d = await checkProviderCredit('openrouter/x');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('credit_exhausted');
    expect(d.hits).toBe(18);
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  test('the second call inside the cache window asks the database nothing', async () => {
    mockQueryRaw.mockResolvedValue(openRow(5 * MINUTE));
    await checkProviderCredit('openrouter/x');
    await checkProviderCredit('openrouter/x');
    await checkProviderCredit('openrouter/x');
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  test('grants the probe to the caller that claims the row', async () => {
    mockQueryRaw.mockResolvedValue(openRow(-1 * MINUTE));
    mockExecuteRaw.mockResolvedValue(1);
    const d = await checkProviderCredit('openrouter/x');
    expect(d.allowed).toBe(true);
    expect(d.isProbe).toBe(true);
  });

  test('refuses the caller that loses the race for the probe', async () => {
    mockQueryRaw.mockResolvedValue(openRow(-1 * MINUTE));
    mockExecuteRaw.mockResolvedValue(0); // another pod took it
    const d = await checkProviderCredit('openrouter/x');
    expect(d.allowed).toBe(false);
  });

  test('a granted probe is not granted again until the interval passes', async () => {
    mockQueryRaw.mockResolvedValue(openRow(-1 * MINUTE));
    mockExecuteRaw.mockResolvedValue(1);
    const first = await checkProviderCredit('openrouter/x');
    expect(first.allowed).toBe(true);
    const second = await checkProviderCredit('openrouter/x');
    expect(second.allowed).toBe(false);
  });

  test('fails open when the state cannot be read', async () => {
    mockQueryRaw.mockRejectedValue(new Error('connection refused'));
    const d = await checkProviderCredit('openrouter/x');
    expect(d.allowed).toBe(true);
  });

  test('keys on the provider prefix, so providers do not block each other', async () => {
    mockQueryRaw.mockImplementation((_strings: unknown, provider: string) =>
      Promise.resolve(provider === 'openrouter' ? openRow(5 * MINUTE) : [])
    );
    expect((await checkProviderCredit('openrouter/x')).allowed).toBe(false);
    expect((await checkProviderCredit('qwen-runpod/y')).allowed).toBe(true);
  });
});

describe('noteCreditExhaustion / noteCreditRecovered', () => {
  test('a recorded refusal makes the next call refuse without reading the table', async () => {
    mockExecuteRaw.mockResolvedValue(1);
    await noteCreditExhaustion('openrouter/x', 'trend-extract');

    const d = await checkProviderCredit('openrouter/x');
    expect(d.allowed).toBe(false);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  test('a success closes the breaker', async () => {
    mockExecuteRaw.mockResolvedValue(1);
    await noteCreditExhaustion('openrouter/x', 'trend-extract');
    expect((await checkProviderCredit('openrouter/x')).allowed).toBe(false);

    await noteCreditRecovered('openrouter/x');
    expect((await checkProviderCredit('openrouter/x')).allowed).toBe(true);
  });

  test('does nothing when this pod has no reason to think anything is open', async () => {
    await noteCreditRecovered('openrouter/x');
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  /**
   * The admin balance check runs on whichever pod answers the request, which
   * may be one that never saw the refusal. It has to clear the row anyway.
   */
  test('force clears even on a pod with a cold cache', async () => {
    mockExecuteRaw.mockResolvedValue(1);
    await noteCreditRecovered('openrouter/admin-balance-check', { force: true });
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
  });

  test('a failed write does not leave the breaker believing it closed', async () => {
    mockExecuteRaw.mockResolvedValue(1);
    await noteCreditExhaustion('openrouter/x', 'trend-extract');
    mockExecuteRaw.mockRejectedValue(new Error('write failed'));
    await noteCreditRecovered('openrouter/x');
    expect((await checkProviderCredit('openrouter/x')).allowed).toBe(false);
  });
});

describe('creditBlockedFromCache (the chat route)', () => {
  test('says nothing when the cache is cold, so the call goes through', () => {
    expect(creditBlockedFromCache('openrouter')).toBeNull();
  });

  test('refuses once a refusal has been recorded in this process', async () => {
    mockExecuteRaw.mockResolvedValue(1);
    await noteCreditExhaustion('openrouter/x', 'copilotkit');
    const d = creditBlockedFromCache('openrouter');
    expect(d?.allowed).toBe(false);
    expect(d?.provider).toBe('openrouter');
  });

  test('stands aside when a probe is due rather than refusing forever', async () => {
    mockQueryRaw.mockResolvedValue(openRow(-1 * MINUTE));
    mockExecuteRaw.mockResolvedValue(0); // lost the claim; cache still shows due
    await checkProviderCredit('openrouter/x');
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 20 * MINUTE);
    expect(creditBlockedFromCache('openrouter')).toBeNull();
    jest.restoreAllMocks();
  });
});
