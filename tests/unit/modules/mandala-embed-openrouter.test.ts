/**
 * Phase 1 (2026-04-22) — OpenRouter embedding provider smoke tests.
 *
 * Pins the contract between `embedGoalForMandala` and the OpenRouter
 * `/embeddings` endpoint: request shape, response parse, auth-missing,
 * HTTP 401 / 429 / 5xx routes to MandalaSearchError codes, dim-mismatch
 * guard, and provider-switch default (ollama keeps the legacy path
 * untouched).
 *
 * Per CLAUDE.md Hard Rule on LLM API usage, this test must NEVER make
 * a real OpenRouter call. The `src/config` module is statically mocked
 * via a jest-controlled object so process.env (which may carry a real
 * API key from a developer's .env) cannot leak into the call path; the
 * global `fetch` is also spied on in every case so a real network call
 * is impossible.
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
  // Lazy reference — jest.mock factory is evaluated before mockConfig is
  // assigned, so we use a getter proxy that resolves to mockConfig at
  // access time. Per-test mutations of mockConfig.mandalaEmbed.provider
  // must reach the module under test.
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

afterEach(() => {
  jest.restoreAllMocks();
  mockConfig.mandalaEmbed.provider = 'openrouter';
  mockConfig.mandalaEmbed.openRouterBaseUrl = 'https://openrouter.test/api/v1';
  mockConfig.mandalaEmbed.openRouterModel = 'qwen/qwen3-embedding-8b';
  mockConfig.mandalaEmbed.openRouterDimension = 4096;
  mockConfig.openrouter.apiKey = 'test-key';
});

describe('embedGoalForMandala (Phase 1 provider switch)', () => {
  it('routes via Ollama when provider=ollama', async () => {
    mockConfig.mandalaEmbed.provider = 'ollama';

    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ embeddings: [Array(4096).fill(0.001)] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const vec = await embedGoalForMandala('test goal');
    expect(vec).toHaveLength(4096);

    const calledUrl = fetchSpy.mock.calls[0]?.[0];
    expect(String(calledUrl)).toContain('ollama.local:11434');
    expect(String(calledUrl)).toContain('/api/embed');
  });

  it('routes via OpenRouter when provider=openrouter', async () => {
    mockConfig.mandalaEmbed.provider = 'openrouter';
    mockConfig.openrouter.apiKey = 'test-key-opaque';

    const vector = Array(4096).fill(0.01);
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: vector }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const vec = await embedGoalForMandala('단백질이 풍부한 식단 설계하기');
    expect(vec).toHaveLength(4096);

    const req = fetchSpy.mock.calls[0];
    expect(String(req?.[0])).toBe('https://openrouter.test/api/v1/embeddings');

    const init = req?.[1] as RequestInit | undefined;
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-key-opaque');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('qwen/qwen3-embedding-8b');
    expect(body.input).toBe('단백질이 풍부한 식단 설계하기');
    expect(body.encoding_format).toBe('float');
  });

  it('throws SERVICE_UNAVAILABLE when OPENROUTER_API_KEY missing', async () => {
    mockConfig.openrouter.apiKey = undefined;

    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network should not be reached'));

    await expect(embedGoalForMandala('goal')).rejects.toMatchObject({
      name: 'MandalaSearchError',
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps HTTP 401 from OpenRouter to SERVICE_UNAVAILABLE', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('unauthorized', { status: 401 }));

    await expect(embedGoalForMandala('goal')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('maps HTTP 429 from OpenRouter to RATE_LIMITED', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('rate limited', { status: 429 }));

    await expect(embedGoalForMandala('goal')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('maps HTTP 5xx from OpenRouter to SERVICE_UNAVAILABLE', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('upstream fail', { status: 502 }));

    await expect(embedGoalForMandala('goal')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('throws DIMENSION_MISMATCH when returned vector dim differs from config', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: Array(1024).fill(0.1) }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(embedGoalForMandala('goal')).rejects.toMatchObject({
      code: 'DIMENSION_MISMATCH',
    });
  });

  it('throws EMBED_FAILED on empty response data', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(embedGoalForMandala('goal')).rejects.toMatchObject({
      code: 'EMBED_FAILED',
    });
  });
});
