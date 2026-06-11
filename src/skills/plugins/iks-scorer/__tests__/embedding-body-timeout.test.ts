/**
 * W3 (CP499+) — #882 mirror regression: the embed timeout must cover the
 * BODY read (res.json()), not just headers, and an external pipeline abort
 * must cancel an in-flight embed. Pre-fix, clearTimeout fired after headers
 * → res.json() was untimed (the 86s/102.8s zombie measured on the
 * goal-embed path before #882).
 */

const noopFn = jest.fn();
const noopLogger = {
  info: noopFn,
  warn: noopFn,
  error: noopFn,
  debug: noopFn,
  child: () => noopLogger,
};
jest.mock('@/utils/logger', () => ({ logger: noopLogger }));

jest.mock('@/config/index', () => ({
  config: {
    iksEmbed: { provider: 'openrouter' },
    openrouter: { apiKey: 'test-key' },
    mandalaEmbed: {
      openRouterBaseUrl: 'https://openrouter.ai/api/v1',
      openRouterModel: 'qwen/qwen3-embedding-8b',
      openRouterDimension: 4096,
    },
  },
}));
jest.mock('@/modules/llm/call-logger', () => ({ logLLMCall: jest.fn() }));
jest.mock('@/modules/database', () => ({ getPrismaClient: () => ({}) }));
jest.mock('@/modules/discover-tracing', () => ({ recordTrace: jest.fn() }));

import { embedBatch } from '../embedding';

/** A fetch whose RESPONSE BODY hangs until the request signal aborts. */
function hangingBodyFetch(): typeof fetch {
  return ((_url: string, init?: RequestInit) => {
    const signal = init?.signal as AbortSignal | undefined;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        new Promise((_resolve, reject) => {
          // never resolves on its own — only the abort signal ends it
          signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        }),
      text: () => Promise.resolve(''),
    } as unknown as Response);
  }) as unknown as typeof fetch;
}

describe('W3 — embed timeout covers the body read', () => {
  jest.setTimeout(30000);

  it('hanging res.json() is aborted by the per-call timer (no zombie); embedBatch null-fills', async () => {
    // Pre-fix the timer was cleared after HEADERS, so a hanging body ran
    // forever (the 86s/102.8s zombie class). Post-fix the timer covers the
    // body read: every retry/fallback attempt aborts at timeoutMs and
    // embedBatch settles with nulls instead of hanging.
    const t0 = Date.now();
    const out = await embedBatch(['text-a'], {
      fetchImpl: hangingBodyFetch(),
      timeoutMs: 200,
    });
    expect(out).toEqual([null]); // chunk failed, swallowed by design
    expect(Date.now() - t0).toBeLessThan(15000); // retries+fallback, all timed
  });

  it('external pipeline abort is TERMINAL — no retries, no provider fallback', async () => {
    const ac = new AbortController();
    const t0 = Date.now();
    const pending = embedBatch(['text-a'], {
      fetchImpl: hangingBodyFetch(),
      signal: ac.signal,
      // generous per-call timer so ONLY the external abort can end it fast
      timeoutMs: 20000,
    });
    setTimeout(() => ac.abort(), 50);
    const out = await pending;
    expect(out).toEqual([null]);
    // well under timeoutMs and any retry chain — abort was terminal
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
