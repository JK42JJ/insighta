/**
 * OpenRouter generation — transient 429 / 5xx backoff retry (CP498).
 *
 * Before CP498 the provider threw immediately on any `!response.ok`, so a
 * parallel Heart / relevance-backfill burst that tripped OpenRouter's dynamic
 * (credit-based) rate limit failed the user's job with no retry. These tests
 * pin: retry on 429 / 5xx, honour Retry-After, no retry on deterministic 4xx,
 * and exhaustion after OPENROUTER_MAX_RETRIES.
 */

const mockConfig = {
  openrouter: { apiKey: 'test-key', model: 'anthropic/claude-haiku-4.5' },
};

jest.mock('@/config/index', () => ({ config: mockConfig }));
jest.mock('@/modules/llm/call-logger', () => ({ logLLMCall: jest.fn(() => Promise.resolve()) }));

import {
  OpenRouterGenerationProvider,
  isRetryableStatus,
  retryDelayMs,
} from '@/modules/llm/openrouter';

const ok = (content: string): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }], usage: {} }),
  }) as unknown as Response;

const httpErr = (status: number, retryAfter: string | null = '0'): Response =>
  ({
    ok: false,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'retry-after' ? retryAfter : null) },
    text: async () => `${status} error`,
  }) as unknown as Response;

afterEach(() => {
  jest.restoreAllMocks();
});

describe('OpenRouterGenerationProvider — 429/5xx backoff', () => {
  it('retries a transient 429 (Retry-After) then succeeds', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(httpErr(429))
      .mockResolvedValueOnce(ok('{"mandala_relevance_pct":80}')) as unknown as typeof fetch;

    const provider = new OpenRouterGenerationProvider('anthropic/claude-haiku-4.5');
    const out = await provider.generate('hi', { format: 'json' });

    expect(out).toBe('{"mandala_relevance_pct":80}');
    expect(global.fetch).toHaveBeenCalledTimes(2); // 1 × 429 + 1 × success
  });

  it('retries a transient 503 then succeeds', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(httpErr(503))
      .mockResolvedValueOnce(ok('{"ok":1}')) as unknown as typeof fetch;

    const provider = new OpenRouterGenerationProvider('m');
    expect(await provider.generate('hi')).toBe('{"ok":1}');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a deterministic 400 — throws after one attempt', async () => {
    global.fetch = jest.fn().mockResolvedValue(httpErr(400)) as unknown as typeof fetch;

    const provider = new OpenRouterGenerationProvider('m');
    await expect(provider.generate('hi')).rejects.toThrow(/error 400/);
    expect(global.fetch).toHaveBeenCalledTimes(1); // 400 is non-retryable
  });

  it('exhausts retries on a persistent 429 then throws', async () => {
    global.fetch = jest.fn().mockResolvedValue(httpErr(429)) as unknown as typeof fetch;

    const provider = new OpenRouterGenerationProvider('m');
    await expect(provider.generate('hi')).rejects.toThrow(/error 429/);
    expect(global.fetch).toHaveBeenCalledTimes(4); // initial + OPENROUTER_MAX_RETRIES(3)
  });
});

describe('retry helpers (pure)', () => {
  it('isRetryableStatus: 429 + 5xx true, 4xx-other false', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(200)).toBe(false);
  });

  it('retryDelayMs: Retry-After delta-seconds honoured (capped)', () => {
    expect(retryDelayMs('5', 0)).toBe(5_000);
    expect(retryDelayMs('0', 0)).toBe(0);
    expect(retryDelayMs('9999', 0)).toBe(30_000); // capped at RETRY_CAP_MS
  });

  it('retryDelayMs: exponential backoff when no Retry-After', () => {
    expect(retryDelayMs(null, 0)).toBe(1_000);
    expect(retryDelayMs(null, 1)).toBe(2_000);
    expect(retryDelayMs(null, 2)).toBe(4_000);
    expect(retryDelayMs(null, 10)).toBe(30_000); // capped
  });
});
