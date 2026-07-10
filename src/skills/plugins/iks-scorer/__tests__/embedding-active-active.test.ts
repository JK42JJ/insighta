/**
 * Tests for embedBatch active-active hedge (P0 follow-up 2026-07-10).
 *
 * Verifies the hedge in embedOneChunkHedged (flag EMBED_ACTIVE_ACTIVE_ENABLED):
 *   - healthy Ollama settles first → OpenRouter NEVER called (no 2× cost);
 *   - Ollama rejects fast → OpenRouter fired immediately → success;
 *   - Ollama slow (> hedge window) → OpenRouter fired in parallel → wins;
 *   - both providers dead → null slot, no throw (CP458 per-chunk isolation).
 *
 * Why: the Mac Mini Ollama SPOF took card serving to 0 ("Compute error").
 * The hedge removes the SPOF while a fast, healthy Ollama pays no OpenRouter.
 */

const FAKE_OLLAMA_VECTOR = new Array(4096).fill(0.1);
const FAKE_OPENROUTER_VECTOR = new Array(4096).fill(0.2);

const noopFn = jest.fn();
const noopLogger = {
  info: noopFn,
  warn: noopFn,
  error: noopFn,
  debug: noopFn,
  child: () => noopLogger,
};
jest.mock('@/utils/logger', () => ({ logger: noopLogger }));

const configMock = {
  iksEmbed: { provider: 'ollama' as 'ollama' | 'openrouter' },
  openrouter: { apiKey: 'test-openrouter-key' },
  mandalaEmbed: {
    openRouterBaseUrl: 'https://openrouter.ai/api/v1',
    openRouterModel: 'qwen/qwen3-embedding-8b',
    openRouterDimension: 4096,
  },
};
jest.mock('@/config/index', () => ({
  get config() {
    return configMock;
  },
}));

// Active-active ON, tiny hedge window so the "slow" case is fast in tests.
const aaMock = { enabled: true, hedgeMs: 30 };
jest.mock('@/config/embed-active-active', () => ({
  isEmbedActiveActiveEnabled: () => aaMock.enabled,
  getEmbedHedgeMs: () => aaMock.hedgeMs,
}));

jest.mock('@/modules/llm/call-logger', () => ({
  logLLMCall: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/modules/database', () => ({ getPrismaClient: () => ({}) }));
jest.mock('@/modules/discover-tracing', () => ({ recordTrace: jest.fn() }));

function ollamaOk(count: number): Response {
  return new Response(
    JSON.stringify({ embeddings: Array.from({ length: count }, () => FAKE_OLLAMA_VECTOR) }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
function openrouterOk(count: number): Response {
  return new Response(
    JSON.stringify({
      data: Array.from({ length: count }, () => ({ embedding: FAKE_OPENROUTER_VECTOR })),
      usage: { prompt_tokens: 10 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
const isOllama = (url: string) => url.includes('/api/embed');

import { embedBatch } from '../embedding';

describe('embedBatch — active-active hedge', () => {
  beforeEach(() => {
    configMock.iksEmbed.provider = 'ollama';
    aaMock.enabled = true;
    aaMock.hedgeMs = 30;
  });

  it('healthy Ollama settles first → OpenRouter never called', async () => {
    const fetchImpl = jest.fn(async (url: RequestInfo | URL) =>
      isOllama(String(url)) ? ollamaOk(2) : openrouterOk(2)
    );
    const out = await embedBatch(['t1', 't2'], { fetchImpl });
    expect(out[0]).toEqual(FAKE_OLLAMA_VECTOR);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls.every((c) => isOllama(String(c[0])))).toBe(true);
  });

  it('Ollama rejects fast → OpenRouter fired immediately → success', async () => {
    const fetchImpl = jest.fn(async (url: RequestInfo | URL) => {
      if (isOllama(String(url))) throw new TypeError('fetch failed');
      return openrouterOk(2);
    });
    const out = await embedBatch(['t1', 't2'], { fetchImpl });
    expect(out[0]).toEqual(FAKE_OPENROUTER_VECTOR);
    expect(fetchImpl.mock.calls.some((c) => !isOllama(String(c[0])))).toBe(true);
  });

  it('Ollama slow (> hedge window) → OpenRouter wins', async () => {
    const fetchImpl = jest.fn((url: RequestInfo | URL) => {
      if (isOllama(String(url)))
        return new Promise<Response>((r) => setTimeout(() => r(ollamaOk(1)), 300));
      return Promise.resolve(openrouterOk(1));
    });
    const out = await embedBatch(['t1'], { fetchImpl });
    expect(out[0]).toEqual(FAKE_OPENROUTER_VECTOR);
    expect(fetchImpl.mock.calls.some((c) => !isOllama(String(c[0])))).toBe(true);
  });

  it('both providers dead → null slot, no throw (per-chunk isolation)', async () => {
    const fetchImpl = jest.fn(async (url: RequestInfo | URL) => {
      if (isOllama(String(url))) throw new TypeError('ollama down');
      throw new TypeError('openrouter down');
    });
    const out = await embedBatch(['t1'], { fetchImpl });
    expect(out).toEqual([null]);
  });

  it('flag off → sequential fallback (Ollama success, no OpenRouter)', async () => {
    aaMock.enabled = false;
    const fetchImpl = jest.fn(async (url: RequestInfo | URL) =>
      isOllama(String(url)) ? ollamaOk(1) : openrouterOk(1)
    );
    const out = await embedBatch(['t1'], { fetchImpl });
    expect(out[0]).toEqual(FAKE_OLLAMA_VECTOR);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
