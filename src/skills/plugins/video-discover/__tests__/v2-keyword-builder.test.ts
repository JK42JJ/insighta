/**
 * v2 keyword-builder — unit tests
 *
 * No real LLM calls. The race orchestrator is bypassed by omitting
 * `openRouterApiKey`, which forces the rule-based path. A separate test
 * mocks `fetchImpl` to verify the LLM path also works.
 */

import {
  buildSearchQueries,
  extractCoreKeyphrase,
  MAX_QUERIES,
  MAX_QUERY_LENGTH,
  type KeywordBuilderInput,
} from '../v2/keyword-builder';

const baseInput: KeywordBuilderInput = {
  centerGoal: '영어말하기 100일 훈련',
  subGoals: [
    '발음 교정',
    '쉐도잉 연습',
    '회화 패턴 암기',
    '영어 일기 쓰기',
    '영어 영상 시청',
    '원어민과 대화',
    '문법 복습',
    '어휘 확장',
  ],
  language: 'ko',
};

describe('extractCoreKeyphrase', () => {
  test('Korean: strips year prefix and 달성하기 ending', () => {
    expect(extractCoreKeyphrase('2026 원하는 목표 달성하기', 'ko')).toBe('원하는 목표');
  });

  test('Korean: strips 하기 ending', () => {
    expect(extractCoreKeyphrase('영어말하기 100일 훈련하기', 'ko')).toBe('영어말하기 100일 훈련');
  });

  test('Korean: untouched when no prefix/ending matches', () => {
    expect(extractCoreKeyphrase('스타트업 창업 가이드', 'ko')).toBe('스타트업 창업 가이드');
  });

  test('Korean: 올해 prefix removed', () => {
    expect(extractCoreKeyphrase('올해 매일 운동 하기', 'ko')).toBe('매일 운동');
  });

  test('Korean: fallback to original when extraction empty', () => {
    expect(extractCoreKeyphrase('하기', 'ko')).toBe('하기');
  });

  test('English: lowercases and strips stopwords + year', () => {
    expect(extractCoreKeyphrase('2026 The Best Way of Learning', 'en')).toBe('best way learning');
  });

  test('English: untouched when no stopwords', () => {
    expect(extractCoreKeyphrase('Master Spanish 100 Days', 'en')).toBe('master spanish 100 days');
  });

  test('English: fallback when only stopwords', () => {
    expect(extractCoreKeyphrase('the of in', 'en')).toBe('the of in');
  });
});

describe('buildSearchQueries — rule-based path (no LLM)', () => {
  test('returns at least 1 query (centerGoal as core)', async () => {
    const queries = await buildSearchQueries(baseInput);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0]).toEqual({ query: baseInput.centerGoal, source: 'core' });
  });

  test('caps total at MAX_QUERIES', async () => {
    const queries = await buildSearchQueries({
      ...baseInput,
      focusTags: ['business', 'travel'],
      targetLevel: 'advanced',
    });
    expect(queries.length).toBeLessThanOrEqual(MAX_QUERIES);
  });

  test('focus_tags appear when present', async () => {
    const queries = await buildSearchQueries({
      ...baseInput,
      focusTags: ['business english'],
    });
    expect(queries.some((q) => q.source === 'focus')).toBe(true);
    expect(queries.find((q) => q.source === 'focus')?.query).toContain('business english');
  });

  test('target_level=standard does NOT add a level query', async () => {
    const queries = await buildSearchQueries({ ...baseInput, targetLevel: 'standard' });
    expect(queries.some((q) => q.source === 'level')).toBe(false);
  });

  test('target_level=beginner adds Korean keyword 입문 for ko', async () => {
    const queries = await buildSearchQueries({ ...baseInput, targetLevel: 'beginner' });
    const lvl = queries.find((q) => q.source === 'level');
    expect(lvl?.query).toContain('입문');
  });

  test('target_level=beginner adds English keyword for en mandala', async () => {
    const queries = await buildSearchQueries({
      ...baseInput,
      language: 'en',
      centerGoal: 'Master Spanish in 100 days',
      targetLevel: 'beginner',
    });
    const lvl = queries.find((q) => q.source === 'level');
    expect(lvl?.query).toContain('beginner');
  });

  test('subgoal queries use shortest sub_goals first', async () => {
    const queries = await buildSearchQueries(baseInput);
    const subgoalQueries = queries.filter((q) => q.source === 'subgoal');
    // shortest sub_goals are "발음 교정" (5 chars), "문법 복습" (5 chars), etc.
    // verify at least one subgoal query exists and contains a short sub_goal
    expect(subgoalQueries.length).toBeGreaterThan(0);
    expect(
      subgoalQueries.some((q) => q.query.includes('발음 교정') || q.query.includes('문법 복습'))
    ).toBe(true);
  });

  test('dedupe: identical queries collapsed', async () => {
    const queries = await buildSearchQueries({
      ...baseInput,
      // focusTag identical to centerGoal would produce duplicate after concat
      focusTags: [],
      subGoals: ['영어말하기 100일 훈련', '영어말하기 100일 훈련', 'a', 'b', 'c', 'd', 'e', 'f'],
    });
    const uniq = new Set(queries.map((q) => q.query));
    expect(uniq.size).toBe(queries.length);
  });

  test('empty centerGoal returns []', async () => {
    const queries = await buildSearchQueries({ ...baseInput, centerGoal: '   ' });
    expect(queries).toEqual([]);
  });

  test('every query length <= MAX_QUERY_LENGTH', async () => {
    const longCenter = 'a'.repeat(200);
    const queries = await buildSearchQueries({
      ...baseInput,
      centerGoal: longCenter,
      focusTags: ['x'.repeat(50)],
    });
    for (const q of queries) {
      expect(q.query.length).toBeLessThanOrEqual(MAX_QUERY_LENGTH);
    }
  });
});

describe('buildSearchQueries — LLM path with mocked fetch', () => {
  test('LLM result is appended after core, deduped, capped at MAX_QUERIES', async () => {
    // Mock OpenRouter response shape per llm-query-generator parser
    const fakeQueries = ['mock-llm-query-1', 'mock-llm-query-2', 'mock-llm-query-3'];
    const mockFetch: typeof fetch = (async (url: string) => {
      // Race calls both Ollama and OpenRouter — match either path
      if (typeof url === 'string' && url.includes('openrouter.ai')) {
        return {
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ queries: fakeQueries }) } }],
          }),
        } as unknown as Response;
      }
      // Make Ollama fail fast so OpenRouter wins the race
      return {
        ok: false,
        status: 500,
        text: async () => 'mock-ollama-down',
        json: async () => ({}),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const queries = await buildSearchQueries(baseInput, {
      openRouterApiKey: 'test-key',
      openRouterModel: 'test/model',
      fetchImpl: mockFetch,
    });

    expect(queries.length).toBeLessThanOrEqual(MAX_QUERIES);
    expect(queries[0]?.source).toBe('core'); // Q1 always core
    // LLM queries should appear (at least one)
    expect(queries.some((q) => q.source === 'llm')).toBe(true);
  });

  test('LLM failure degrades silently to rule-based', async () => {
    const mockFetch: typeof fetch = (async () => {
      return {
        ok: false,
        status: 500,
        text: async () => 'down',
        json: async () => ({}),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const queries = await buildSearchQueries(baseInput, {
      openRouterApiKey: 'test-key',
      openRouterModel: 'test/model',
      fetchImpl: mockFetch,
    });

    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0]?.source).toBe('core');
    expect(queries.some((q) => q.source === 'llm')).toBe(false);
  });
});
