/**
 * build-book §1⑤ topic mode — sections per TOPIC (not video) when cell.topics
 * present; atom_refs {vid,ts} resolved against the cell's videos (provenance);
 * legacy per-video fallback when topics absent. build-book stays pure.
 */

import {
  buildBookJson,
  type CellInput,
  type CellVideoV2,
} from '../../../src/modules/mandala-book/build-book';

const vid = (id: string, atomTs: number[]): CellVideoV2 => ({
  videoId: id,
  title: `VIDEO TITLE ${id}`, // legacy section title = this (the defect-1 string)
  analysis: { core_argument: `core ${id}` } as never,
  segments: {
    atoms: atomTs.map((ts) => ({ timestamp_sec: ts, text: `atom ${id}@${ts}` })),
    sections: [],
  } as never,
  lora: { qa_pairs: [{ q: `q ${id}`, a: `a ${id}` }] } as never,
});

const base = (cells: CellInput[]) => ({
  mandalaId: 'm',
  mandalaTitle: 'T',
  generatedAt: '2026',
  cells,
});

type Sec = {
  title: string;
  narrative: string;
  atoms: Array<{ vid: string; ts: number }>;
  qa: unknown[];
};
const sectionsOf = (book: { chapters: Array<{ sections: unknown[] }> }): Sec[] =>
  book.chapters[0]!.sections as Sec[];

describe('buildBookJson — topic mode (§1⑤)', () => {
  it('builds one section per topic; title=topic_title, atoms resolved cross-video', () => {
    const cell: CellInput = {
      cellIndex: 0,
      title: '백엔드',
      videos: [vid('vidA', [10, 50]), vid('vidB', [30])],
      topics: [
        {
          topic_title: 'API 라우팅 구조', // CONTENT name, not video title
          summary: '라우터→컨트롤러 흐름',
          atom_refs: [
            { vid: 'vidA', ts: 10 },
            { vid: 'vidB', ts: 30 }, // cross-video topic
          ],
        },
        {
          topic_title: '컨트롤러 처리',
          summary: '로직 처리',
          atom_refs: [{ vid: 'vidA', ts: 50 }],
        },
      ],
    };
    const { book } = buildBookJson(base([cell]));
    const secs = sectionsOf(book);
    expect(secs).toHaveLength(2);
    // section title = topic name (NOT "VIDEO TITLE ...") → defect-1 removed
    expect(secs[0]!.title).toBe('API 라우팅 구조');
    expect(secs[0]!.narrative).toBe('라우터→컨트롤러 흐름');
    // atoms resolved from refs, preserving vid/ts provenance (cross-video)
    expect(secs[0]!.atoms.map((a) => `${a.vid}:${a.ts}`)).toEqual(['vidA:10', 'vidB:30']);
    expect(secs[1]!.atoms.map((a) => a.ts)).toEqual([50]);
    // qa gathered from the topic's source videos
    expect(secs[0]!.qa.length).toBe(2); // vidA + vidB qa
  });

  it('CP504 surface-fix #1 — dedups provenance atoms + qa by text', () => {
    const dupVid: CellVideoV2 = {
      videoId: 'vidD',
      title: 'VIDEO TITLE vidD',
      analysis: { core_argument: 'core' } as never,
      segments: {
        atoms: [
          { timestamp_sec: 1, text: '같은 문장' },
          { timestamp_sec: 2, text: '같은 문장' }, // v2 near-dup
          { timestamp_sec: 3, text: '같은 문장' }, // v2 near-dup
          { timestamp_sec: 4, text: '다른 문장' },
        ],
        sections: [],
      } as never,
      lora: {
        qa_pairs: [
          { q: 'q', a: 'a' },
          { q: 'q', a: 'a' }, // dup qa
        ],
      } as never,
    };
    const cell: CellInput = {
      cellIndex: 0,
      title: 'c',
      videos: [dupVid],
      topics: [
        {
          topic_title: 't',
          summary: 's',
          atom_refs: [
            { vid: 'vidD', ts: 1 },
            { vid: 'vidD', ts: 2 },
            { vid: 'vidD', ts: 3 },
            { vid: 'vidD', ts: 4 },
          ],
        },
      ],
    };
    const sec = sectionsOf(buildBookJson(base([cell])).book)[0]!;
    // 3 same-text + 1 distinct → 2 atoms; first {vid,ts} (ts=1) wins (provenance kept)
    expect(sec.atoms.map((a) => (a as unknown as { text: string }).text)).toEqual([
      '같은 문장',
      '다른 문장',
    ]);
    expect(sec.atoms[0]!.ts).toBe(1);
    expect(sec.qa).toHaveLength(1); // identical qa pair collapsed
  });

  it('legacy mode (no topics): one section per video, title=video.title (byte-identical)', () => {
    const cell: CellInput = { cellIndex: 0, title: 'c', videos: [vid('vidA', [10])] };
    const { book } = buildBookJson(base([cell]));
    const secs = sectionsOf(book);
    expect(secs).toHaveLength(1);
    expect(secs[0]!.title).toBe('VIDEO TITLE vidA');
  });

  it('threads keyPoint (prose synthesis) from topic into section — NOTE-DENSITY ①-v2', () => {
    const cell: CellInput = {
      cellIndex: 0,
      title: 'c',
      videos: [vid('vidA', [10])],
      topics: [
        {
          topic_title: '주제',
          summary: '요약',
          atom_refs: [{ vid: 'vidA', ts: 10 }],
          keyPoint: '이 섹션의 핵심 통찰을 2-3문장으로 요약한 산문이다.',
          keyPoints: ['항목 A'], // back-compat — both can coexist
        },
      ],
    };
    const { book } = buildBookJson(base([cell]));
    const sec = sectionsOf(book)[0]! as Record<string, unknown>;
    expect(sec['keyPoint']).toBe('이 섹션의 핵심 통찰을 2-3문장으로 요약한 산문이다.');
    expect(sec['keyPoints']).toEqual(['항목 A']);
  });

  it('source counters identical regardless of mode', () => {
    const videos = [vid('vidA', [10, 50]), vid('vidB', [30])];
    const legacy = buildBookJson(base([{ cellIndex: 0, title: 'c', videos }]));
    const topic = buildBookJson(
      base([
        {
          cellIndex: 0,
          title: 'c',
          videos,
          topics: [{ topic_title: 't', summary: '', atom_refs: [{ vid: 'vidA', ts: 10 }] }],
        },
      ])
    );
    expect(topic.sourceVideos).toBe(legacy.sourceVideos); // 2
    expect(topic.sourceAtoms).toBe(legacy.sourceAtoms); // 3
  });
});
