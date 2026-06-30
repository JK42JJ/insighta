/**
 * book-body (§4.5.1 [3] chapter body weave, CP504 + NOTE-DENSITY ①/①-v2).
 * OpenRouter MOCKED (no live LLM).
 * Locks: idx→section index-aligned map, markdown narrative newlines PRESERVED
 * (NOT collapsed), keyPoint extracted as prose string, keyPoints back-compat array
 * (capped at 3), omitted topic → empty slot (caller falls back), out-of-range idx
 * ignored, fence strip, honest fail (json / no-sections / none-mapped),
 * retry→fail, no_topics, legacy response without keyPoint/keyPoints accepted.
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
  it('maps idx→section index-aligned, strips fence, extracts keyPoint + keyPoints back-compat', () => {
    const raw =
      '```json\n{"sections":[' +
      '{"idx":0,"narrative":"**핵심 용어** 설명","keyPoint":"이 섹션의 핵심","keyPoints":["핵심A","핵심B"]},' +
      '{"idx":1,"narrative":"둘째 단락","keyPoint":"두 번째 통찰"}' +
      ']}\n```';
    const r = parseChapterBodyResponse(raw, 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sections[0]!.narrative).toBe('**핵심 용어** 설명');
    expect(r.sections[0]!.keyPoint).toBe('이 섹션의 핵심');
    expect(r.sections[0]!.keyPoints).toEqual(['핵심A', '핵심B']);
    expect(r.sections[1]!.narrative).toBe('둘째 단락');
    expect(r.sections[1]!.keyPoint).toBe('두 번째 통찰');
  });

  it('preserves markdown newlines in narrative (NOT collapsed — markdown depends on them)', () => {
    const raw = '{"sections":[{"idx":0,"narrative":"첫 단락\\n\\n둘째 단락","keyPoint":"핵심"}]}';
    const r = parseChapterBodyResponse(raw, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // \n\n inside the JSON string becomes actual newlines after JSON.parse
    expect(r.sections[0]!.narrative).toBe('첫 단락\n\n둘째 단락');
  });

  it('preserves mermaid blocks (multi-line narrative)', () => {
    const mermaid = '```mermaid\nflowchart LR\nA-->B\n```';
    const raw = `{"sections":[{"idx":0,"narrative":"${mermaid.replace(/\n/g, '\\n')}","keyPoint":"흐름"}]}`;
    const r = parseChapterBodyResponse(raw, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sections[0]!.narrative).toBe(mermaid);
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
    const raw =
      '{"sections":[{"idx":0,"narrative":"ok","keyPoints":["k"]},{"idx":9,"narrative":"버림"}]}';
    const r = parseChapterBodyResponse(raw, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sections[0]!.narrative).toBe('ok');
  });

  it('accepts legacy response without keyPoint/keyPoints — keyPoint undefined, keyPoints []', () => {
    const raw = '{"sections":[{"idx":0,"narrative":"레거시 응답 — 키포인트 없음"}]}';
    const r = parseChapterBodyResponse(raw, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sections[0]!.keyPoints).toEqual([]);
    expect(r.sections[0]!.keyPoint).toBeUndefined();
  });

  it('caps keyPoints at 3 even if model returns more', () => {
    const raw = '{"sections":[{"idx":0,"narrative":"n","keyPoints":["a","b","c","d","e"]}]}';
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
    expect(parseChapterBodyResponse('{"sections":[{"idx":5,"narrative":"oob"}]}', 2).ok).toBe(
      false
    );
  });
});

describe('weaveChapterBody (OpenRouter mocked)', () => {
  const topics: BodyTopicInput[] = [
    { topicTitle: '인사', summary: '기본 인사 표현' },
    { topicTitle: '주문', summary: '식당 주문 표현' },
  ];

  it('returns index-aligned sections with narratives, keyPoint, and keyPoints on success', async () => {
    mockGenerate.mockResolvedValueOnce(
      '{"sections":[' +
        '{"idx":0,"narrative":"먼저 **인사**로 문을 연다","keyPoint":"인사는 대화의 시작점이다.","keyPoints":["인사=대화 시작점"]},' +
        '{"idx":1,"narrative":"이어 주문으로 나아간다","keyPoint":"주문 표현은 공식 패턴이 지배한다."}' +
        ']}'
    );
    const r = await weaveChapterBody('도입', '맥락', topics, 'goal');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sections[0]!.narrative).toBe('먼저 **인사**로 문을 연다');
    expect(r.sections[0]!.keyPoint).toBe('인사는 대화의 시작점이다.');
    expect(r.sections[0]!.keyPoints).toEqual(['인사=대화 시작점']);
    expect(r.sections[1]!.narrative).toBe('이어 주문으로 나아간다');
    expect(r.sections[1]!.keyPoint).toBe('주문 표현은 공식 패턴이 지배한다.');
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
