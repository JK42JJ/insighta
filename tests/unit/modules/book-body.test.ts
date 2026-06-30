/**
 * book-body (§4.5.1 [3] chapter body weave, CP504 + NOTE-DENSITY ①). OpenRouter
 * MOCKED (no live LLM). Locks: idx→section index-aligned map, keyPoints extracted
 * + capped at 3, omitted topic → empty slot (caller falls back), out-of-range idx
 * ignored, fence strip, newline collapse, honest fail (json / no-sections /
 * none-mapped), retry→fail, no_topics, legacy response without keyPoints accepted.
 */

const mockGenerate = jest.fn();
jest.mock('@/modules/llm/openrouter', () => ({
  OpenRouterGenerationProvider: jest.fn().mockImplementation(() => ({ generate: mockGenerate })),
}));
jest.mock('@/config/index', () => ({
  config: { paths: { logs: '/tmp' }, app: { isTest: true } },
}));

import {
  weaveChapterBody,
  parseChapterBodyResponse,
  type BodyTopicInput,
} from '../../../src/modules/mandala-book/book-body';

beforeEach(() => mockGenerate.mockReset());

describe('parseChapterBodyResponse (pure — no LLM)', () => {
  it('maps idx→section index-aligned, collapses newlines, strips fence, extracts keyPoints', () => {
    const raw =
      '```json\n{"sections":[' +
      '{"idx":0,"narrative":"첫\\n문장","keyPoints":["핵심A","핵심B"]},' +
      '{"idx":1,"narrative":"둘째","keyPoints":["포인트1"]}' +
      ']}\n```';
    const r = parseChapterBodyResponse(raw, 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sections[0]!.narrative).toBe('첫 문장');
    expect(r.sections[0]!.keyPoints).toEqual(['핵심A', '핵심B']);
    expect(r.sections[1]!.narrative).toBe('둘째');
    expect(r.sections[1]!.keyPoints).toEqual(['포인트1']);
  });

  it('leaves an empty-narrative slot for an omitted topic (caller keeps original summary)', () => {
    const raw = '{"sections":[{"idx":1,"narrative":"둘째만","keyPoints":["k1"]}]}';
    const r = parseChapterBodyResponse(raw, 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sections[0]!.narrative).toBe('');
    expect(r.sections[0]!.keyPoints).toEqual([]);
    expect(r.sections[1]!.narrative).toBe('둘째만');
    expect(r.sections[2]!.narrative).toBe('');
  });

  it('ignores out-of-range idx', () => {
    const raw = '{"sections":[{"idx":0,"narrative":"ok","keyPoints":["k"]},{"idx":9,"narrative":"버림"}]}';
    const r = parseChapterBodyResponse(raw, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sections[0]!.narrative).toBe('ok');
  });

  it('accepts legacy response without keyPoints field — returns empty array', () => {
    const raw = '{"sections":[{"idx":0,"narrative":"레거시 응답 — 키포인트 없음"}]}';
    const r = parseChapterBodyResponse(raw, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sections[0]!.keyPoints).toEqual([]);
  });

  it('caps keyPoints at 3 even if model returns more', () => {
    const raw =
      '{"sections":[{"idx":0,"narrative":"n","keyPoints":["a","b","c","d","e"]}]}';
    const r = parseChapterBodyResponse(raw, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sections[0]!.keyPoints).toHaveLength(3);
  });

  it('drops empty or whitespace-only keyPoint strings', () => {
    const raw = '{"sections":[{"idx":0,"narrative":"n","keyPoints":["ok","  ","","valid"]}]}';
    const r = parseChapterBodyResponse(raw, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sections[0]!.keyPoints).toEqual(['ok', 'valid']);
  });

  it('fails on invalid JSON / non-array / none mapped', () => {
    expect(parseChapterBodyResponse('nope', 2).ok).toBe(false);
    expect(parseChapterBodyResponse('{"sections":"x"}', 2).ok).toBe(false);
    expect(parseChapterBodyResponse('{"sections":[{"idx":5,"narrative":"oob"}]}', 2).ok).toBe(false);
  });
});

describe('weaveChapterBody (OpenRouter mocked)', () => {
  const topics: BodyTopicInput[] = [
    { topicTitle: '인사', summary: '기본 인사 표현' },
    { topicTitle: '주문', summary: '식당 주문 표현' },
  ];

  it('returns index-aligned sections with narratives and keyPoints on success', async () => {
    mockGenerate.mockResolvedValueOnce(
      '{"sections":[' +
        '{"idx":0,"narrative":"먼저 인사로 문을 연다","keyPoints":["인사=대화 시작점"]},' +
        '{"idx":1,"narrative":"이어 주문으로 나아간다","keyPoints":["주문 공식: I\\'d like + 명사"]}' +
        ']}'
    );
    const r = await weaveChapterBody('도입', '맥락', topics, 'goal');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sections[0]!.narrative).toBe('먼저 인사로 문을 연다');
    expect(r.sections[0]!.keyPoints).toEqual(['인사=대화 시작점']);
    expect(r.sections[1]!.narrative).toBe('이어 주문으로 나아간다');
  });

  it('retries then fails on provider error (caller keeps summaries)', async () => {
    mockGenerate.mockRejectedValue(new Error('boom'));
    const r = await weaveChapterBody('c', 'i', topics, 'goal');
    expect(r.ok).toBe(false);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it('no_topics on empty input — no LLM call', async () => {
    const r = await weaveChapterBody('c', 'i', [], 'goal');
    expect(r).toEqual({ ok: false, reason: 'no_topics' });
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
