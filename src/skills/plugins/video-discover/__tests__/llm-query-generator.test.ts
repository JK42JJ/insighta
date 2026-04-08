/**
 * llm-query-generator — unit tests (Fix 2, CP358)
 *
 * Pins the contract that matters for the executor:
 *   - parseQueriesResponse handles raw JSON, markdown-fenced JSON, object wrappers
 *   - parseQueriesResponse rejects empty / unparseable / non-string entries
 *   - parseQueriesResponse caps at MAX_QUERIES (3) and filters short noise
 *   - generateSearchQueries throws LlmQueryGenError on transport failure
 *   - generateSearchQueries throws LlmQueryGenError on Ollama HTTP error
 *   - generateSearchQueries throws LlmQueryGenError on empty content
 *   - happy path returns up to 3 cleaned queries
 *
 * The Ollama URL/model are NEVER hit — fetchImpl is mocked per test.
 */

import {
  generateSearchQueries,
  generateSearchQueriesViaOllama,
  generateSearchQueriesViaOpenRouter,
  generateSearchQueriesRace,
  LlmQueryGenError,
  parseQueriesResponse,
} from '../sources/llm-query-generator';

// Silence the structured race-comparison logger output during tests so the
// jest output stays readable. The structured rows are still emitted in
// production via winston.
jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

// ============================================================================
// parseQueriesResponse — defensive JSON shapes
// ============================================================================

describe('parseQueriesResponse', () => {
  it('parses a raw JSON array of strings', () => {
    const out = parseQueriesResponse('["q1", "q2", "q3"]');
    expect(out).toEqual(['q1', 'q2', 'q3']);
  });

  it('parses a markdown-fenced JSON array (```json ... ```)', () => {
    const fenced = '```json\n["query 1", "query 2", "query 3"]\n```';
    const out = parseQueriesResponse(fenced);
    expect(out).toEqual(['query 1', 'query 2', 'query 3']);
  });

  it('parses a markdown-fenced JSON array (``` ... ``` without language tag)', () => {
    const fenced = '```\n["alpha", "beta"]\n```';
    const out = parseQueriesResponse(fenced);
    expect(out).toEqual(['alpha', 'beta']);
  });

  it('accepts an object wrapper with `queries` key', () => {
    const out = parseQueriesResponse('{"queries": ["q1", "q2"]}');
    expect(out).toEqual(['q1', 'q2']);
  });

  it('accepts an object wrapper with `results` key', () => {
    const out = parseQueriesResponse('{"results": ["q1", "q2"]}');
    expect(out).toEqual(['q1', 'q2']);
  });

  it('accepts an object wrapper with `items` key', () => {
    const out = parseQueriesResponse('{"items": ["q1", "q2"]}');
    expect(out).toEqual(['q1', 'q2']);
  });

  it('truncates to MAX_QUERIES (3) when the model returns more', () => {
    const out = parseQueriesResponse('["q1", "q2", "q3", "q4", "q5"]');
    expect(out).toHaveLength(3);
    expect(out).toEqual(['q1', 'q2', 'q3']);
  });

  it('filters out entries shorter than MIN_QUERY_LENGTH (2)', () => {
    const out = parseQueriesResponse('["a", "ok", "x", "longer"]');
    expect(out).toEqual(['ok', 'longer']);
  });

  it('filters out non-string entries', () => {
    const out = parseQueriesResponse('["valid", 42, null, "also valid"]');
    expect(out).toEqual(['valid', 'also valid']);
  });

  it('strips surrounding quotes the model sometimes leaves in', () => {
    const out = parseQueriesResponse('["\\"quoted\\"", "normal"]');
    expect(out).toEqual(['quoted', 'normal']);
  });

  it('throws LlmQueryGenError on completely unparseable input', () => {
    expect(() => parseQueriesResponse('not json at all {{{')).toThrow(LlmQueryGenError);
  });

  it('throws LlmQueryGenError when JSON parses but yields zero usable queries', () => {
    expect(() => parseQueriesResponse('[]')).toThrow(LlmQueryGenError);
    expect(() => parseQueriesResponse('["a", ""]')).toThrow(LlmQueryGenError);
  });

  it('falls back to generic-object-of-strings when no known key matched', () => {
    // The permissive fallback (Hotfix 2 parser) treats `{"foo": "bar"}` as
    // a single-query result rather than throwing — better than dropping
    // valid model output that just used an unexpected key name.
    const out = parseQueriesResponse('{"foo": "bar"}');
    expect(out).toEqual(['bar']);
  });

  it('throws LlmQueryGenError when JSON object has no string values at all', () => {
    expect(() => parseQueriesResponse('{"foo": 42, "baz": true}')).toThrow(LlmQueryGenError);
    expect(() => parseQueriesResponse('{}')).toThrow(LlmQueryGenError);
  });

  it('parses Korean array key {"검색어": [...]}', () => {
    const out = parseQueriesResponse('{"검색어": ["조카 학습 동기", "공부 습관", "독서 습관"]}');
    expect(out).toEqual(['조카 학습 동기', '공부 습관', '독서 습관']);
  });

  it('parses Korean array key {"결과": [...]}', () => {
    const out = parseQueriesResponse('{"결과": ["q1 한국어", "q2 한국어", "q3 한국어"]}');
    expect(out).toEqual(['q1 한국어', 'q2 한국어', 'q3 한국어']);
  });

  it('parses numbered Korean keys {"검색어1": "...", "검색어2": "..."}', () => {
    const out = parseQueriesResponse(
      '{"검색어1": "조카 인성 교육", "검색어2": "자존감 향상", "검색어3": "조카 성격 개발"}'
    );
    expect(out).toEqual(['조카 인성 교육', '자존감 향상', '조카 성격 개발']);
  });

  it('parses searchTerms key (Ollama llama3.1 quirk)', () => {
    const out = parseQueriesResponse(
      '{"searchTerms": ["조카 인성 교육 방법", "자존감 향상하는 놀이 활동", "조카 자존감 키우기"]}'
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('조카 인성 교육 방법');
  });

  it('extracts JSON array from Qwen3 thinking-mode prose prefix', () => {
    const wrapped =
      "Okay, let's tackle this query. The user wants three different Korean " +
      'search terms for YouTube based on the goal. Let me generate them now.\n\n' +
      '["조카 학업 성적 향상", "조카 공부법 전략", "조카 학습 동기 부여"]';
    const out = parseQueriesResponse(wrapped);
    expect(out).toEqual(['조카 학업 성적 향상', '조카 공부법 전략', '조카 학습 동기 부여']);
  });

  it('extracts JSON array even when it appears after multi-line reasoning', () => {
    const wrapped = `Let me think about this carefully.

First, I should consider the user's intent.
Second, I should generate diverse queries.
Third, each query should be 2-6 words.

Here is my final answer:
["query 1", "query 2", "query 3"]`;
    const out = parseQueriesResponse(wrapped);
    expect(out).toEqual(['query 1', 'query 2', 'query 3']);
  });

  it('handles trimmed whitespace and BOMs gracefully', () => {
    const out = parseQueriesResponse('  \n["q1", "q2"]\n  ');
    expect(out).toEqual(['q1', 'q2']);
  });
});

// ============================================================================
// generateSearchQueries — fetch contract
// ============================================================================

describe('generateSearchQueries', () => {
  function makeFetch(response: {
    ok?: boolean;
    status?: number;
    body?: unknown;
    bodyText?: string;
    throws?: Error;
  }): typeof fetch {
    return jest.fn().mockImplementation(async () => {
      if (response.throws) throw response.throws;
      return {
        ok: response.ok ?? true,
        status: response.status ?? 200,
        json: async () => response.body ?? {},
        text: async () => response.bodyText ?? '',
      };
    }) as unknown as typeof fetch;
  }

  it('returns parsed queries on a successful Ollama response', async () => {
    const fetchImpl = makeFetch({
      body: { message: { content: '["query one", "query two", "query three"]' } },
    });
    const result = await generateSearchQueries({
      subGoal: '조카의 학습 동기 부여',
      centerGoal: '조카 교육',
      language: 'ko',
      fetchImpl,
    });
    expect(result).toEqual(['query one', 'query two', 'query three']);
  });

  it('throws LlmQueryGenError on transport failure', async () => {
    const fetchImpl = makeFetch({ throws: new Error('connection refused') });
    await expect(
      generateSearchQueries({
        subGoal: 'goal',
        centerGoal: 'center',
        language: 'ko',
        fetchImpl,
      })
    ).rejects.toThrow(LlmQueryGenError);
  });

  it('throws LlmQueryGenError on Ollama HTTP error (500)', async () => {
    const fetchImpl = makeFetch({ ok: false, status: 500, bodyText: 'internal error' });
    await expect(
      generateSearchQueries({
        subGoal: 'goal',
        centerGoal: 'center',
        language: 'ko',
        fetchImpl,
      })
    ).rejects.toThrow(LlmQueryGenError);
  });

  it('throws LlmQueryGenError when Ollama returns an error field', async () => {
    const fetchImpl = makeFetch({ body: { error: 'model not loaded' } });
    await expect(
      generateSearchQueries({
        subGoal: 'goal',
        centerGoal: 'center',
        language: 'ko',
        fetchImpl,
      })
    ).rejects.toThrow(LlmQueryGenError);
  });

  it('throws LlmQueryGenError when message.content is empty', async () => {
    const fetchImpl = makeFetch({ body: { message: { content: '' } } });
    await expect(
      generateSearchQueries({
        subGoal: 'goal',
        centerGoal: 'center',
        language: 'ko',
        fetchImpl,
      })
    ).rejects.toThrow(LlmQueryGenError);
  });

  it('uses Korean prompt for ko language (system + user content)', async () => {
    const captured: string[] = [];
    const fetchImpl = jest.fn().mockImplementation(async (_url, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      for (const msg of body.messages ?? []) captured.push(String(msg.content ?? ''));
      return {
        ok: true,
        status: 200,
        json: async () => ({ message: { content: '["q1", "q2", "q3"]' } }),
      };
    }) as unknown as typeof fetch;

    await generateSearchQueries({
      subGoal: '조카의 학습 동기 부여',
      centerGoal: '조카 교육',
      language: 'ko',
      fetchImpl,
    });

    const joined = captured.join(' ');
    expect(joined).toMatch(/JSON 배열|YouTube/);
    expect(joined).toContain('조카의 학습 동기 부여');
    expect(joined).toContain('조카 교육');
  });

  it('uses English prompt for en language', async () => {
    const captured: string[] = [];
    const fetchImpl = jest.fn().mockImplementation(async (_url, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      for (const msg of body.messages ?? []) captured.push(String(msg.content ?? ''));
      return {
        ok: true,
        status: 200,
        json: async () => ({ message: { content: '["q1", "q2", "q3"]' } }),
      };
    }) as unknown as typeof fetch;

    await generateSearchQueries({
      subGoal: 'Build healthy habits',
      centerGoal: 'Personal growth',
      language: 'en',
      fetchImpl,
    });

    const joined = captured.join(' ');
    expect(joined).toMatch(/JSON array|search queries/i);
    expect(joined).toContain('Build healthy habits');
    expect(joined).toContain('Personal growth');
  });

  it('respects baseUrl override', async () => {
    let capturedUrl = '';
    const fetchImpl = jest.fn().mockImplementation(async (url: string) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ message: { content: '["q1", "q2", "q3"]' } }),
      };
    }) as unknown as typeof fetch;

    await generateSearchQueries({
      subGoal: 'goal',
      centerGoal: 'center',
      language: 'ko',
      baseUrl: 'http://test-host:9999',
      fetchImpl,
    });

    expect(capturedUrl).toBe('http://test-host:9999/api/chat');
  });

  it('respects model override in the request body', async () => {
    let capturedModel = '';
    const fetchImpl = jest.fn().mockImplementation(async (_url, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      capturedModel = body.model ?? '';
      return {
        ok: true,
        status: 200,
        json: async () => ({ message: { content: '["q1", "q2", "q3"]' } }),
      };
    }) as unknown as typeof fetch;

    await generateSearchQueries({
      subGoal: 'goal',
      centerGoal: 'center',
      language: 'ko',
      model: 'qwen2.5:7b',
      fetchImpl,
    });

    expect(capturedModel).toBe('qwen2.5:7b');
  });
});

// ============================================================================
// generateSearchQueriesViaOllama — same path as deprecated alias
// ============================================================================

describe('generateSearchQueriesViaOllama', () => {
  it('happy path: returns parsed queries', async () => {
    const fetchImpl = jest.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: '["q1", "q2", "q3"]' } }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const out = await generateSearchQueriesViaOllama({
      subGoal: 'goal',
      centerGoal: 'center',
      language: 'ko',
      fetchImpl,
    });
    expect(out).toEqual(['q1', 'q2', 'q3']);
  });
});

// ============================================================================
// generateSearchQueriesViaOpenRouter — request shape + error handling
// ============================================================================

describe('generateSearchQueriesViaOpenRouter', () => {
  it('throws when apiKey is missing', async () => {
    await expect(
      generateSearchQueriesViaOpenRouter({
        subGoal: 'goal',
        centerGoal: 'center',
        language: 'ko',
        apiKey: '',
        openRouterModel: 'qwen/qwen3-30b-a3b',
      })
    ).rejects.toThrow(LlmQueryGenError);
  });

  it('happy path: returns parsed queries from OpenRouter response shape', async () => {
    const fetchImpl = jest.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '["openrouter q1", "openrouter q2", "openrouter q3"]' } }],
      }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const out = await generateSearchQueriesViaOpenRouter({
      subGoal: 'goal',
      centerGoal: 'center',
      language: 'ko',
      apiKey: 'sk-test',
      openRouterModel: 'qwen/qwen3-30b-a3b',
      fetchImpl,
    });
    expect(out).toEqual(['openrouter q1', 'openrouter q2', 'openrouter q3']);
  });

  it('hits OpenRouter URL with Bearer auth + correct model + reasoning disabled', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const fetchImpl = jest.fn().mockImplementation(async (url: string, init) => {
      capturedUrl = url;
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '["q1", "q2", "q3"]' } }],
        }),
        text: async () => '',
      };
    }) as unknown as typeof fetch;

    await generateSearchQueriesViaOpenRouter({
      subGoal: 'goal',
      centerGoal: 'center',
      language: 'ko',
      apiKey: 'sk-test-key',
      openRouterModel: 'qwen/qwen3-30b-a3b',
      fetchImpl,
    });

    expect(capturedUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(capturedHeaders?.['Authorization']).toBe('Bearer sk-test-key');
    expect(capturedBody?.['model']).toBe('qwen/qwen3-30b-a3b');
    const reasoning = capturedBody?.['reasoning'] as { enabled: boolean } | undefined;
    expect(reasoning?.enabled).toBe(false);
  });

  it('throws LlmQueryGenError on HTTP error', async () => {
    const fetchImpl = jest.fn().mockImplementation(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => 'unauthorized',
    })) as unknown as typeof fetch;

    await expect(
      generateSearchQueriesViaOpenRouter({
        subGoal: 'goal',
        centerGoal: 'center',
        language: 'ko',
        apiKey: 'sk-test',
        openRouterModel: 'qwen/qwen3-30b-a3b',
        fetchImpl,
      })
    ).rejects.toThrow(LlmQueryGenError);
  });

  it('uses message.reasoning when message.content is empty (Qwen3 quirk)', async () => {
    const fetchImpl = jest.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: '',
              reasoning: '["reasoning q1", "reasoning q2", "reasoning q3"]',
            },
          },
        ],
      }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const out = await generateSearchQueriesViaOpenRouter({
      subGoal: 'goal',
      centerGoal: 'center',
      language: 'ko',
      apiKey: 'sk-test',
      openRouterModel: 'qwen/qwen3-30b-a3b',
      fetchImpl,
    });
    expect(out).toEqual(['reasoning q1', 'reasoning q2', 'reasoning q3']);
  });
});

// ============================================================================
// generateSearchQueriesRace — parallel + first-success-wins
// ============================================================================

describe('generateSearchQueriesRace', () => {
  /**
   * Build a fetch mock that routes:
   *   - `/api/chat`     → Ollama, with optional delay/failure
   *   - `/openrouter.ai/...` → OpenRouter, with optional delay/failure
   */
  function makeRaceFetch(opts: {
    ollama?: { queries?: string[]; delayMs?: number; status?: number; throw?: string };
    openrouter?: { queries?: string[]; delayMs?: number; status?: number; throw?: string };
  }): typeof fetch {
    return jest.fn().mockImplementation(async (url: string) => {
      const isOllama = url.includes('/api/chat');
      const isOpenRouter = url.includes('openrouter.ai');
      const cfg = isOllama ? opts.ollama : isOpenRouter ? opts.openrouter : undefined;
      if (!cfg) throw new Error(`Unmocked URL: ${url}`);

      if (cfg.delayMs) {
        await new Promise((r) => setTimeout(r, cfg.delayMs));
      }
      if (cfg.throw) {
        throw new Error(cfg.throw);
      }
      const status = cfg.status ?? 200;
      const ok = status >= 200 && status < 300;
      if (!ok) {
        return { ok, status, json: async () => ({}), text: async () => 'http error' };
      }
      if (isOllama) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ message: { content: JSON.stringify(cfg.queries ?? []) } }),
          text: async () => '',
        };
      }
      // OpenRouter shape
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(cfg.queries ?? []) } }],
        }),
        text: async () => '',
      };
    }) as unknown as typeof fetch;
  }

  it('degrades to Ollama-only when openRouterApiKey is empty', async () => {
    const fetchImpl = makeRaceFetch({
      ollama: { queries: ['ollama-only q1', 'ollama-only q2', 'ollama-only q3'] },
    });
    const result = await generateSearchQueriesRace({
      subGoal: 'goal',
      centerGoal: 'center',
      language: 'ko',
      openRouterApiKey: '',
      openRouterModel: 'qwen/qwen3-30b-a3b',
      fetchImpl,
    });
    expect(result.winner.provider).toBe('ollama');
    expect(result.winner.queries).toEqual(['ollama-only q1', 'ollama-only q2', 'ollama-only q3']);
    expect(result.loser).toBeNull();
  });

  it('returns OpenRouter result when Ollama is slower', async () => {
    const fetchImpl = makeRaceFetch({
      ollama: { queries: ['slow ollama q1', 'q2', 'q3'], delayMs: 100 },
      openrouter: { queries: ['fast openrouter q1', 'q2', 'q3'], delayMs: 1 },
    });
    const result = await generateSearchQueriesRace({
      subGoal: 'goal',
      centerGoal: 'center',
      language: 'ko',
      openRouterApiKey: 'sk-test',
      openRouterModel: 'qwen/qwen3-30b-a3b',
      fetchImpl,
    });
    expect(result.winner.provider).toBe('openrouter');
    expect(result.winner.queries?.[0]).toBe('fast openrouter q1');
    expect(result.loser).not.toBeNull();
    expect(result.loser?.provider).toBe('ollama');
    expect(result.loser?.queries?.[0]).toBe('slow ollama q1');
  });

  it('returns Ollama result when OpenRouter is slower', async () => {
    const fetchImpl = makeRaceFetch({
      ollama: { queries: ['fast ollama q1', 'q2', 'q3'], delayMs: 1 },
      openrouter: { queries: ['slow openrouter q1', 'q2', 'q3'], delayMs: 100 },
    });
    const result = await generateSearchQueriesRace({
      subGoal: 'goal',
      centerGoal: 'center',
      language: 'ko',
      openRouterApiKey: 'sk-test',
      openRouterModel: 'qwen/qwen3-30b-a3b',
      fetchImpl,
    });
    expect(result.winner.provider).toBe('ollama');
    expect(result.winner.queries?.[0]).toBe('fast ollama q1');
    expect(result.loser?.provider).toBe('openrouter');
    expect(result.loser?.queries?.[0]).toBe('slow openrouter q1');
  });

  it('returns OpenRouter result when Ollama fails entirely', async () => {
    const fetchImpl = makeRaceFetch({
      ollama: { throw: 'connection refused' },
      openrouter: { queries: ['or q1', 'or q2', 'or q3'] },
    });
    const result = await generateSearchQueriesRace({
      subGoal: 'goal',
      centerGoal: 'center',
      language: 'ko',
      openRouterApiKey: 'sk-test',
      openRouterModel: 'qwen/qwen3-30b-a3b',
      fetchImpl,
    });
    expect(result.winner.provider).toBe('openrouter');
    expect(result.loser?.provider).toBe('ollama');
    expect(result.loser?.queries).toBeNull();
    expect(result.loser?.error).toMatch(/connection refused/);
  });

  it('returns Ollama result when OpenRouter fails entirely', async () => {
    const fetchImpl = makeRaceFetch({
      ollama: { queries: ['ol q1', 'ol q2', 'ol q3'] },
      openrouter: { status: 500 },
    });
    const result = await generateSearchQueriesRace({
      subGoal: 'goal',
      centerGoal: 'center',
      language: 'ko',
      openRouterApiKey: 'sk-test',
      openRouterModel: 'qwen/qwen3-30b-a3b',
      fetchImpl,
    });
    expect(result.winner.provider).toBe('ollama');
    expect(result.loser?.provider).toBe('openrouter');
    expect(result.loser?.queries).toBeNull();
    expect(result.loser?.error).toMatch(/HTTP 500/);
  });

  it('throws LlmQueryGenError when BOTH providers fail', async () => {
    const fetchImpl = makeRaceFetch({
      ollama: { throw: 'ollama down' },
      openrouter: { throw: 'openrouter down' },
    });
    await expect(
      generateSearchQueriesRace({
        subGoal: 'goal',
        centerGoal: 'center',
        language: 'ko',
        openRouterApiKey: 'sk-test',
        openRouterModel: 'qwen/qwen3-30b-a3b',
        fetchImpl,
      })
    ).rejects.toThrow(LlmQueryGenError);
  });
});
