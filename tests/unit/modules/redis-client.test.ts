jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({
      debug: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

import {
  closeInsightaRedisClient,
  getInsightaRedisClient,
  resetRedisClientForTesting,
  type RedisEnv,
} from '../../../src/modules/redis';

interface FakeClient {
  connect: jest.Mock;
  quit: jest.Mock;
  on: jest.Mock;
  sMembers: jest.Mock;
  __connected: boolean;
}

function makeFakeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  const c: FakeClient = {
    connect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    sMembers: jest.fn().mockResolvedValue([]),
    __connected: false,
  };
  return { ...c, ...overrides };
}

const BASE_ENV: RedisEnv = {
  REDIS_HOST: '100.102.124.23',
  REDIS_PORT: '6379',
  REDIS_DB: '0',
  REDIS_USER: 'insighta',
  REDIS_INSIGHTA_PASSWORD: 'test-password',
};

afterEach(async () => {
  await closeInsightaRedisClient();
  resetRedisClientForTesting();
});

describe('getInsightaRedisClient', () => {
  test('returns null when REDIS_HOST is unset (dev/CI fail-open)', async () => {
    const fake = makeFakeClient();
    resetRedisClientForTesting(() => fake as never);
    const client = await getInsightaRedisClient({});
    expect(client).toBeNull();
    expect(fake.connect).not.toHaveBeenCalled();
  });

  test('returns null when password is missing (misconfiguration fail-open)', async () => {
    const fake = makeFakeClient();
    resetRedisClientForTesting(() => fake as never);
    const client = await getInsightaRedisClient({
      REDIS_HOST: '100.102.124.23',
    });
    expect(client).toBeNull();
    expect(fake.connect).not.toHaveBeenCalled();
  });

  test('connects once and returns the same instance on repeated calls', async () => {
    const fake = makeFakeClient();
    resetRedisClientForTesting(() => fake as never);
    const a = await getInsightaRedisClient(BASE_ENV);
    const b = await getInsightaRedisClient(BASE_ENV);
    expect(a).toBe(b);
    expect(fake.connect).toHaveBeenCalledTimes(1);
  });

  test('returns null and does not throw when connect() rejects', async () => {
    const fake = makeFakeClient({
      connect: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    resetRedisClientForTesting(() => fake as never);
    const client = await getInsightaRedisClient(BASE_ENV);
    expect(client).toBeNull();
  });

  test('concurrent callers share the same connect promise', async () => {
    const fake = makeFakeClient();
    resetRedisClientForTesting(() => fake as never);
    const [a, b, c] = await Promise.all([
      getInsightaRedisClient(BASE_ENV),
      getInsightaRedisClient(BASE_ENV),
      getInsightaRedisClient(BASE_ENV),
    ]);
    expect(fake.connect).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  test('registers an error handler before connect', async () => {
    const fake = makeFakeClient();
    resetRedisClientForTesting(() => fake as never);
    await getInsightaRedisClient(BASE_ENV);
    expect(fake.on).toHaveBeenCalledWith('error', expect.any(Function));
  });
});

describe('closeInsightaRedisClient', () => {
  test('is a no-op when no client exists', async () => {
    await expect(closeInsightaRedisClient()).resolves.toBeUndefined();
  });

  test('calls quit() on the singleton and is idempotent', async () => {
    const fake = makeFakeClient();
    resetRedisClientForTesting(() => fake as never);
    await getInsightaRedisClient(BASE_ENV);

    await closeInsightaRedisClient();
    expect(fake.quit).toHaveBeenCalledTimes(1);

    await closeInsightaRedisClient();
    expect(fake.quit).toHaveBeenCalledTimes(1); // still 1 — singleton cleared
  });

  test('swallows errors from quit()', async () => {
    const fake = makeFakeClient({
      quit: jest.fn().mockRejectedValue(new Error('already closed')),
    });
    resetRedisClientForTesting(() => fake as never);
    await getInsightaRedisClient(BASE_ENV);
    await expect(closeInsightaRedisClient()).resolves.toBeUndefined();
  });
});
