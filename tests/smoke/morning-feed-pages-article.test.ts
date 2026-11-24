import {
  ARTICLE_CORE_MAX,
  ARTICLE_CORE_MIN,
  isArticleCore,
  readPage,
  validatePage,
} from '@/modules/morning-feed/pages';
import { FeedValidationError, type FeedDb } from '@/modules/morning-feed/feed';

export {};

/*
 * Article format (decision 2026-11-22): core items carry `para` (1 or 2), videos carry `role`.
 * Both survive validation (import) and reading; the earlier format is validated as before.
 */

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-23T03:00:00Z');
const CELL = '재테크/투자';
const A = 'aaaaaaaaaaa';
const B = 'bbbbbbbbbbb';
const C = 'ccccccccccc';
const SENTENCES = 6;
const FIRST_PARA_SENTENCES = 4;

function articlePage(): Record<string, any> {
  return {
    domain: CELL,
    seen_date: '2026-11-22',
    headline: 'H',
    core: Array.from({ length: SENTENCES }, (_, i) => ({
      text: `s${i + 1}`,
      sources: [{ video_id: i % 2 === 0 ? A : B, t: 60 * (i + 1) }],
      para: i < FIRST_PARA_SENTENCES ? 1 : 2,
    })),
    note: [{ heading: 'h', paragraphs: [{ text: 'p', sources: [{ video_id: C, t: 12 }] }] }],
    videos: [
      { video_id: A, title: 'TA', channel: 'CA', useful_for: 'a', role: 'support' },
      { video_id: B, title: 'TB', channel: 'CB', useful_for: 'b', role: 'condition' },
      { video_id: C, title: 'TC', channel: 'CC', useful_for: 'c', role: 'other' },
    ],
  };
}

function bad(mutate: (p: Record<string, any>) => void, msg: RegExp) {
  const p = articlePage();
  mutate(p);
  expect(() => validatePage(p)).toThrow(FeedValidationError);
  expect(() => validatePage(p)).toThrow(msg);
}

describe('validatePage: article format', () => {
  it('keeps para on core items and role on videos; unknown fields are still dropped', () => {
    expect(validatePage(articlePage())).toEqual(articlePage());
    const p = articlePage();
    p['core'][0].extra = 1;
    p['videos'][0].extra = 1;
    p['note'][0].paragraphs[0].para = 1;
    const out = validatePage(p);
    expect(out).toEqual(articlePage());
    expect(isArticleCore(out.core)).toBe(true);
  });

  it('accepts 5 and 8 sentences, one paragraph alone, and videos without role', () => {
    for (const n of [ARTICLE_CORE_MIN, ARTICLE_CORE_MAX]) {
      const p = articlePage();
      p['core'] = Array.from({ length: n }, (_, i) => ({
        text: `s${i}`,
        sources: [{ video_id: A, t: i }],
        para: 1,
      }));
      expect(validatePage(p).core).toHaveLength(n);
    }
    const q = articlePage();
    for (const v of q['videos']) delete v.role;
    expect(validatePage(q).videos.every((v) => !('role' in v))).toBe(true);
  });

  it('rejects a bad para, a mixed core, a wrong count, a sentence without a source, a bad role', () => {
    bad((p) => (p['core'][0].para = 3), /core\[0\]\.para/);
    bad((p) => (p['core'][0].para = '1'), /core\[0\]\.para/);
    bad((p) => (p['core'][0].para = 0), /core\[0\]\.para/);
    bad((p) => delete p['core'][2].para, /core\[2\]\.para/);
    bad((p) => (p['core'] = p['core'].slice(0, ARTICLE_CORE_MIN - 1)), /core must have 5 to 8/);
    bad(
      (p) =>
        (p['core'] = Array.from({ length: ARTICLE_CORE_MAX + 1 }, () => ({ ...p['core'][0] }))),
      /core must have 5 to 8/
    );
    bad((p) => (p['core'][1].sources = []), /core\[1\]\.sources must have at least one/);
    bad((p) => (p['videos'][0].role = 'main'), /videos\[0\]\.role/);
    bad((p) => (p['videos'][1].role = 1), /videos\[1\]\.role/);
  });

  it('the earlier format is unchanged: no para, any count, a core item may have no source', () => {
    const p = articlePage();
    p['core'] = [
      { text: 'only', sources: [] },
      { text: 'two', sources: [{ video_id: A, t: 0 }] },
    ];
    for (const v of p['videos']) delete v.role;
    const out = validatePage(p);
    expect(out.core).toEqual(p['core']);
    expect(isArticleCore(out.core)).toBe(false);
    expect('para' in out.core[0]!).toBe(false);
  });
});

describe('reading an article page', () => {
  it('readPage returns para and role as stored', async () => {
    const stored = articlePage();
    const db: FeedDb = {
      $queryRawUnsafe: jest.fn(async () => [
        {
          cell: CELL,
          seen_date: stored['seen_date'],
          headline: stored['headline'],
          core: stored['core'],
          note: stored['note'],
          videos: stored['videos'],
        },
      ]) as never,
      $executeRawUnsafe: jest.fn(async () => 1) as never,
    };
    const page = await readPage(db, USER, CELL, '2026-11-22', NOW);
    expect(page?.core.map((c) => c.para)).toEqual([1, 1, 1, 1, 2, 2]);
    expect(page?.videos.map((v) => v.role)).toEqual(['support', 'condition', 'other']);
  });
});
