/**
 * Unit tests for the chatbot health-check failover helpers (CP477+3).
 *
 * Covers:
 *   - `buildHealthUrl` derives `/health` from any vLLM base URL.
 *   - `isQwenRunpodHealthy`:
 *       cache hit (no fetch on second call within TTL)
 *       fetch 200 → true
 *       fetch 503 → false
 *       fetch throws / aborts → false
 *       missing apiUrl → false (no fetch)
 *   - `resolveEffectiveProvider`:
 *       qwen-runpod + healthy → qwen-runpod
 *       qwen-runpod + unhealthy → openrouter
 *       gemini / openrouter / local → passthrough (no probe)
 */

import {
  buildHealthUrl,
  isQwenRunpodHealthy,
  resolveEffectiveProvider,
  _resetVllmHealthCacheForTesting,
} from '@/api/routes/copilotkit-health';

const mockFetch = jest.fn();

beforeAll(() => {
  // Pin process.env values that toRunpodOpenAiBase doesn't read but other
  // imports might; not strictly required here since the helper module is
  // intentionally config-free.
});

beforeEach(() => {
  jest.clearAllMocks();
  _resetVllmHealthCacheForTesting();
  (globalThis as { fetch: unknown }).fetch = mockFetch as unknown as typeof fetch;
});

describe('buildHealthUrl', () => {
  it('rewrites /v1 to /health on a Pod-direct base', () => {
    expect(buildHealthUrl('https://pod.proxy.runpod.net/v1')).toBe(
      'https://pod.proxy.runpod.net/health'
    );
  });

  it('rewrites /openai/v1 to /health on a Serverless base', () => {
    expect(buildHealthUrl('https://api.runpod.ai/v2/abc/openai/v1')).toBe(
      'https://api.runpod.ai/health'
    );
  });

  it('strips query string and hash', () => {
    expect(buildHealthUrl('https://pod.proxy.runpod.net/v1?x=1#h')).toBe(
      'https://pod.proxy.runpod.net/health'
    );
  });
});

describe('isQwenRunpodHealthy', () => {
  it('returns false (and skips fetch) when apiUrl is undefined', async () => {
    const healthy = await isQwenRunpodHealthy(undefined);
    expect(healthy).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns true on 2xx', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);
    const healthy = await isQwenRunpodHealthy('https://pod.proxy.runpod.net/v1');
    expect(healthy).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const args = mockFetch.mock.calls[0]!;
    expect(args[0]).toBe('https://pod.proxy.runpod.net/health');
  });

  it('returns false on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    const healthy = await isQwenRunpodHealthy('https://pod.proxy.runpod.net/v1');
    expect(healthy).toBe(false);
  });

  it('returns false when fetch throws (network/abort/timeout)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const healthy = await isQwenRunpodHealthy('https://pod.proxy.runpod.net/v1');
    expect(healthy).toBe(false);
  });

  it('caches result within TTL — second call within 5s does NOT fetch again', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);
    await isQwenRunpodHealthy('https://pod.proxy.runpod.net/v1');
    await isQwenRunpodHealthy('https://pod.proxy.runpod.net/v1');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('caches failures too — repeated calls do not retry within TTL', async () => {
    mockFetch.mockRejectedValueOnce(new Error('boom'));
    await isQwenRunpodHealthy('https://pod.proxy.runpod.net/v1');
    await isQwenRunpodHealthy('https://pod.proxy.runpod.net/v1');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('resolveEffectiveProvider — CP477+3 failover semantics', () => {
  it('qwen-runpod + healthy → qwen-runpod', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);
    const out = await resolveEffectiveProvider('qwen-runpod', 'https://pod.proxy.runpod.net/v1');
    expect(out).toBe('qwen-runpod');
  });

  it('qwen-runpod + unhealthy (503) → openrouter (the user-requested fallback)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    const out = await resolveEffectiveProvider('qwen-runpod', 'https://pod.proxy.runpod.net/v1');
    expect(out).toBe('openrouter');
  });

  it('qwen-runpod + fetch throws → openrouter', async () => {
    mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const out = await resolveEffectiveProvider('qwen-runpod', 'https://pod.proxy.runpod.net/v1');
    expect(out).toBe('openrouter');
  });

  it('qwen-runpod + apiUrl missing → openrouter (no probe, no fetch)', async () => {
    const out = await resolveEffectiveProvider('qwen-runpod', undefined);
    expect(out).toBe('openrouter');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('openrouter passes through (no health probe)', async () => {
    const out = await resolveEffectiveProvider('openrouter', 'https://pod.proxy.runpod.net/v1');
    expect(out).toBe('openrouter');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('gemini passes through (no health probe)', async () => {
    const out = await resolveEffectiveProvider('gemini', undefined);
    expect(out).toBe('gemini');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('local passes through (no health probe)', async () => {
    const out = await resolveEffectiveProvider('local', undefined);
    expect(out).toBe('local');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
