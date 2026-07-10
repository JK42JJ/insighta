/**
 * embedBatch — serving-scope fast budget + lexical-downgrade counter
 * (P0 2026-07-10 incident).
 *
 * The serving/precompute discover path passes maxRetries: 0 so a slow / 404
 * OpenRouter chunk is a hard timeout cap (not timeout x 3) and fails fast to
 * lexical. servingScope: true counts each downgrade (some inputs null) so ops
 * can alarm before the service silently runs all-lexical. These pin:
 *  - maxRetries: 0 → exactly ONE OpenRouter attempt (default is 3).
 *  - both providers dead + servingScope → per-chunk null (never throws) AND
 *    the downgrade counter increments (premise ③: 404→null is handled).
 *  - no servingScope / full success → counter unchanged.
 */

const mockConfig = {
  iksEmbed: { provider: 'openrouter' as 'openrouter' | 'ollama' },
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

import { embedBatch, getEmbedServingDowngradeCount } from '@/skills/plugins/iks-scorer/embedding';

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

const ollamaOk = (n: number): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ embeddings: Array.from({ length: n }, () => vec()) }),
  }) as unknown as Response;

const httpErr = (status: number): Response =>
  ({ ok: false, status, text: async () => `${status} error` }) as unknown as Response;

beforeEach(() => {
  mockConfig.iksEmbed.provider = 'openrouter';
});

describe('embedBatch — serving-scope fast timeout + downgrade counter', () => {
  test('maxRetries: 0 → OpenRouter attempted exactly once on a persistent 404 (no retry)', async () => {
    const orCalls: string[] = [];
    const ollamaCalls: string[] = [];
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.includes('/embeddings')) {
        orCalls.push(url);
        return httpErr(404);
      }
      ollamaCalls.push(url);
      return ollamaOk(2);
    }) as unknown as typeof fetch;

    const out = await embedBatch(['a', 'b'], { fetchImpl, maxRetries: 0 });

    expect(out).toHaveLength(2);
    expect(orCalls).toHaveLength(1); // default would be 3 (initial + 2 retries)
    expect(ollamaCalls).toHaveLength(1); // fast fall-through to the fallback leg
  });

  test('servingScope + both providers fail → per-chunk null (no throw) + downgrade counter increments', async () => {
    const before = getEmbedServingDowngradeCount();
    const fetchImpl = jest.fn(async (url: string) =>
      url.includes('/embeddings') ? httpErr(404) : httpErr(500)
    ) as unknown as typeof fetch;

    const out = await embedBatch(['a', 'b'], { fetchImpl, maxRetries: 0, servingScope: true });

    expect(out).toEqual([null, null]); // lexical downgrade, NOT a throw / 0 cards upstream
    expect(getEmbedServingDowngradeCount()).toBe(before + 1);
  });

  test('no servingScope → counter NOT incremented even when the chunk fails', async () => {
    const before = getEmbedServingDowngradeCount();
    const fetchImpl = jest.fn(async (url: string) =>
      url.includes('/embeddings') ? httpErr(404) : httpErr(500)
    ) as unknown as typeof fetch;

    await embedBatch(['a', 'b'], { fetchImpl, maxRetries: 0 });

    expect(getEmbedServingDowngradeCount()).toBe(before);
  });

  test('servingScope + full success → counter unchanged (healthy path pays nothing)', async () => {
    const before = getEmbedServingDowngradeCount();
    const fetchImpl = jest.fn(async () => openRouterOk(2)) as unknown as typeof fetch;

    const out = await embedBatch(['a', 'b'], { fetchImpl, servingScope: true });

    expect(out.every((v) => v !== null)).toBe(true);
    expect(getEmbedServingDowngradeCount()).toBe(before);
  });

  test('default (no maxRetries) still does the full 3-attempt retry — bulk path unchanged', async () => {
    const orCalls: string[] = [];
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.includes('/embeddings')) {
        orCalls.push(url);
        return httpErr(404);
      }
      return ollamaOk(2);
    }) as unknown as typeof fetch;

    await embedBatch(['a', 'b'], { fetchImpl });

    expect(orCalls).toHaveLength(3); // initial + 2 retries (OPENROUTER_EMBED_MAX_RETRIES)
  });
});
