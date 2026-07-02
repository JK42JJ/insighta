/**
 * book-factcheck (§4.5.1 loop-2-A, CP504) — Factcheck-GPT-style verification.
 * OpenRouter Haiku is MOCKED (no live LLM — LLM-API ban). CSE is also mocked.
 * Locks:
 *   - P-3A-NARRATIVE-EXEMPT: selectCheckWorthy excludes hasSource===false sentences
 *   - P-3A-MODEL: HAIKU_MODEL const contains "haiku", never "deepseek"
 *   - P-3A-STYLE-KEEP: correction only for FALSE/MISLEADING; TRUE/etc → none
 *   - P-3A-NO-NEW-ERROR: FALSE/MISLEADING corrections carry evidenceUrl
 *   - parse: non-JSON / out-of-shape → ok:false; fence-strip
 */

const mockGenerate = jest.fn();
jest.mock('@/modules/llm/openrouter', () => ({
  OpenRouterGenerationProvider: jest.fn().mockImplementation(() => ({ generate: mockGenerate })),
}));
jest.mock('@/config/index', () => ({
  config: { paths: { logs: '/tmp' }, app: { isTest: true } },
}));

import {
  selectCheckWorthy,
  parseFactcheckResponse,
  factcheckChapterBody,
  buildFactcheckPrompt,
  type FactSentence,
} from '../../../src/modules/mandala-book/book-factcheck';

// Minimal mock CSE client (never throws, returns controlled items).
function makeMockCse(items: Array<{ title: string; link: string; snippet: string }> = []) {
  return {
    searchWeb: jest.fn().mockResolvedValue({
      items: items.map((i) => ({ ...i, displayLink: i.link })),
      totalResults: items.length,
    }),
  };
}

beforeEach(() => mockGenerate.mockReset());

// ---------------------------------------------------------------------------
// Stage 1 — selectCheckWorthy (pure)
// ---------------------------------------------------------------------------

describe('selectCheckWorthy — P-3A-NARRATIVE-EXEMPT', () => {
  const sentences: FactSentence[] = [
    { text: '이 영상은 2023년에 출시되었다.', hasSource: true },
    { text: '따라서 우리는 다음 단계로 넘어갈 수 있다.', hasSource: false },
    { text: 'Python의 GIL은 CPython 3.12에서 제거되지 않았다.', hasSource: true },
    { text: '앞에서 살펴본 바와 같이', hasSource: false },
    { text: '만다라 수련법은 14세기 티베트에서 유래했다.', hasSource: true },
  ];

  it('returns ONLY hasSource===true sentences (fact claims)', () => {
    const result = selectCheckWorthy(sentences);
    expect(result).toHaveLength(3);
    expect(result.every((s) => s.hasSource === true)).toBe(true);
  });

  it('excludes ALL hasSource===false sentences (narrative/connective)', () => {
    const result = selectCheckWorthy(sentences);
    const excluded = result.filter((s) => s.hasSource === false);
    expect(excluded).toHaveLength(0);
  });

  it('returns specific fact texts — connective texts are NOT in queue', () => {
    const result = selectCheckWorthy(sentences);
    const texts = result.map((s) => s.text);
    expect(texts).not.toContain('따라서 우리는 다음 단계로 넘어갈 수 있다.');
    expect(texts).not.toContain('앞에서 살펴본 바와 같이');
    expect(texts).toContain('이 영상은 2023년에 출시되었다.');
    expect(texts).toContain('Python의 GIL은 CPython 3.12에서 제거되지 않았다.');
    expect(texts).toContain('만다라 수련법은 14세기 티베트에서 유래했다.');
  });

  it('returns empty array when all sentences are narrative (hasSource===false)', () => {
    const onlyNarrative: FactSentence[] = [
      { text: '그래서', hasSource: false },
      { text: '따라서 결론적으로', hasSource: false },
    ];
    expect(selectCheckWorthy(onlyNarrative)).toHaveLength(0);
  });

  it('returns all sentences when all are fact claims (hasSource===true)', () => {
    const onlyFacts: FactSentence[] = [
      { text: '주장 A', hasSource: true },
      { text: '주장 B', hasSource: true },
    ];
    expect(selectCheckWorthy(onlyFacts)).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(selectCheckWorthy([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// P-3A-MODEL gate (model const check — no live call needed)
// ---------------------------------------------------------------------------

describe('P-3A-MODEL — model id check', () => {
  it('HAIKU_MODEL contains "haiku" (DeepSeek disqualified)', () => {
    // Import the module at runtime to inspect the const via the prompt builder.
    // We assert via buildFactcheckPrompt (pure, exported) that the module loads without error,
    // then verify the model via a mockGenerate call capture.
    const fakeCse = makeMockCse([{ title: 't', link: 'http://x.com', snippet: 's' }]);
    const haiku5Response = JSON.stringify([
      { sentence: 'claim A', verdict: 'TRUE', evidenceUrl: 'http://x.com' },
    ]);
    mockGenerate.mockResolvedValueOnce(haiku5Response);

    // Capture the model passed to OpenRouterGenerationProvider constructor.
    const { OpenRouterGenerationProvider } = jest.requireMock('@/modules/llm/openrouter') as {
      OpenRouterGenerationProvider: jest.Mock;
    };
    OpenRouterGenerationProvider.mockClear();

    return factcheckChapterBody(
      [{ text: 'claim A', hasSource: true }],
      fakeCse
    ).then(() => {
      expect(OpenRouterGenerationProvider).toHaveBeenCalledWith(
        expect.stringMatching(/haiku/i)
      );
      expect(OpenRouterGenerationProvider).not.toHaveBeenCalledWith(
        expect.stringMatching(/deepseek/i)
      );
    });
  });
});

// ---------------------------------------------------------------------------
// parseFactcheckResponse (pure)
// ---------------------------------------------------------------------------

describe('parseFactcheckResponse — parse + validation', () => {
  const sents = ['Python GIL은 CPython 3.12에서 제거되지 않았다.', '2023년에 출시되었다.'];

  it('parses well-formed JSON array into CheckResult[]', () => {
    const raw = JSON.stringify([
      { sentence: sents[0], verdict: 'TRUE', evidenceUrl: 'http://a.com' },
      { sentence: sents[1], verdict: 'UNVERIFIABLE' },
    ]);
    const r = parseFactcheckResponse(raw, sents);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.results).toHaveLength(2);
      expect(r.results[0]!.verdict).toBe('TRUE');
      expect(r.results[1]!.verdict).toBe('UNVERIFIABLE');
    }
  });

  it('strips code fences (```json...```)', () => {
    const inner = JSON.stringify([
      { sentence: sents[0], verdict: 'FALSE', evidenceUrl: 'http://b.com', correction: '제거됐다.' },
    ]);
    const raw = `\`\`\`json\n${inner}\n\`\`\``;
    const r = parseFactcheckResponse(raw, sents);
    expect(r.ok).toBe(true);
  });

  it('returns ok:false on non-JSON input', () => {
    const r = parseFactcheckResponse('not json at all', sents);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/json_parse/);
  });

  it('returns ok:false when response is a JSON object (not array)', () => {
    const r = parseFactcheckResponse('{"sentence":"x","verdict":"TRUE"}', sents);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('expected_array');
  });

  it('drops items with invalid/missing verdict', () => {
    const raw = JSON.stringify([
      { sentence: sents[0], verdict: 'DEFINITELY_TRUE' }, // invalid
      { sentence: sents[1], verdict: 'SUBSTANTIALLY_TRUE', evidenceUrl: 'http://c.com' },
    ]);
    const r = parseFactcheckResponse(raw, sents);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.results).toHaveLength(1);
      expect(r.results[0]!.verdict).toBe('SUBSTANTIALLY_TRUE');
    }
  });

  it('drops items whose sentence is not in the provided sentences set', () => {
    const raw = JSON.stringify([
      { sentence: '이건 안 보낸 문장이다.', verdict: 'TRUE' },
      { sentence: sents[0], verdict: 'FALSE', evidenceUrl: 'http://d.com', correction: 'fix' },
    ]);
    const r = parseFactcheckResponse(raw, sents);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.results).toHaveLength(1);
      expect(r.results[0]!.sentence).toBe(sents[0]);
    }
  });

  it('returns ok:false when all items are out-of-shape (no valid items)', () => {
    const raw = JSON.stringify([
      { sentence: '', verdict: 'TRUE' }, // empty sentence
    ]);
    const r = parseFactcheckResponse(raw, sents);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_valid_items');
  });
});

// ---------------------------------------------------------------------------
// P-3A-STYLE-KEEP — correction only for FALSE/MISLEADING
// ---------------------------------------------------------------------------

describe('P-3A-STYLE-KEEP — verdict → correction policy', () => {
  const sent = '이 기술은 1990년에 발명되었다.';

  it('FALSE with evidenceUrl → correction is preserved', () => {
    const raw = JSON.stringify([
      {
        sentence: sent,
        verdict: 'FALSE',
        evidenceUrl: 'http://evidence.com',
        correction: '이 기술은 2001년에 발명되었다.',
      },
    ]);
    const r = parseFactcheckResponse(raw, [sent]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.results[0]!.correction).toBe('이 기술은 2001년에 발명되었다.');
      expect(r.results[0]!.evidenceUrl).toBe('http://evidence.com');
    }
  });

  it('MISLEADING with evidenceUrl → correction is preserved', () => {
    const raw = JSON.stringify([
      {
        sentence: sent,
        verdict: 'MISLEADING',
        evidenceUrl: 'http://evidence2.com',
        correction: '이 기술은 1990년대에 개발되기 시작했다.',
      },
    ]);
    const r = parseFactcheckResponse(raw, [sent]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.results[0]!.correction).toBeDefined();
    }
  });

  it('TRUE → no correction (P-3A-STYLE-KEEP)', () => {
    const raw = JSON.stringify([
      { sentence: sent, verdict: 'TRUE', evidenceUrl: 'http://evidence.com', correction: '수정본' },
    ]);
    const r = parseFactcheckResponse(raw, [sent]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.results[0]!.correction).toBeUndefined();
  });

  it('SUBSTANTIALLY_TRUE → no correction', () => {
    const raw = JSON.stringify([
      {
        sentence: sent,
        verdict: 'SUBSTANTIALLY_TRUE',
        evidenceUrl: 'http://e.com',
        correction: '수정',
      },
    ]);
    const r = parseFactcheckResponse(raw, [sent]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.results[0]!.correction).toBeUndefined();
  });

  it('UNVERIFIABLE → no correction', () => {
    const raw = JSON.stringify([{ sentence: sent, verdict: 'UNVERIFIABLE' }]);
    const r = parseFactcheckResponse(raw, [sent]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.results[0]!.correction).toBeUndefined();
  });

  it('FALSE without evidenceUrl → accepted but no correction (P-3A-NO-NEW-ERROR)', () => {
    // No evidenceUrl → correction must not be fabricated.
    const raw = JSON.stringify([
      { sentence: sent, verdict: 'FALSE', correction: '수정본 (근거 없음)' },
    ]);
    const r = parseFactcheckResponse(raw, [sent]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.results[0]!.verdict).toBe('FALSE');
      expect(r.results[0]!.correction).toBeUndefined(); // no evidenceUrl → no correction
    }
  });
});

// ---------------------------------------------------------------------------
// factcheckChapterBody (orchestrator — mocked LLM + CSE)
// ---------------------------------------------------------------------------

describe('factcheckChapterBody (orchestrator)', () => {
  const mixed: FactSentence[] = [
    { text: '이 기술은 1990년에 발명되었다.', hasSource: true },
    { text: '따라서 다음 단계로 넘어간다.', hasSource: false },
    { text: '2023년에 출시되었다.', hasSource: true },
  ];

  it('returns ok:true with results for check-worthy sentences only', async () => {
    const fakeCse = makeMockCse([{ title: 't', link: 'http://e.com', snippet: 'evidence' }]);
    const haikuResponse = JSON.stringify([
      { sentence: '이 기술은 1990년에 발명되었다.', verdict: 'FALSE', evidenceUrl: 'http://e.com', correction: '2001년' },
      { sentence: '2023년에 출시되었다.', verdict: 'TRUE', evidenceUrl: 'http://e.com' },
    ]);
    mockGenerate.mockResolvedValueOnce(haikuResponse);

    const r = await factcheckChapterBody(mixed, fakeCse);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Narrative sentence is NOT in results.
      const texts = r.results.map((x) => x.sentence);
      expect(texts).not.toContain('따라서 다음 단계로 넘어간다.');
      expect(r.results.some((x) => x.verdict === 'FALSE')).toBe(true);
    }
  });

  it('returns ok:true with empty results when all sentences are narrative', async () => {
    const allNarrative: FactSentence[] = [
      { text: '따라서', hasSource: false },
      { text: '그래서 결론적으로', hasSource: false },
    ];
    const r = await factcheckChapterBody(allNarrative, makeMockCse());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.results).toHaveLength(0);
    // No LLM call when no check-worthy sentences.
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('returns ok:false on empty input', async () => {
    const r = await factcheckChapterBody([], makeMockCse());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_sentences');
  });

  it('retries Haiku once on provider error then hard-fails → ok:false', async () => {
    const fakeCse = makeMockCse();
    mockGenerate.mockRejectedValue(new Error('provider boom'));
    const r = await factcheckChapterBody(
      [{ text: '사실 주장', hasSource: true }],
      fakeCse
    );
    expect(r.ok).toBe(false);
    expect(mockGenerate).toHaveBeenCalledTimes(2); // VERIFY_ATTEMPTS
  });

  it('retries Haiku once on parse failure then hard-fails → ok:false', async () => {
    const fakeCse = makeMockCse();
    mockGenerate.mockResolvedValue('not json');
    const r = await factcheckChapterBody(
      [{ text: '사실 주장', hasSource: true }],
      fakeCse
    );
    expect(r.ok).toBe(false);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it('uses no-op cse client when cseClient is omitted', async () => {
    const haikuResponse = JSON.stringify([
      { sentence: '사실 주장', verdict: 'UNVERIFIABLE' },
    ]);
    mockGenerate.mockResolvedValueOnce(haikuResponse);
    // No cseClient argument — should not throw.
    const r = await factcheckChapterBody([{ text: '사실 주장', hasSource: true }]);
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildFactcheckPrompt (pure — structural smoke test)
// ---------------------------------------------------------------------------

describe('buildFactcheckPrompt', () => {
  it('includes claim text and evidence snippet in output', () => {
    const prompt = buildFactcheckPrompt([
      { sentence: 'claim X', evidenceSnippets: [{ url: 'http://z.com', snippet: 'some evidence' }] },
    ]);
    expect(prompt).toContain('claim X');
    expect(prompt).toContain('some evidence');
    expect(prompt).toContain('http://z.com');
  });

  it('handles empty evidence snippets gracefully', () => {
    const prompt = buildFactcheckPrompt([{ sentence: 'claim Y', evidenceSnippets: [] }]);
    expect(prompt).toContain('claim Y');
    expect(prompt).toContain('(none)');
  });
});
