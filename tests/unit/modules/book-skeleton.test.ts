/**
 * book-skeleton (§4.5.1 [2] narrative skeleton, CP504) + build-book skeleton mode.
 * OpenRouter is MOCKED (no live LLM — LLM-API ban). Locks:
 *   - parse/resolve: topic_idx → refs, out-of-range/dup dropped (no fabrication),
 *     empty chapter dropped, code-fence strip, newline collapse, honest fail
 *   - synth: ok + unplaced computed, retry→hard-fail, no_topics
 *   - build-book skeleton mode = chapters from skeleton (cross-cell, NOT cell 1:1),
 *     ch sequential, intro POPULATED, global atom resolution; legacy unchanged
 */

const mockGenerate = jest.fn();
jest.mock('@/modules/llm/openrouter', () => ({
  OpenRouterGenerationProvider: jest.fn().mockImplementation(() => ({ generate: mockGenerate })),
}));
jest.mock('@/config/index', () => ({
  config: { paths: { logs: '/tmp' }, app: { isTest: true } },
}));

import {
  synthesizeBookSkeleton,
  parseSkeletonResponse,
  type SkeletonTopicInput,
} from '../../../src/modules/mandala-book/book-skeleton';
import { buildBookJson, type BuildBookInput } from '../../../src/modules/mandala-book/build-book';
import type { RichSummarySegments } from '../../../src/modules/skills/rich-summary-v2-prompt';

beforeEach(() => mockGenerate.mockReset());

describe('parseSkeletonResponse (pure — no LLM)', () => {
  it('resolves topic_idx, drops out-of-range + duplicate, strips code fence', () => {
    const raw = '```json\n{"chapters":[{"title":"도입","intro":"왜","topic_idx":[0,1,9,1]}]}\n```';
    const r = parseSkeletonResponse(raw, 3, 12);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.skeleton.chapters).toHaveLength(1);
      expect(r.skeleton.chapters[0]!.topic_refs).toEqual([0, 1]); // 9 oob, 2nd 1 dup → dropped
    }
  });

  it('drops a chapter that cites no real topic (no fabrication)', () => {
    const raw =
      '{"chapters":[{"title":"빈","intro":"x","topic_idx":[99]},{"title":"진짜","intro":"y","topic_idx":[0]}]}';
    const r = parseSkeletonResponse(raw, 2, 12);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.skeleton.chapters).toHaveLength(1);
      expect(r.skeleton.chapters[0]!.title).toBe('진짜');
    }
  });

  it('collapses stray newlines in title/intro (JSON-parse guard)', () => {
    const raw = '{"chapters":[{"title":"a\\nb","intro":"c\\n d","topic_idx":[0]}]}';
    const r = parseSkeletonResponse(raw, 1, 12);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.skeleton.chapters[0]!.title).toBe('a b');
      expect(r.skeleton.chapters[0]!.intro).toBe('c d');
    }
  });

  it('does not place one topic in two chapters (dedup across chapters)', () => {
    const raw =
      '{"chapters":[{"title":"A","intro":"","topic_idx":[0,1]},{"title":"B","intro":"","topic_idx":[1,2]}]}';
    const r = parseSkeletonResponse(raw, 3, 12);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.skeleton.chapters[0]!.topic_refs).toEqual([0, 1]);
      expect(r.skeleton.chapters[1]!.topic_refs).toEqual([2]); // 1 already used by chapter A
    }
  });

  // CP504 §11 — a RAW (unescaped) newline inside intro/title is what actually
  // trips JSON.parse in prod. parseJsonLenient escapes it in-place, so the parse
  // succeeds WITHOUT the caller paying an LLM retry.
  it('salvages a RAW unescaped newline inside a string value (lenient parse)', () => {
    const raw = '{"chapters":[{"title":"도입","intro":"첫 줄\n둘째 줄","topic_idx":[0]}]}';
    const r = parseSkeletonResponse(raw, 1, 12);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.skeleton.chapters).toHaveLength(1);
      expect(r.skeleton.chapters[0]!.intro).toBe('첫 줄 둘째 줄'); // restored then collapsed (no loss)
    }
  });

  // A maxTokens truncation is salvaged too (close the open brackets) — no retry.
  it('salvages a truncated skeleton response (bracket-close)', () => {
    const raw = '{"chapters":[{"title":"도입","intro":"i","topic_idx":[0';
    const r = parseSkeletonResponse(raw, 2, 12);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.skeleton.chapters[0]!.topic_refs).toEqual([0]);
  });

  it('fails on non-array / invalid JSON / no-valid-refs', () => {
    expect(parseSkeletonResponse('{"chapters":"x"}', 1, 12).ok).toBe(false);
    expect(parseSkeletonResponse('not json', 1, 12).ok).toBe(false);
    expect(
      parseSkeletonResponse('{"chapters":[{"title":"a","intro":"b","topic_idx":[5]}]}', 1, 12).ok
    ).toBe(false);
  });
});

describe('synthesizeBookSkeleton (OpenRouter mocked)', () => {
  const topics: SkeletonTopicInput[] = [
    { cellIndex: 0, cellTitle: '기초', topicTitle: '인사', summary: '기본 인사 표현' },
    { cellIndex: 1, cellTitle: '실전', topicTitle: '주문', summary: '식당 주문 표현' },
    { cellIndex: 3, cellTitle: '기초', topicTitle: '숫자', summary: '숫자 읽기' },
  ];

  it('returns skeleton + computes unplaced topics (transparency)', async () => {
    mockGenerate.mockResolvedValueOnce(
      '{"chapters":[{"title":"도입","intro":"i","topic_idx":[0,2]}]}'
    );
    const r = await synthesizeBookSkeleton(topics, 'goal');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.skeleton.chapters).toHaveLength(1);
      expect(r.unplaced).toEqual([1]); // topic 1 not placed by the model
    }
  });

  it('retries then hard-fails on provider error', async () => {
    mockGenerate.mockRejectedValue(new Error('boom'));
    const r = await synthesizeBookSkeleton(topics, 'goal');
    expect(r.ok).toBe(false);
    expect(mockGenerate).toHaveBeenCalledTimes(2); // SKELETON_ATTEMPTS
  });

  it('no_topics on empty input — no LLM call', async () => {
    const r = await synthesizeBookSkeleton([], 'goal');
    expect(r).toEqual({ ok: false, reason: 'no_topics' });
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

describe('buildBookJson skeleton mode (gate[2]: cross-cell, ch sequential, intro populated)', () => {
  const seg = (atoms: Array<{ text: string; timestamp_sec: number }>): RichSummarySegments =>
    ({
      sections: [],
      atoms: atoms.map((a, i) => ({
        idx: i,
        type: 'fact',
        text: a.text,
        timestamp_sec: a.timestamp_sec,
      })),
    }) as unknown as RichSummarySegments;

  // Two cells, one topic each; the skeleton MERGES both into a single chapter.
  const input = (skeleton?: BuildBookInput['skeleton']): BuildBookInput => ({
    mandalaId: '72d5fe52-2f35-4a9e-8ef6-cd21629173ef',
    mandalaTitle: '일본어 회화',
    generatedAt: '2026-06-29T00:00:00.000Z',
    cells: [
      {
        cellIndex: 0,
        title: '기초',
        videos: [
          {
            videoId: 'vidA',
            title: 'A',
            analysis: null,
            segments: seg([{ text: '인사 표현', timestamp_sec: 10 }]),
            lora: null,
          },
        ],
        topics: [
          { topic_title: '인사', summary: '인사 표현', atom_refs: [{ vid: 'vidA', ts: 10 }] },
        ],
      },
      {
        cellIndex: 1,
        title: '실전',
        videos: [
          {
            videoId: 'vidB',
            title: 'B',
            analysis: null,
            segments: seg([{ text: '주문 표현', timestamp_sec: 20 }]),
            lora: null,
          },
        ],
        topics: [
          { topic_title: '주문', summary: '주문 표현', atom_refs: [{ vid: 'vidB', ts: 20 }] },
        ],
      },
    ],
    skeleton,
  });

  it('builds chapters FROM the skeleton — cross-cell merge, ch sequential, intro populated', () => {
    // flat topics: [0]=인사(cell0), [1]=주문(cell1). One chapter merges both.
    const { book } = buildBookJson(
      input({
        chapters: [
          { title: '한 권의 책: 기초→실전', intro: '기초를 다지고 실전으로', topic_refs: [0, 1] },
        ],
      })
    );
    expect(book.chapters).toHaveLength(1); // NOT 2 cells → reconstruction (gate 2a)
    const ch = book.chapters[0]!;
    expect(ch.ch).toBe(0); // sequential narrative order
    expect(ch.intro).toBe('기초를 다지고 실전으로'); // POPULATED (legacy cell mode = '')
    expect(ch.sections).toHaveLength(2); // both topics, across cells
    // global atom resolution: section 0 ← vidA (cell0), section 1 ← vidB (cell1)
    expect(ch.sections[0]!.atoms![0]!.vid).toBe('vidA');
    expect(ch.sections[1]!.atoms![0]!.vid).toBe('vidB');
  });

  it('drops a skeleton chapter whose topic_refs all fail to resolve', () => {
    const { book } = buildBookJson(
      input({
        chapters: [
          { title: '유령', intro: 'x', topic_refs: [99] }, // unresolvable → dropped
          { title: '진짜', intro: 'y', topic_refs: [0] },
        ],
      })
    );
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0]!.title).toBe('진짜');
  });

  it('legacy cell=chapter assembly is UNCHANGED when no skeleton', () => {
    const { book } = buildBookJson(input(undefined));
    expect(book.chapters).toHaveLength(2); // one chapter per cell
    expect(book.chapters.map((c) => c.ch)).toEqual([0, 1]); // ch = cellIndex
    expect(book.chapters[0]!.intro).toBe(''); // cell mode leaves intro empty
  });
});
