/**
 * The per-user chat rate limit (cost-gate L5), now that something calls it.
 *
 * The previous version counted `llm_call_logs` rows whose `module` column
 * contained the user id — a value no writer ever produced — and had no
 * callers, so it never refused anyone. It now counts rows by `user_id` and
 * the chat module label inside a rolling hour, and tells the caller how long
 * to wait.
 */

const mockCount = jest.fn();
const mockFindFirst = jest.fn();

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    llm_call_logs: { count: mockCount, findFirst: mockFindFirst },
  }),
}));

const LIMIT = 3;

jest.mock('@/config/index', () => ({
  config: {
    chatbot: { userRateLimitPerHour: 3 },
    creditBreaker: { enabled: false },
    llm: { budgetGateEnabled: false },
  },
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  },
}));

import { checkUserRateLimit } from '@/modules/llm/cost-gate';
import { CHAT_LEDGER_MODULE } from '@/modules/llm/ledger-modules';
import { MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from '@/utils/time-constants';

const USER = 'user-1';
const TEN_MINUTES_MS = 10 * MS_PER_MINUTE;
const CLOCK_TOLERANCE_MS = 2 * MS_PER_SECOND;
const CLOCK_TOLERANCE_SEC = 2;

type CountArg = { where: { user_id: string; module: string; created_at: { gt: Date } } };
type FindFirstArg = CountArg & {
  orderBy: { created_at: 'asc' };
  skip: number;
  select: { created_at: true };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFindFirst.mockResolvedValue(null);
});

describe('checkUserRateLimit', () => {
  it('allows an anonymous caller without querying the ledger', async () => {
    const out = await checkUserRateLimit(null);
    expect(out).toEqual({ allowed: true, callCount: 0, limit: LIMIT });
    expect(mockCount).not.toHaveBeenCalled();
  });

  it('counts rows by user_id and the chat module inside the last hour', async () => {
    mockCount.mockResolvedValue(0);
    const before = Date.now();

    await checkUserRateLimit(USER);

    const arg = mockCount.mock.calls[0]?.[0] as CountArg;
    expect(arg.where.user_id).toBe(USER);
    expect(arg.where.module).toBe(CHAT_LEDGER_MODULE);
    const windowStart = arg.where.created_at.gt.getTime();
    expect(windowStart).toBeGreaterThanOrEqual(before - MS_PER_HOUR - CLOCK_TOLERANCE_MS);
    expect(windowStart).toBeLessThanOrEqual(Date.now() - MS_PER_HOUR + CLOCK_TOLERANCE_MS);
  });

  it('allows the call under the limit and reports the count', async () => {
    mockCount.mockResolvedValue(LIMIT - 1);
    const out = await checkUserRateLimit(USER);
    expect(out).toEqual({ allowed: true, callCount: LIMIT - 1, limit: LIMIT });
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('refuses at the limit and waits for the oldest counted row to leave the window', async () => {
    mockCount.mockResolvedValue(LIMIT);
    const oldestAt = new Date(Date.now() - TEN_MINUTES_MS);
    mockFindFirst.mockResolvedValue({ created_at: oldestAt });

    const out = await checkUserRateLimit(USER);

    expect(out.allowed).toBe(false);
    expect(out.callCount).toBe(LIMIT);
    expect(out.limit).toBe(LIMIT);
    const expected = (MS_PER_HOUR - TEN_MINUTES_MS) / MS_PER_SECOND;
    expect(out.retryAfterSec).toBeGreaterThanOrEqual(expected - CLOCK_TOLERANCE_SEC);
    expect(out.retryAfterSec).toBeLessThanOrEqual(expected + CLOCK_TOLERANCE_SEC);

    const arg = mockFindFirst.mock.calls[0]?.[0] as FindFirstArg;
    expect(arg.where.user_id).toBe(USER);
    expect(arg.where.module).toBe(CHAT_LEDGER_MODULE);
    expect(arg.orderBy).toEqual({ created_at: 'asc' });
    expect(arg.skip).toBe(0);
  });

  it('past the limit, waits for the row whose expiry brings the count back under it', async () => {
    const overshoot = 2;
    mockCount.mockResolvedValue(LIMIT + overshoot);
    mockFindFirst.mockResolvedValue({ created_at: new Date(Date.now() - TEN_MINUTES_MS) });

    const out = await checkUserRateLimit(USER);

    expect(out.allowed).toBe(false);
    const arg = mockFindFirst.mock.calls[0]?.[0] as FindFirstArg;
    expect(arg.skip).toBe(overshoot);
  });

  it('never tells the client to wait less than one second', async () => {
    mockCount.mockResolvedValue(LIMIT);
    mockFindFirst.mockResolvedValue({ created_at: new Date(Date.now() - MS_PER_HOUR) });

    const out = await checkUserRateLimit(USER);

    expect(out.allowed).toBe(false);
    expect(out.retryAfterSec).toBe(1);
  });

  it('allows the call when the ledger cannot be read', async () => {
    mockCount.mockRejectedValue(new Error('connection refused'));
    const out = await checkUserRateLimit(USER);
    expect(out).toEqual({ allowed: true, callCount: 0, limit: LIMIT });
  });
});
