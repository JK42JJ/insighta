/**
 * embedBatch — OpenRouter provider-ignore body assembly (P0 2026-07-11).
 *
 * DeepInfra (one of 3 providers OpenRouter routes qwen3-embedding-8b to)
 * started hanging 25s+; OPENROUTER_EMBED_IGNORE_PROVIDERS skips it at the
 * request level. Pins: env set → body carries provider.ignore; unset → NO
 * provider field at all (byte-level legacy request shape).
 */

const mockConfig = {
  iksEmbed: { provider: 'openrouter' as const },
  openrouter: { apiKey: 'test-key' },
  mandalaEmbed: {
    openRouterBaseUrl: 'https://openrouter.test/api/v1',
    openRouterModel: 'qwen/qwen3-embedding-8b',
    openRouterDimension: 4096,
  },
};

jest.mock('@/config/index', () => ({ config: mockConfig }));
jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  },
}));
jest.mock('@/modules/llm/call-logger', () => ({ logLLMCall: jest.fn() }));
jest.mock('@/modules/discover-tracing', () => ({ recordTrace: jest.fn() }));
jest.mock('@/modules/database', () => ({ getPrismaClient: jest.fn() }));

import { embedBatch } from '@/skills/plugins/iks-scorer/embedding';

const DIM = 4096;
const vec = (): number[] => new Array(DIM).fill(0.01);
const openRouterOk = (n: number): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({
      data: Array.from({ length: n }, () => ({ embedding: vec() })),
      usage: {},
    }),
  }) as unknown as Response;

const ENV_KEY = 'OPENROUTER_EMBED_IGNORE_PROVIDERS';

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe('embedBatch — OpenRouter provider ignore', () => {
  test('env set → request body carries provider.ignore', async () => {
    process.env[ENV_KEY] = 'DeepInfra';
    const bodies: unknown[] = [];
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return openRouterOk(2);
    }) as unknown as typeof fetch;

    const out = await embedBatch(['a', 'b'], { fetchImpl });

    expect(out).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ provider: { ignore: ['DeepInfra'] } });
  });

  test('env unset → NO provider field (legacy request shape)', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return openRouterOk(1);
    }) as unknown as typeof fetch;

    await embedBatch(['a'], { fetchImpl });

    expect(bodies[0]).not.toHaveProperty('provider');
    expect(bodies[0]).toMatchObject({ model: 'qwen/qwen3-embedding-8b', input: ['a'] });
  });

  test('multiple ignored providers pass through comma-parsed', async () => {
    process.env[ENV_KEY] = 'DeepInfra, SomeOther';
    const bodies: unknown[] = [];
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return openRouterOk(1);
    }) as unknown as typeof fetch;

    await embedBatch(['a'], { fetchImpl });

    expect(bodies[0]).toMatchObject({ provider: { ignore: ['DeepInfra', 'SomeOther'] } });
  });
});
