/**
 * book-body (§4.5.1 [3] chapter body weave, CP504). OpenRouter MOCKED (no live
 * LLM). Locks: idx→narrative index-aligned map, omitted topic → empty slot
 * (caller falls back), out-of-range idx ignored, fence strip, newline collapse,
 * honest fail (json / no-sections / none-mapped), retry→fail, no_topics.
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
  it('maps idx→narrative index-aligned, collapses newlines, strips fence', () => {
    const raw = '```json\n{"sections":[{"idx":0,"narrative":"첫\\n문장"},{"idx":1,"narrative":"둘째"}]}\n```';
    const r = parseChapterBodyResponse(raw, 2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.narratives).toEqual(['첫 문장', '둘째']);
  });

  it('leaves an empty slot for an omitted topic (caller keeps original summary)', () => {
    const raw = '{"sections":[{"idx":1,"narrative":"둘째만"}]}';
    const r = parseChapterBodyResponse(raw, 3);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.narratives).toEqual(['', '둘째만', '']);
  });

  it('ignores out-of-range idx', () => {
    const raw = '{"sections":[{"idx":0,"narrative":"ok"},{"idx":9,"narrative":"버림"}]}';
    const r = parseChapterBodyResponse(raw, 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.narratives).toEqual(['ok']);
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

  it('returns index-aligned narratives on success', async () => {
    mockGenerate.mockResolvedValueOnce(
      '{"sections":[{"idx":0,"narrative":"먼저 인사로 문을 연다"},{"idx":1,"narrative":"이어 주문으로 나아간다"}]}'
    );
    const r = await weaveChapterBody('도입', '맥락', topics, 'goal');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.narratives).toEqual(['먼저 인사로 문을 연다', '이어 주문으로 나아간다']);
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
