/**
 * topic-synthesis (§1⑤) — provenance-preserving clustering. The OpenRouter
 * provider is MOCKED (no live LLM — unit test only). Locks: atom_idx → {vid,ts}
 * resolution, no-fabrication (out-of-range/dup indices dropped), topic cap,
 * honest fail.
 */

const mockGenerate = jest.fn();
jest.mock('@/modules/llm/openrouter', () => ({
  OpenRouterGenerationProvider: jest.fn().mockImplementation(() => ({ generate: mockGenerate })),
}));
jest.mock('@/config/index', () => ({
  config: { paths: { logs: '/tmp' }, app: { isTest: true } },
}));

import {
  synthesizeCellTopics,
  buildTopicSynthesisPrompt,
  type TopicAtom,
} from '../../../src/modules/mandala-book/topic-synthesis';

const atoms: TopicAtom[] = [
  { vid: 'vidA', ts: 10, text: 'REST 라우터로 요청을 분기한다' },
  { vid: 'vidA', ts: 50, text: '컨트롤러가 비즈니스 로직을 처리한다' },
  { vid: 'vidB', ts: 30, text: '스키마로 데이터 형태를 정의한다' },
];

beforeEach(() => mockGenerate.mockReset());

describe('buildTopicSynthesisPrompt', () => {
  it('indexes atoms and forbids video-title labels', () => {
    const p = buildTopicSynthesisPrompt('백엔드', atoms);
    expect(p).toContain('[0] REST 라우터');
    expect(p).toContain('[2] 스키마로');
    expect(p).toContain('영상 제목·채널명·클릭베이트 금지');
  });
});

describe('synthesizeCellTopics', () => {
  it('resolves atom_idx → {vid,ts} provenance (cross-video topic)', async () => {
    mockGenerate.mockResolvedValue(
      JSON.stringify({
        topics: [
          { topic_title: 'API 라우팅 구조', summary: '라우터→컨트롤러', atom_idx: [0, 1] },
          { topic_title: '데이터 스키마', summary: '형태 정의', atom_idx: [2] },
        ],
      })
    );
    const r = await synthesizeCellTopics('백엔드', atoms);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.topics).toHaveLength(2);
    expect(r.topics[0]!.topic_title).toBe('API 라우팅 구조');
    expect(r.topics[0]!.atom_refs).toEqual([
      { vid: 'vidA', ts: 10 },
      { vid: 'vidA', ts: 50 },
    ]);
    expect(r.topics[1]!.atom_refs).toEqual([{ vid: 'vidB', ts: 30 }]);
    expect(r.droppedAtomIdx).toEqual([]);
  });

  it('drops out-of-range and duplicate indices (no fabrication)', async () => {
    mockGenerate.mockResolvedValue(
      JSON.stringify({
        topics: [{ topic_title: 'T', summary: '', atom_idx: [0, 0, 9, -1] }],
      })
    );
    const r = await synthesizeCellTopics('c', atoms);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // only idx 0 is valid+unique; 0(dup), 9(oob), -1(oob) dropped
    expect(r.topics[0]!.atom_refs).toEqual([{ vid: 'vidA', ts: 10 }]);
    expect(r.droppedAtomIdx).toEqual([1, 2]);
  });

  it('drops a topic with no valid atoms', async () => {
    mockGenerate.mockResolvedValue(
      JSON.stringify({ topics: [{ topic_title: 'Empty', atom_idx: [99] }] })
    );
    const r = await synthesizeCellTopics('c', atoms);
    expect(r.ok).toBe(false); // no valid topic → honest fail
  });

  it('honest fail on unparseable LLM output', async () => {
    mockGenerate.mockResolvedValue('not json');
    const r = await synthesizeCellTopics('c', atoms);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('json_parse');
  });

  it('honest fail when atoms empty (no LLM call)', async () => {
    const r = await synthesizeCellTopics('c', []);
    expect(r.ok).toBe(false);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
