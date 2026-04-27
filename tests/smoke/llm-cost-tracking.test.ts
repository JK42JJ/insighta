/**
 * LLM Cost Tracking — smoke tests
 *
 * Covers:
 *   1. calculateCost() — known model returns correct cost, unknown returns null
 *   2. checkSingleCallCost() — under threshold allows, over $5 blocks, $0.5-$5 warns
 *   3. logLLMCall() — does not throw when Prisma is unavailable (mock)
 *
 * No server boot required — all tests are unit-level or use mocked Prisma.
 */
export {};

// ---------------------------------------------------------------------------
// Module-level Prisma mock — hoisted by Jest before any imports
// ---------------------------------------------------------------------------

const mockCreate = jest.fn();
const mockPrisma = {
  llm_call_logs: {
    create: mockCreate,
  },
};

jest.mock('../../src/modules/database/client', () => ({
  getPrismaClient: jest.fn(() => mockPrisma),
  db: mockPrisma,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  resetConnectionPool: jest.fn(),
  withRetry: jest.fn((fn: () => unknown) => fn()),
  executeTransaction: jest.fn(),
  testDatabaseConnection: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Group 1: calculateCost
// ---------------------------------------------------------------------------

describe('calculateCost — pricing table lookup', () => {
  let calculateCost: (model: string, inputTokens: number, outputTokens: number) => number | null;

  beforeAll(async () => {
    const mod = await import('../../src/config/llm-pricing');
    calculateCost = mod.calculateCost;
  });

  it('returns correct cost for qwen/qwen3-30b-a3b (OpenRouter pricing)', () => {
    // inputPerToken=0.00000008, outputPerToken=0.00000028
    // 1000 input + 500 output = 0.00000008*1000 + 0.00000028*500
    //   = 0.00008 + 0.00014 = 0.00022
    const cost = calculateCost('qwen/qwen3-30b-a3b', 1000, 500);
    expect(cost).not.toBeNull();
    expect(cost!).toBeCloseTo(0.00022, 8);
  });

  it('returns correct cost for qwen/qwen3.5-9b', () => {
    // inputPerToken=0.0000001, outputPerToken=0.00000015
    // 2000 input + 1000 output = 0.0000001*2000 + 0.00000015*1000
    //   = 0.0002 + 0.00015 = 0.00035
    const cost = calculateCost('qwen/qwen3.5-9b', 2000, 1000);
    expect(cost).not.toBeNull();
    expect(cost!).toBeCloseTo(0.00035, 8);
  });

  it('strips openrouter/ prefix before lookup', () => {
    const cost = calculateCost('openrouter/qwen/qwen3-30b-a3b', 1000, 500);
    expect(cost).not.toBeNull();
    expect(cost!).toBeCloseTo(0.00022, 8);
  });

  it('strips ollama/ prefix before lookup', () => {
    const cost = calculateCost('ollama/qwen3.5:9b', 100, 100);
    expect(cost).not.toBeNull();
    expect(cost!).toBe(0); // local inference = zero cost
  });

  it('strips gemini/ prefix before lookup', () => {
    const cost = calculateCost('gemini/gemini-pro', 1000, 500);
    expect(cost).not.toBeNull();
  });

  it('returns correct cost for anthropic/claude-haiku-4.5 (mandala generator)', () => {
    // inputPerToken=0.000001, outputPerToken=0.000005
    // 2000 input + 700 output (structure prompt) = 0.000001*2000 + 0.000005*700
    //   = 0.002 + 0.0035 = 0.0055
    const cost = calculateCost('anthropic/claude-haiku-4.5', 2000, 700);
    expect(cost).not.toBeNull();
    expect(cost!).toBeCloseTo(0.0055, 8);
  });

  it('returns null for unknown model', () => {
    const cost = calculateCost('unknown/model-xyz', 1000, 500);
    expect(cost).toBeNull();
  });

  it('returns zero for Ollama local model', () => {
    const cost = calculateCost('qwen3.5:9b', 5000, 2000);
    expect(cost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Group 2: checkSingleCallCost
// ---------------------------------------------------------------------------

describe('checkSingleCallCost — gate logic', () => {
  let checkSingleCallCost: (
    model: string,
    estimatedInputTokens: number,
    estimatedOutputTokens: number
  ) => { allowed: boolean; estimatedCost: number | null; warning?: string };

  beforeAll(async () => {
    const mod = await import('../../src/modules/llm/cost-gate');
    checkSingleCallCost = mod.checkSingleCallCost;
  });

  it('allows calls under $0.5 with no warning', () => {
    // qwen3-30b-a3b: 1000 input + 500 output = ~$0.00022 → well under $0.5
    const result = checkSingleCallCost('qwen/qwen3-30b-a3b', 1000, 500);
    expect(result.allowed).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(result.estimatedCost).toBeCloseTo(0.00022, 8);
  });

  it('allows calls between $0.5 and $5 with a warning', () => {
    // qwen3-30b-a3b: inputPerToken=0.00000008, outputPerToken=0.00000028
    // To get ~$1: need ~(1 / 0.00000028) ≈ 3,571,429 output tokens
    // Use 0 input + 3,600,000 output = 3,600,000 * 0.00000028 = $1.008
    const result = checkSingleCallCost('qwen/qwen3-30b-a3b', 0, 3_600_000);
    expect(result.allowed).toBe(true);
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/warning/i);
    expect(result.estimatedCost).toBeGreaterThan(0.5);
    expect(result.estimatedCost).toBeLessThan(5.0);
  });

  it('blocks calls over $5', () => {
    // qwen3-30b-a3b: 0 input + 20,000,000 output = 20M * 0.00000028 = $5.6
    const result = checkSingleCallCost('qwen/qwen3-30b-a3b', 0, 20_000_000);
    expect(result.allowed).toBe(false);
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/blocked/i);
    expect(result.estimatedCost).toBeGreaterThan(5.0);
  });

  it('allows unknown model with null cost (no pricing data)', () => {
    const result = checkSingleCallCost('unknown/some-model', 1_000_000, 1_000_000);
    expect(result.allowed).toBe(true);
    expect(result.estimatedCost).toBeNull();
    expect(result.warning).toBeUndefined();
  });

  it('allows Ollama local calls regardless of token count (zero cost)', () => {
    const result = checkSingleCallCost('ollama/qwen3.5:9b', 100_000_000, 100_000_000);
    expect(result.allowed).toBe(true);
    expect(result.estimatedCost).toBe(0);
    expect(result.warning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Group 3: logLLMCall — error resilience
// ---------------------------------------------------------------------------

describe('logLLMCall — does not throw on DB failure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves without throwing when Prisma create succeeds', async () => {
    mockCreate.mockResolvedValue({ call_id: 'test-id' });

    const { logLLMCall } = await import('../../src/modules/llm/call-logger');

    await expect(
      logLLMCall({
        module: 'openrouter',
        model: 'openrouter/qwen/qwen3-30b-a3b',
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 1200,
        status: 'success',
      })
    ).resolves.toBeUndefined();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArg = mockCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(callArg?.data?.['module']).toBe('openrouter');
    expect(callArg?.data?.['model']).toBe('openrouter/qwen/qwen3-30b-a3b');
    expect(callArg?.data?.['status']).toBe('success');
    // cost_usd should be calculated (100 * 0.00000008 + 50 * 0.00000028 = 0.000008 + 0.000014 = 0.000022)
    expect(callArg?.data?.['cost_usd']).toBeCloseTo(0.000022, 8);
  });

  it('resolves without throwing when Prisma throws', async () => {
    mockCreate.mockRejectedValue(new Error('DB connection refused'));

    const { logLLMCall } = await import('../../src/modules/llm/call-logger');

    // Must NOT throw — logging failure is swallowed
    await expect(
      logLLMCall({
        module: 'ollama',
        model: 'ollama/qwen3.5:9b',
        latencyMs: 500,
        status: 'error',
        errorMessage: 'Ollama returned empty response',
      })
    ).resolves.toBeUndefined();
  });

  it('stores null cost_usd for unknown model', async () => {
    mockCreate.mockResolvedValue({ call_id: 'test-id-2' });

    const { logLLMCall } = await import('../../src/modules/llm/call-logger');

    await logLLMCall({
      module: 'openrouter',
      model: 'openrouter/some/unknown-model',
      inputTokens: 500,
      outputTokens: 200,
      latencyMs: 800,
      status: 'success',
    });

    const callArg = mockCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(callArg?.data?.['cost_usd']).toBeNull();
  });

  it('stores null cost_usd when token counts are absent', async () => {
    mockCreate.mockResolvedValue({ call_id: 'test-id-3' });

    const { logLLMCall } = await import('../../src/modules/llm/call-logger');

    await logLLMCall({
      module: 'openrouter',
      model: 'openrouter/qwen/qwen3-30b-a3b',
      // No inputTokens / outputTokens
      latencyMs: 120_000,
      status: 'error',
      errorMessage: 'Request timed out',
    });

    const callArg = mockCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(callArg?.data?.['cost_usd']).toBeNull();
    expect(callArg?.data?.['input_tokens']).toBeNull();
    expect(callArg?.data?.['output_tokens']).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Group 4: checkDailyCostLimit — aggregate gate
// ---------------------------------------------------------------------------

describe('checkDailyCostLimit — L2 daily aggregate', () => {
  let checkDailyCostLimit: () => Promise<{
    allowed: boolean;
    dailyTotal: number;
    limit: number;
    warning?: string;
  }>;

  beforeAll(async () => {
    const mod = await import('../../src/modules/llm/cost-gate');
    checkDailyCostLimit = mod.checkDailyCostLimit;
  });

  it('blocks when daily total >= $10 default limit', async () => {
    (mockPrisma as Record<string, unknown>)['$queryRaw'] = jest
      .fn()
      .mockResolvedValue([{ total: 12.5 }]);
    const result = await checkDailyCostLimit();
    expect(result.allowed).toBe(false);
    expect(result.dailyTotal).toBe(12.5);
    expect(result.limit).toBe(10);
    expect(result.warning).toMatch(/blocked/i);
  });

  it('warns when daily total >= $5 but under limit', async () => {
    (mockPrisma as Record<string, unknown>)['$queryRaw'] = jest
      .fn()
      .mockResolvedValue([{ total: 7.0 }]);
    const result = await checkDailyCostLimit();
    expect(result.allowed).toBe(true);
    expect(result.dailyTotal).toBe(7.0);
    expect(result.warning).toMatch(/warning/i);
  });

  it('allows when daily total is under $5', async () => {
    (mockPrisma as Record<string, unknown>)['$queryRaw'] = jest
      .fn()
      .mockResolvedValue([{ total: 2.0 }]);
    const result = await checkDailyCostLimit();
    expect(result.allowed).toBe(true);
    expect(result.warning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Group 5: checkMonthlyCostLimit — L3 monthly aggregate
// ---------------------------------------------------------------------------

describe('checkMonthlyCostLimit — L3 monthly aggregate', () => {
  let checkMonthlyCostLimit: () => Promise<{
    allowed: boolean;
    monthlyTotal: number;
    limit: number;
    throttled?: boolean;
    warning?: string;
  }>;

  beforeAll(async () => {
    const mod = await import('../../src/modules/llm/cost-gate');
    checkMonthlyCostLimit = mod.checkMonthlyCostLimit;
  });

  it('throttles when monthly total >= $50 default limit', async () => {
    (mockPrisma as Record<string, unknown>)['$queryRaw'] = jest
      .fn()
      .mockResolvedValue([{ total: 55.0 }]);
    const result = await checkMonthlyCostLimit();
    expect(result.allowed).toBe(false);
    expect(result.throttled).toBe(true);
    expect(result.warning).toMatch(/throttled/i);
  });

  it('alerts when monthly total >= $30 but under limit', async () => {
    (mockPrisma as Record<string, unknown>)['$queryRaw'] = jest
      .fn()
      .mockResolvedValue([{ total: 35.0 }]);
    const result = await checkMonthlyCostLimit();
    expect(result.allowed).toBe(true);
    expect(result.warning).toMatch(/alert/i);
  });

  it('allows when monthly total under $30', async () => {
    (mockPrisma as Record<string, unknown>)['$queryRaw'] = jest
      .fn()
      .mockResolvedValue([{ total: 10.0 }]);
    const result = await checkMonthlyCostLimit();
    expect(result.allowed).toBe(true);
    expect(result.warning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Group 6: checkUserRateLimit — L5 per-user
// ---------------------------------------------------------------------------

describe('checkUserRateLimit — L5 user rate', () => {
  let checkUserRateLimit: (
    userId: string | null
  ) => Promise<{ allowed: boolean; callCount: number; limit: number; warning?: string }>;

  beforeAll(async () => {
    const mod = await import('../../src/modules/llm/cost-gate');
    checkUserRateLimit = mod.checkUserRateLimit;
  });

  it('allows null userId without DB query', async () => {
    const result = await checkUserRateLimit(null);
    expect(result.allowed).toBe(true);
    expect(result.callCount).toBe(0);
  });

  it('throttles user with 100+ calls in last hour', async () => {
    (mockPrisma as Record<string, unknown>)['$queryRaw'] = jest
      .fn()
      .mockResolvedValue([{ cnt: 120 }]);
    const result = await checkUserRateLimit('user-abc-123');
    expect(result.allowed).toBe(false);
    expect(result.callCount).toBe(120);
    expect(result.warning).toMatch(/throttled/i);
  });

  it('allows user under rate limit', async () => {
    (mockPrisma as Record<string, unknown>)['$queryRaw'] = jest
      .fn()
      .mockResolvedValue([{ cnt: 42 }]);
    const result = await checkUserRateLimit('user-abc-123');
    expect(result.allowed).toBe(true);
    expect(result.callCount).toBe(42);
  });
});
