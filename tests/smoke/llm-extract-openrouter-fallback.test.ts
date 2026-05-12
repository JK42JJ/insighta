/**
 * Unit tests — trend-collector llm-extract.ts OpenRouter fallback path
 * (Mac Mini deprecation Phase D1-b, 2026-05-13).
 *
 * Verifies the dispatcher contract:
 *   provider='ollama' (default) → Ollama first, OpenRouter fallback on failure
 *   provider='openrouter'       → skip Ollama, OpenRouter only
 *   no OpenRouter API key       → no fallback, rethrow Ollama error
 *
 * The actual HTTP layer is mocked via fetchImpl injection.
 */

import {
  extractKeywordsBatch,
  LlmExtractError,
  type ExtractedKeyword,
  type ExtractKeywordsOptions,
} from '@/skills/plugins/trend-collector/sources/llm-extract';

/**
 * Build a mock fetch that produces a successful Ollama-shape response.
 * Echoes 1 keyword per title with constant learning_score.
 */
function makeOllamaOkFetch(titles: string[]): typeof fetch {
  return (async (_url: unknown) => {
    const results = titles.map((t) => ({
      title: t,
      keywords: [`kw-${t}`],
      learning_score: 0.6,
    }));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        message: { content: JSON.stringify({ results }) },
      }),
    } as Response;
  }) as unknown as typeof fetch;
}

/** Mock fetch that produces a successful OpenRouter-shape response. */
function makeOpenRouterOkFetch(titles: string[]): typeof fetch {
  return (async (_url: unknown) => {
    const results = titles.map((t) => ({
      title: t,
      keywords: [`or-${t}`],
      learning_score: 0.7,
    }));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ results }) } }],
      }),
    } as Response;
  }) as unknown as typeof fetch;
}

/** Mock fetch that fails with a transport error for the FIRST call, succeeds after. */
function makeFailThenSucceedFetch(titles: string[]): typeof fetch {
  let calls = 0;
  return (async (_url: unknown) => {
    calls += 1;
    if (calls === 1) {
      // Simulate Ollama unreachable (e.g. Tailscale down).
      throw new Error('ECONNREFUSED');
    }
    // Second call = OpenRouter — return OR-shape response.
    const results = titles.map((t) => ({
      title: t,
      keywords: [`or-${t}`],
      learning_score: 0.7,
    }));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ results }) } }],
      }),
    } as Response;
  }) as unknown as typeof fetch;
}

/** Mock fetch that always fails — no recovery. */
function makeAlwaysFailFetch(): typeof fetch {
  return (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
}

describe('llm-extract OpenRouter fallback', () => {
  const titles = ['파이썬 입문 강의', 'AI 동향 정리'];

  describe("provider='openrouter' — skip Mac Mini", () => {
    it('calls OpenRouter only when provider is openrouter + API key present', async () => {
      const opts: ExtractKeywordsOptions = {
        titles,
        provider: 'openrouter',
        openRouterApiKey: 'sk-or-test',
        fetchImpl: makeOpenRouterOkFetch(titles),
      };
      const out: ExtractedKeyword[] = await extractKeywordsBatch(opts);
      expect(out).toHaveLength(2);
      expect(out[0]!.keywords).toEqual(['or-파이썬 입문 강의']);
      expect(out[1]!.keywords).toEqual(['or-AI 동향 정리']);
    });

    it('throws when provider=openrouter but no API key', async () => {
      const opts: ExtractKeywordsOptions = {
        titles,
        provider: 'openrouter',
        openRouterApiKey: '',
        fetchImpl: makeOpenRouterOkFetch(titles),
      };
      await expect(extractKeywordsBatch(opts)).rejects.toThrow(LlmExtractError);
    });
  });

  describe("provider='ollama' (default) — Mac Mini first, OpenRouter fallback", () => {
    it('uses Ollama when Ollama succeeds (no OpenRouter call)', async () => {
      const opts: ExtractKeywordsOptions = {
        titles,
        provider: 'ollama',
        fetchImpl: makeOllamaOkFetch(titles),
      };
      const out = await extractKeywordsBatch(opts);
      // Ollama's mock prefixes with 'kw-', OpenRouter's with 'or-'.
      expect(out[0]!.keywords).toEqual(['kw-파이썬 입문 강의']);
    });

    it('falls back to OpenRouter when Ollama throws + API key present', async () => {
      const opts: ExtractKeywordsOptions = {
        titles,
        provider: 'ollama',
        openRouterApiKey: 'sk-or-test',
        fetchImpl: makeFailThenSucceedFetch(titles),
      };
      const out = await extractKeywordsBatch(opts);
      // Result came from OpenRouter — prefix 'or-'.
      expect(out[0]!.keywords).toEqual(['or-파이썬 입문 강의']);
    });

    it('rethrows Ollama error when no OpenRouter API key', async () => {
      const opts: ExtractKeywordsOptions = {
        titles,
        provider: 'ollama',
        openRouterApiKey: '',
        fetchImpl: makeAlwaysFailFetch(),
      };
      await expect(extractKeywordsBatch(opts)).rejects.toThrow(LlmExtractError);
    });
  });

  describe('env-based provider resolution', () => {
    const prev = process.env['TREND_EXTRACT_PROVIDER'];
    afterEach(() => {
      if (prev === undefined) delete process.env['TREND_EXTRACT_PROVIDER'];
      else process.env['TREND_EXTRACT_PROVIDER'] = prev;
    });

    it('TREND_EXTRACT_PROVIDER=openrouter routes through OpenRouter', async () => {
      process.env['TREND_EXTRACT_PROVIDER'] = 'openrouter';
      const opts: ExtractKeywordsOptions = {
        titles,
        openRouterApiKey: 'sk-or-test',
        fetchImpl: makeOpenRouterOkFetch(titles),
      };
      const out = await extractKeywordsBatch(opts);
      expect(out[0]!.keywords).toEqual(['or-파이썬 입문 강의']);
    });

    it('TREND_EXTRACT_PROVIDER absent defaults to ollama (Mac Mini)', async () => {
      delete process.env['TREND_EXTRACT_PROVIDER'];
      const opts: ExtractKeywordsOptions = {
        titles,
        fetchImpl: makeOllamaOkFetch(titles),
      };
      const out = await extractKeywordsBatch(opts);
      expect(out[0]!.keywords).toEqual(['kw-파이썬 입문 강의']);
    });
  });
});
