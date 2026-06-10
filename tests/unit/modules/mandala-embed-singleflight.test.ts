/**
 * CP499+ — goal-embed single-flight + body-read timeout regression tests.
 *
 * Prod repro 2026-06-10: FE /search-by-goal + wizard-stream fired the same
 * goal in the same instant; both missed the goal-embed cache and raced two
 * identical OpenRouter embeds. One returned in 2.5s, the other stalled ~85s —
 * past the FE 15s abort AND past the 30s EMBED_TIMEOUT_MS, because
 * clearTimeout ran when fetch() resolved (headers) leaving response.json()
 * (body download) unguarded.
 *
 * Pins three behaviours:
 *   1. concurrent cold-key callers share ONE underlying fetch (single-flight)
 *   2. a failed embed is NOT cached — the next call fires a fresh fetch
 *   3. the 30s abort covers the body read (stalled json() → TIMEOUT)
 *
 * Per CLAUDE.md Hard Rule on LLM API usage, this test must NEVER make a real
 * OpenRouter call — config is statically mocked and global fetch is spied in
 * every case. Each test uses a UNIQUE goal string: the module-level
 * goalEmbedCache + inflight map are intentionally not reset between cases.
 */

interface TestConfig {
  mandalaEmbed: {
    provider: 'ollama' | 'openrouter';
    openRouterBaseUrl: string;
    openRouterModel: string;
    openRouterDimension: number;
  };
  mandalaGen: {
    url: string;
    model: string;
    embedModel: string;
    embedDimension: number;
  };
  openrouter: {
    apiKey: string | undefined;
    model: string;
  };
}

const mockConfig: TestConfig = {
  mandalaEmbed: {
    provider: 'openrouter',
    openRouterBaseUrl: 'https://openrouter.test/api/v1',
    openRouterModel: 'qwen/qwen3-embedding-8b',
    openRouterDimension: 4096,
  },
  mandalaGen: {
    url: 'http://ollama.local:11434',
    model: 'mandala-gen',
    embedModel: 'qwen3-embedding:8b',
    embedDimension: 4096,
  },
  openrouter: {
    apiKey: 'test-key',
    model: 'qwen/qwen3-30b-a3b',
  },
};

jest.mock('../../../src/config', () => {
  return {
    config: new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'mandalaEmbed') return mockConfig.mandalaEmbed;
          if (prop === 'mandalaGen') return mockConfig.mandalaGen;
          if (prop === 'openrouter') return mockConfig.openrouter;
          if (prop === 'database')
            return { url: 'postgresql://test:test@localhost:5432/test', directUrl: undefined };
          if (prop === 'app')
            return {
              env: 'test',
              isDevelopment: false,
              isProduction: false,
              isTest: true,
              logLevel: 'silent',
            };
          if (prop === 'supabase')
            return { url: '', anonKey: '', serviceRoleKey: '', jwtSecret: '' };
          return undefined;
        },
      }
    ),
  };
});

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({}),
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { embedGoalForMandala } from '../../../src/modules/mandala/search';

const VEC = Array(4096).fill(0.001);

function okEmbedResponse(): Response {
  return new Response(JSON.stringify({ data: [{ embedding: VEC }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('embedGoalForMandala single-flight (CP499+)', () => {
  it('concurrent cold-key callers share ONE underlying fetch', async () => {
    let resolveFetch: (r: Response) => void = () => {};
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    // Fire the FE-search + merged-gen pair: same goal, same instant, no await.
    const p1 = embedGoalForMandala('singleflight concurrent goal');
    const p2 = embedGoalForMandala('singleflight concurrent goal');

    // Both callers are queued before the provider responds.
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resolveFetch(okEmbedResponse());
    const [v1, v2] = await Promise.all([p1, p2]);
    expect(v1).toHaveLength(4096);
    expect(v2).toHaveLength(4096);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Post-resolve caller hits the value cache — still no second fetch.
    const v3 = await embedGoalForMandala('singleflight concurrent goal');
    expect(v3).toHaveLength(4096);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a failed embed is NOT cached — the next call fires a fresh fetch', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(okEmbedResponse());

    await expect(embedGoalForMandala('singleflight retry goal')).rejects.toMatchObject({
      code: 'EMBED_FAILED',
    });

    // The inflight entry must be gone — retry reaches the provider again.
    const vec = await embedGoalForMandala('singleflight retry goal');
    expect(vec).toHaveLength(4096);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('the 30s abort covers the body read — stalled json() rejects with TIMEOUT', async () => {
    jest.useFakeTimers();

    // Headers arrive instantly; the BODY never does. Pre-fix, clearTimeout
    // ran on fetch-resolve and this json() hung unbounded (~86s prod repro).
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal;
      return {
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
            );
          }),
      } as unknown as Response;
    });

    const pending = embedGoalForMandala('singleflight body stall goal');
    const assertion = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });

    await jest.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});
