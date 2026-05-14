/**
 * embedBatch — OpenRouter transient-404 retry + Ollama fallback (CP458).
 *
 * OpenRouter's /embeddings endpoint returns an intermittent ~11% HTTP 404
 * (measured: 8 err / 71 calls in 12h). A single un-retried 404 on any chunk
 * used to fail the entire embedBatch — promote-from-playlists imported 197
 * rows with 0 embeddings because one of its 4 chunks hit the 404.
 *
 * These tests pin: retry on transient (404/5xx/network), no retry on
 * deterministic (4xx-other), and Ollama fallback once retries are exhausted.
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

describe('embedBatch — OpenRouter transient-404 retry + Ollama fallback', () => {
  it('retries a transient 404 and succeeds on the next attempt', async () => {
    const orCalls: string[] = [];
    const fetchImpl = jest.fn(async (url: string) => {
      if (!url.includes('/embeddings')) return ollamaOk(2);
      orCalls.push(url);
      return orCalls.length === 1 ? httpErr(404) : openRouterOk(2);
    }) as unknown as typeof fetch;

    const out = await embedBatch(['a', 'b'], { fetchImpl });

    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(DIM);
    expect(orCalls).toHaveLength(2); // 1 transient 404 + 1 successful retry
  });

  it('does NOT retry a deterministic 400 — falls straight to Ollama', async () => {
    const orCalls: string[] = [];
    const ollamaCalls: string[] = [];
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.includes('/embeddings')) {
        orCalls.push(url);
        return httpErr(400);
      }
      ollamaCalls.push(url);
      return ollamaOk(2);
    }) as unknown as typeof fetch;

    const out = await embedBatch(['a', 'b'], { fetchImpl });

    expect(out).toHaveLength(2);
    expect(orCalls).toHaveLength(1); // 400 is non-retryable — exactly one attempt
    expect(ollamaCalls).toHaveLength(1); // then Ollama fallback
  });

  it('exhausts retries on persistent 404 then falls back to Ollama', async () => {
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

    const out = await embedBatch(['a', 'b'], { fetchImpl });

    expect(out).toHaveLength(2);
    expect(orCalls).toHaveLength(3); // initial + 2 retries (OPENROUTER_EMBED_MAX_RETRIES)
    expect(ollamaCalls).toHaveLength(1); // fallback after exhaustion
  });

  it('returns null slots when OpenRouter retries exhaust AND the Ollama fallback also fails', async () => {
    const fetchImpl = jest.fn(async (url: string) =>
      url.includes('/embeddings') ? httpErr(404) : httpErr(500)
    ) as unknown as typeof fetch;

    // per-chunk isolation (CP458): both providers fail → the chunk's inputs
    // become null and embedBatch returns rather than throwing.
    const out = await embedBatch(['a', 'b'], { fetchImpl });
    expect(out).toEqual([null, null]);
  });

  it('ollama-provider branch: Ollama down → OpenRouter fallback also retries transient 404', async () => {
    mockConfig.iksEmbed.provider = 'ollama';
    const orCalls: string[] = [];
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.includes('/api/embed')) return httpErr(500); // Mac Mini Ollama down
      orCalls.push(url);
      return orCalls.length === 1 ? httpErr(404) : openRouterOk(2);
    }) as unknown as typeof fetch;

    const out = await embedBatch(['a', 'b'], { fetchImpl });

    expect(out).toHaveLength(2);
    expect(orCalls).toHaveLength(2); // fallback path retries the transient 404 too
  });
});
