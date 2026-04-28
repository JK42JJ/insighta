/**
 * Tests for embedBatch OpenRouter fallback (Issue #543).
 *
 * Verifies the provider router in embedOneChunk:
 *   IKS_EMBED_PROVIDER=openrouter → skip Ollama, go straight to OpenRouter
 *   IKS_EMBED_PROVIDER=ollama     → try Ollama; on fetch/HTTP error, auto
 *                                   fall back to OpenRouter same-model
 *
 * Why this exists: 2026-04-28 prod incident — Mac mini Ollama down →
 * pipeline-runner step1 (ensureMandalaEmbeddings) threw → step2/3 skipped
 * → maybeAutoAddRecommendations never called → user_video_states empty
 * while recommendation_cache had 74 cards. The fallback restores the
 * step1 success path so step2/3 (auto-add) run normally.
 */

const FAKE_OLLAMA_VECTOR = new Array(4096).fill(0.1);
const FAKE_OPENROUTER_VECTOR = new Array(4096).fill(0.2);

// ─── Mocks (declared before importing module under test) ────────────────────

// logger.ts touches config.paths.logs at import — stub before any deeper
// imports to avoid the file-transport bootstrap.
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

const logLLMCallMock = jest.fn().mockResolvedValue(undefined);
jest.mock('@/modules/llm/call-logger', () => ({
  logLLMCall: logLLMCallMock,
}));

// embedding.ts also imports prisma — stub to no-op.
jest.mock('@/modules/database', () => ({
  getPrismaClient: () => ({}),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeOllamaResponse(count: number, vector: number[] = FAKE_OLLAMA_VECTOR): Response {
  const embeddings = Array.from({ length: count }, () => vector);
  return new Response(JSON.stringify({ embeddings }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeOpenRouterResponse(
  count: number,
  vector: number[] = FAKE_OPENROUTER_VECTOR
): Response {
  const data = Array.from({ length: count }, () => ({ embedding: vector }));
  return new Response(JSON.stringify({ data, usage: { prompt_tokens: 10 } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeErrorResponse(status: number, body = 'server error'): Response {
  return new Response(body, { status });
}

// ─── Import after mocks ─────────────────────────────────────────────────────

import { embedBatch, EmbeddingError } from '../embedding';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('embedBatch — IKS_EMBED_PROVIDER fallback (Issue #543)', () => {
  beforeEach(() => {
    configMock.iksEmbed.provider = 'ollama';
    logLLMCallMock.mockClear();
  });

  it('provider=ollama: ollama success → no OpenRouter call', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(makeOllamaResponse(2));

    const out = await embedBatch(['t1', 't2'], { fetchImpl });

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(FAKE_OLLAMA_VECTOR);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url0 = fetchImpl.mock.calls[0]?.[0] as string;
    expect(url0).toContain('/api/embed'); // Ollama endpoint
    expect(url0).not.toContain('openrouter.ai');
    expect(logLLMCallMock).not.toHaveBeenCalled();
  });

  it('provider=ollama: ollama fetch throws → OpenRouter fallback success', async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(makeOpenRouterResponse(2));

    const out = await embedBatch(['t1', 't2'], { fetchImpl });

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(FAKE_OPENROUTER_VECTOR);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const url1 = fetchImpl.mock.calls[1]?.[0] as string;
    expect(url1).toContain('openrouter.ai/api/v1/embeddings');
    // Cost tracking fired exactly once for the successful OpenRouter call
    expect(logLLMCallMock).toHaveBeenCalledTimes(1);
    const callArg = logLLMCallMock.mock.calls[0]?.[0] as { status: string; module: string };
    expect(callArg.status).toBe('success');
    expect(callArg.module).toBe('iks-embed-fallback');
  });

  it('provider=ollama: ollama HTTP 500 → OpenRouter fallback success', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(makeErrorResponse(500))
      .mockResolvedValueOnce(makeOpenRouterResponse(1));

    const out = await embedBatch(['t1'], { fetchImpl });

    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(FAKE_OPENROUTER_VECTOR);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('provider=ollama: ollama fail + OpenRouter fail → throw EmbeddingError', async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(makeErrorResponse(429, 'rate limited'));

    await expect(embedBatch(['t1'], { fetchImpl })).rejects.toBeInstanceOf(EmbeddingError);
    // logLLMCall fired with status=error for the failed OpenRouter attempt
    expect(logLLMCallMock).toHaveBeenCalledTimes(1);
    const callArg = logLLMCallMock.mock.calls[0]?.[0] as { status: string };
    expect(callArg.status).toBe('error');
  });

  it('provider=openrouter: skip ollama entirely — OpenRouter only', async () => {
    configMock.iksEmbed.provider = 'openrouter';
    const fetchImpl = jest.fn().mockResolvedValueOnce(makeOpenRouterResponse(2));

    const out = await embedBatch(['t1', 't2'], { fetchImpl });

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(FAKE_OPENROUTER_VECTOR);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url0 = fetchImpl.mock.calls[0]?.[0] as string;
    expect(url0).toContain('openrouter.ai');
  });

  it('OpenRouter dimension mismatch → throws (no silent acceptance)', async () => {
    const wrongDim = new Array(2048).fill(0.5);
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(makeOpenRouterResponse(1, wrongDim));

    await expect(embedBatch(['t1'], { fetchImpl })).rejects.toBeInstanceOf(EmbeddingError);
  });
});
