/**
 * topic-synthesis (§1⑤ COMPRESSION, CP504) — provenance-preserving compression.
 * The OpenRouter provider is MOCKED (no live LLM — unit test only). Locks:
 * atom_idx → {vid,ts} resolution, no-fabrication (out-of-range/dup dropped),
 * COMPRESSION drop (unplaced atoms → removed.compressed, NOT reassigned —
 * the old drop-0 fallback is gone), section cap, single-line content, honest fail.
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

const GOAL = 'AI 백엔드 마스터';
const atoms: TopicAtom[] = [
  { vid: 'vidA', ts: 10, text: 'REST 라우터로 요청을 분기한다' },
  { vid: 'vidA', ts: 50, text: '컨트롤러가 비즈니스 로직을 처리한다' },
  { vid: 'vidB', ts: 30, text: '스키마로 데이터 형태를 정의한다' },
];

beforeEach(() => mockGenerate.mockReset());

describe('buildTopicSynthesisPrompt', () => {
  it('indexes atoms, carries the center goal, and demands compression + single-line content', () => {
    const p = buildTopicSynthesisPrompt('백엔드', atoms, 6, GOAL);
    expect(p).toContain('[0] REST 라우터');
    expect(p).toContain('[2] 스키마로');
    expect(p).toContain(GOAL); // center goal = importance yardstick
    expect(p).toContain('중요도 선별'); // compression, not enumeration
    expect(p).toContain('의도적으로 버린다'); // intentional drop
    expect(p).toContain('개행'); // single-line content guard (JSON protection)
    expect(p).toContain('최대 6개');
  });
});

describe('synthesizeCellTopics (compression)', () => {
  it('resolves atom_idx → {vid,ts} provenance; removed.compressed empty when all kept', async () => {
    mockGenerate.mockResolvedValue(
      JSON.stringify({
        sections: [
          { title: 'API 라우팅 구조', content: '라우터→컨트롤러', atom_idx: [0, 1] },
          { title: '데이터 스키마', content: '형태 정의', atom_idx: [2] },
        ],
      })
    );
    const r = await synthesizeCellTopics('백엔드', atoms, GOAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.topics).toHaveLength(2);
    expect(r.topics[0]!.topic_title).toBe('API 라우팅 구조');
    expect(r.topics[0]!.summary).toBe('라우터→컨트롤러');
    expect(r.topics[0]!.atom_refs).toEqual([
      { vid: 'vidA', ts: 10 },
      { vid: 'vidA', ts: 50 },
    ]);
    expect(r.topics[1]!.atom_refs).toEqual([{ vid: 'vidB', ts: 30 }]);
    expect(r.removed.compressed).toEqual([]); // all atoms kept
  });

  it('COMPRESSION drop: unplaced atoms → removed.compressed, NOT reassigned (no fallback)', async () => {
    // model keeps only atom 0; atoms 1,2 are intentionally dropped (compression).
    mockGenerate.mockResolvedValue(
      JSON.stringify({ sections: [{ title: 'T', content: '핵심', atom_idx: [0] }] })
    );
    const r = await synthesizeCellTopics('c', atoms, GOAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.topics[0]!.atom_refs).toEqual([{ vid: 'vidA', ts: 10 }]); // ONLY atom 0
    expect(r.removed.compressed).toEqual([1, 2]); // dropped, not reassigned
    expect(r.removed.dedup).toEqual([]);
    expect(r.removed.safety).toEqual([]);
  });

  it('ignores out-of-range/dup indices (no fabrication); the unplaced are dropped', async () => {
    mockGenerate.mockResolvedValue(
      JSON.stringify({ sections: [{ title: 'T', content: '', atom_idx: [0, 0, 9, -1] }] })
    );
    const r = await synthesizeCellTopics('c', atoms, GOAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // idx 0 valid; 0(dup)/9(oob)/-1(oob) ignored. atoms 1,2 unplaced → compressed.
    expect(r.topics[0]!.atom_refs).toEqual([{ vid: 'vidA', ts: 10 }]);
    expect(r.removed.compressed).toEqual([1, 2]);
  });

  it('collapses a stray newline in content (JSON-trip guard)', async () => {
    mockGenerate.mockResolvedValue(
      JSON.stringify({ sections: [{ title: 'T', content: 'line1\nline2', atom_idx: [0] }] })
    );
    const r = await synthesizeCellTopics('c', atoms, GOAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.topics[0]!.summary).toBe('line1 line2'); // newline collapsed to space
  });

  it('drops a section with no valid atoms → honest fail when none remain', async () => {
    mockGenerate.mockResolvedValue(
      JSON.stringify({ sections: [{ title: 'Empty', atom_idx: [99] }] })
    );
    const r = await synthesizeCellTopics('c', atoms, GOAL);
    expect(r.ok).toBe(false); // no valid section → honest fail
  });

  it('honest fail on unparseable LLM output', async () => {
    mockGenerate.mockResolvedValue('not json');
    const r = await synthesizeCellTopics('c', atoms, GOAL);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('json_parse');
  });

  it('honest fail when atoms empty (no LLM call)', async () => {
    const r = await synthesizeCellTopics('c', [], GOAL);
    expect(r.ok).toBe(false);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('retries once on a truncated/parse failure, then succeeds (no silent revert)', async () => {
    mockGenerate
      .mockResolvedValueOnce('{"sections":[{"title":"T","atom_idx":[0,1') // truncated
      .mockResolvedValueOnce(
        JSON.stringify({ sections: [{ title: 'API', content: '', atom_idx: [0, 1, 2] }] })
      );
    const r = await synthesizeCellTopics('c', atoms, GOAL);
    expect(mockGenerate).toHaveBeenCalledTimes(2); // retried
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.topics[0]!.topic_title).toBe('API');
  });

  it('hard-fails (loud) after all retries exhausted', async () => {
    mockGenerate.mockResolvedValue('not json'); // both attempts fail
    const r = await synthesizeCellTopics('c', atoms, GOAL);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('hard_fail'); // surfaced as hard fail, not silent
  });
});
