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

  it('legacy mode (no topics): one section per video, title=video.title (byte-identical)', () => {
    const cell: CellInput = { cellIndex: 0, title: 'c', videos: [vid('vidA', [10])] };
    const { book } = buildBookJson(base([cell]));
    const secs = sectionsOf(book);
    expect(secs).toHaveLength(1);
    expect(secs[0]!.title).toBe('VIDEO TITLE vidA');
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
