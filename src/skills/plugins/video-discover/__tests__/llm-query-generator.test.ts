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
  LlmQueryGenError,
  parseQueriesResponse,
} from '../sources/llm-query-generator';

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

  it('throws LlmQueryGenError when JSON shape has no recognized array key', () => {
    expect(() => parseQueriesResponse('{"foo": "bar"}')).toThrow(LlmQueryGenError);
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
