/**
 * llm-reranker — unit tests (CP360 Phase 1-F)
 *
 * Pins the contract that matters for the executor:
 *   - parseRerankResponse handles strict JSON array
 *   - parseRerankResponse handles Qwen3 prose-prefix + embedded JSON
 *   - parseRerankResponse falls back to regex on loose formats
 *   - parseRerankResponse returns empty map on total garbage
 *   - parseRerankResponse ignores out-of-range indices
 *   - parseRerankResponse treats missing verdicts as KEEP (caller's concern)
 *   - rerankBatch never throws (soft signal contract)
 *   - rerankBatch returns pass-through result when disabled
 *   - rerankBatch translates positional indices to original candidate index
 */

import {
  parseRerankResponse,
  rerankBatch,
  buildRerankPrompt,
  type RerankCandidate,
} from '../sources/llm-reranker';

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
// parseRerankResponse
// ============================================================================

describe('parseRerankResponse', () => {
  test('strict JSON array of {i,v} objects', () => {
    const raw = '[{"i":1,"v":"Y"},{"i":2,"v":"N"},{"i":3,"v":"Y"}]';
    const { verdicts, parseMode } = parseRerankResponse(raw, 5);
    expect(parseMode).toBe('json');
    // Stored 0-based
    expect(verdicts.get(0)).toBe('Y');
    expect(verdicts.get(1)).toBe('N');
    expect(verdicts.get(2)).toBe('Y');
    expect(verdicts.size).toBe(3);
  });

  test('Qwen3 prose prefix before JSON array', () => {
    const raw =
      'Okay, let\'s analyze these videos. The user wants educational content for Korean learners. [{"i":1,"v":"N"},{"i":2,"v":"Y"}]';
    const { verdicts, parseMode } = parseRerankResponse(raw, 2);
    expect(parseMode).toBe('json');
    expect(verdicts.get(0)).toBe('N');
    expect(verdicts.get(1)).toBe('Y');
  });

  test('object-wrapped array (Qwen3 JSON mode)', () => {
    const raw = '{"verdicts":[{"i":1,"v":"Y"},{"i":2,"v":"N"}]}';
    const { verdicts, parseMode } = parseRerankResponse(raw, 2);
    expect(parseMode).toBe('json');
    expect(verdicts.get(0)).toBe('Y');
    expect(verdicts.get(1)).toBe('N');
  });

  test('out-of-range indices are ignored', () => {
    const raw = '[{"i":1,"v":"Y"},{"i":99,"v":"N"},{"i":0,"v":"Y"}]';
    const { verdicts } = parseRerankResponse(raw, 3);
    expect(verdicts.get(0)).toBe('Y'); // i=1 valid
    expect(verdicts.size).toBe(1); // i=99 and i=0 both out of range
  });

  test('invalid verdict values are skipped', () => {
    const raw = '[{"i":1,"v":"Y"},{"i":2,"v":"MAYBE"},{"i":3,"v":"y"}]';
    const { verdicts, parseMode } = parseRerankResponse(raw, 3);
    expect(parseMode).toBe('json');
    expect(verdicts.get(0)).toBe('Y');
    expect(verdicts.has(1)).toBe(false);
    // Lowercase 'y' should be accepted (uppercase normalization)
    expect(verdicts.get(2)).toBe('Y');
  });

  test('loose format "1: Y, 2: N" falls through to regex', () => {
    const raw = '1: Y, 2: N, 3: Y';
    const { verdicts, parseMode } = parseRerankResponse(raw, 5);
    expect(parseMode).toBe('regex');
    expect(verdicts.get(0)).toBe('Y');
    expect(verdicts.get(1)).toBe('N');
    expect(verdicts.get(2)).toBe('Y');
  });

  test('numbered format "1. Y 2. N" via regex', () => {
    const raw = '1. Y 2. N 3. Y';
    const { verdicts, parseMode } = parseRerankResponse(raw, 5);
    expect(parseMode).toBe('regex');
    expect(verdicts.size).toBe(3);
  });

  test('completely broken response → empty map, parseMode=failed', () => {
    const raw = '아 잘 모르겠어요';
    const { verdicts, parseMode } = parseRerankResponse(raw, 5);
    expect(parseMode).toBe('failed');
    expect(verdicts.size).toBe(0);
  });

  test('empty string → parseMode=failed, empty verdicts', () => {
    const { verdicts, parseMode } = parseRerankResponse('', 5);
    expect(parseMode).toBe('failed');
    expect(verdicts.size).toBe(0);
  });

  test('partial batch — some verdicts missing', () => {
    // Only verdicts for 1 and 3, missing 2, 4, 5
    const raw = '[{"i":1,"v":"Y"},{"i":3,"v":"N"}]';
    const { verdicts, parseMode } = parseRerankResponse(raw, 5);
    expect(parseMode).toBe('json');
    expect(verdicts.size).toBe(2);
    // The executor's contract: missing = default KEEP. That's the CALLER's
    // concern, not the parser's — the parser just returns what it found.
    expect(verdicts.has(1)).toBe(false);
  });

  test('markdown fence around JSON array', () => {
    const raw = '```json\n[{"i":1,"v":"Y"},{"i":2,"v":"N"}]\n```';
    const { verdicts, parseMode } = parseRerankResponse(raw, 2);
    // The first JSON.parse will fail; extractFirstJsonArray finds the array
    expect(parseMode).toBe('json');
    expect(verdicts.get(0)).toBe('Y');
    expect(verdicts.get(1)).toBe('N');
  });
});

// ============================================================================
// rerankBatch — integration with fake fetch
// ============================================================================

describe('rerankBatch', () => {
  const baseCandidates: RerankCandidate[] = [
    { index: 0, title: 'How to study Korean', channel: 'LearnKo' },
    { index: 1, title: 'PPL 광고 리뷰', channel: 'adchannel' },
    { index: 2, title: '드라마 리액션', channel: 'vloggers' },
  ];

  function mockFetch(response: {
    ok: boolean;
    status?: number;
    body?: object | string;
  }): typeof fetch {
    return jest.fn(async () => ({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () =>
        typeof response.body === 'object' ? response.body : JSON.parse(response.body as string),
      text: async () =>
        typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
    })) as unknown as typeof fetch;
  }

  test('happy path — JSON verdicts drop N, keep Y, translate indices', async () => {
    const fakeFetch = mockFetch({
      ok: true,
      body: {
        choices: [
          {
            message: {
              content: '[{"i":1,"v":"Y"},{"i":2,"v":"N"},{"i":3,"v":"N"}]',
            },
          },
        ],
      },
    });

    const result = await rerankBatch({
      candidates: baseCandidates,
      centerGoal: '영어 학습',
      language: 'ko',
      apiKey: 'test-key',
      model: 'qwen/qwen3-30b-a3b',
      fetchImpl: fakeFetch,
    });

    expect(result.error).toBeNull();
    expect(result.parseMode).toBe('json');
    expect(result.parsedCount).toBe(3);
    expect(result.rejectedCount).toBe(2);
    // Index 0 in original array → Y
    expect(result.verdicts.get(0)).toBe('Y');
    expect(result.verdicts.get(1)).toBe('N');
    expect(result.verdicts.get(2)).toBe('N');
  });

  test('missing API key → error field set, empty verdicts, no throw', async () => {
    const result = await rerankBatch({
      candidates: baseCandidates,
      centerGoal: '영어 학습',
      language: 'ko',
      apiKey: '',
      model: 'qwen/qwen3-30b-a3b',
    });

    expect(result.error).toContain('api key');
    expect(result.verdicts.size).toBe(0);
    expect(result.parseMode).toBe('failed');
  });

  test('HTTP 500 → error field set, empty verdicts, no throw', async () => {
    const fakeFetch = mockFetch({
      ok: false,
      status: 500,
      body: 'internal server error',
    });

    const result = await rerankBatch({
      candidates: baseCandidates,
      centerGoal: '영어 학습',
      language: 'ko',
      apiKey: 'test-key',
      model: 'qwen/qwen3-30b-a3b',
      fetchImpl: fakeFetch,
    });

    expect(result.error).toContain('500');
    expect(result.verdicts.size).toBe(0);
  });

  test('garbage response → parseMode=failed, empty verdicts, no throw', async () => {
    const fakeFetch = mockFetch({
      ok: true,
      body: {
        choices: [{ message: { content: '음 잘 모르겠어요' } }],
      },
    });

    const result = await rerankBatch({
      candidates: baseCandidates,
      centerGoal: '영어 학습',
      language: 'ko',
      apiKey: 'test-key',
      model: 'qwen/qwen3-30b-a3b',
      fetchImpl: fakeFetch,
    });

    expect(result.error).toBeNull(); // no HTTP error
    expect(result.parseMode).toBe('failed');
    expect(result.verdicts.size).toBe(0);
  });

  test('empty candidates → no-op', async () => {
    const result = await rerankBatch({
      candidates: [],
      centerGoal: '영어 학습',
      language: 'ko',
      apiKey: 'test-key',
      model: 'qwen/qwen3-30b-a3b',
    });

    expect(result.verdicts.size).toBe(0);
    expect(result.error).toBeNull();
  });

  test('positional → original index translation', async () => {
    const sparseCandidates: RerankCandidate[] = [
      { index: 10, title: 'A', channel: 'ch1' },
      { index: 25, title: 'B', channel: 'ch2' },
    ];
    const fakeFetch = mockFetch({
      ok: true,
      body: {
        choices: [{ message: { content: '[{"i":1,"v":"Y"},{"i":2,"v":"N"}]' } }],
      },
    });

    const result = await rerankBatch({
      candidates: sparseCandidates,
      centerGoal: 'test',
      language: 'en',
      apiKey: 'test-key',
      model: 'model',
      fetchImpl: fakeFetch,
    });

    // Positional 1 → batch[0].index = 10
    // Positional 2 → batch[1].index = 25
    expect(result.verdicts.get(10)).toBe('Y');
    expect(result.verdicts.get(25)).toBe('N');
    expect(result.verdicts.size).toBe(2);
  });
});

// ============================================================================
// buildRerankPrompt
// ============================================================================

describe('buildRerankPrompt', () => {
  test('Korean language produces Korean system prompt', () => {
    const prompt = buildRerankPrompt({
      candidates: [{ index: 0, title: 'test', channel: 'ch' }],
      centerGoal: '영어 학습',
      language: 'ko',
    });
    expect(prompt.system).toContain('광고');
    expect(prompt.system).toContain('JSON');
    expect(prompt.user).toContain('중심 목표');
  });

  test('English language produces English system prompt', () => {
    const prompt = buildRerankPrompt({
      candidates: [{ index: 0, title: 'test', channel: 'ch' }],
      centerGoal: 'Learn English',
      language: 'en',
    });
    expect(prompt.system).toContain('Ads');
    expect(prompt.user).toContain('Center goal');
  });

  test('sub_goal is included when provided', () => {
    const prompt = buildRerankPrompt({
      candidates: [{ index: 0, title: 'test', channel: 'ch' }],
      centerGoal: '영어 학습',
      subGoal: '기초 발음 정복',
      language: 'ko',
    });
    expect(prompt.user).toContain('세부 목표');
    expect(prompt.user).toContain('기초 발음 정복');
  });

  test('candidates are numbered 1-based in prompt', () => {
    const prompt = buildRerankPrompt({
      candidates: [
        { index: 0, title: 'A', channel: 'ch1' },
        { index: 1, title: 'B', channel: 'ch2' },
      ],
      centerGoal: 'test',
      language: 'en',
    });
    expect(prompt.user).toContain('1. A / ch1');
    expect(prompt.user).toContain('2. B / ch2');
  });

  test('long titles are truncated in prompt', () => {
    const longTitle = 'a'.repeat(200);
    const prompt = buildRerankPrompt({
      candidates: [{ index: 0, title: longTitle, channel: 'ch' }],
      centerGoal: 'test',
      language: 'en',
    });
    // Title gets truncated to 140 + ellipsis
    expect(prompt.user).not.toContain(longTitle);
    expect(prompt.user).toContain('…');
  });
});
