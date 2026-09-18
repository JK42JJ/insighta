/**
 * Evidence extraction — the stage that decides whether an issue can be checked.
 *
 * Every assertion here is about the one property the quote checks depend on:
 * a run must be findable in the caption it came from, character for character.
 * A run that was rewritten, trimmed mid-token, or reflowed is worse than no
 * run at all, because the quote check will pass it and the reader cannot.
 */

jest.mock('@/utils/logger', () => ({
  logger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));
jest.mock('@/modules/database/client', () => ({ getPrismaClient: () => ({}) }));

import {
  extractRuns,
  makeS8Evidence,
  MAX_QUOTE_CHARS,
  type CaptionSource,
} from '@/modules/newsletter/pipeline/stages/s8-evidence';
import type { CorpusRow } from '@/modules/newsletter/pipeline/corpus';
import type { StageContext } from '@/modules/newsletter/pipeline/stage';

const CAPTION = [
  '오늘은 서빙 이야기를 해 보겠습니다.',
  '이 카드에서는 약 637,000토큰입니다.',
  'The NVIDIA L4 has 24GB of memory.',
  '그래서 좋습니다.',
].join(' ');

describe('extractRuns', () => {
  it('keeps every run verbatim — the quote check is a substring test', () => {
    for (const r of extractRuns(CAPTION)) {
      expect(CAPTION.normalize('NFC')).toContain(r.quoted);
    }
  });

  it('records offsets that land on the run', () => {
    const text = CAPTION.normalize('NFC');
    for (const r of extractRuns(CAPTION)) {
      expect(text.slice(r.from, r.to)).toBe(r.quoted);
    }
  });

  it('keeps a sentence with a figure and drops one without', () => {
    const kept = extractRuns(CAPTION).map((r) => r.quoted);
    expect(kept.some((q) => q.includes('637,000'))).toBe(true);
    expect(kept.some((q) => q.includes('그래서 좋습니다'))).toBe(false);
  });

  it('says what made each run worth keeping', () => {
    const r = extractRuns(CAPTION).find((x) => x.quoted.includes('637,000'));
    expect(r?.carries).toContain('number');
    expect(r?.carries).toContain('unit');
  });

  it('splits captions that arrive without punctuation', () => {
    const noPunct = '첫 줄은 설명입니다\n두 번째 줄에 512편이 나옵니다\n세 번째 줄';
    const kept = extractRuns(noPunct).map((r) => r.quoted);
    expect(kept).toContain('두 번째 줄에 512편이 나옵니다');
  });

  it('trims a long run at a word boundary and stays findable', () => {
    const long = `앞머리 ${'가 '.repeat(140)}끝에 512편`;
    for (const r of extractRuns(long)) {
      expect(r.quoted.length).toBeLessThanOrEqual(MAX_QUOTE_CHARS);
      expect(long.normalize('NFC')).toContain(r.quoted);
    }
  });

  it('compares as NFC, so a decomposed caption still matches', () => {
    const decomposed = CAPTION.normalize('NFD');
    for (const r of extractRuns(decomposed)) {
      expect(CAPTION.normalize('NFC')).toContain(r.quoted);
    }
  });
});

describe('S8 stage', () => {
  const row = (videoId: string): CorpusRow =>
    ({ videoId, title: 't', channelId: 'c', enrichment: {} }) as unknown as CorpusRow;
  const ctx = {} as StageContext;

  it('counts videos with and without captions, and drops neither', async () => {
    const captions: CaptionSource = {
      get: async (id) => (id === 'has' ? CAPTION : null),
    };
    const result = await makeS8Evidence(captions).run([row('has'), row('none')], ctx);

    expect(result.drops).toHaveLength(0);
    expect(result.survivors).toHaveLength(2);
    expect(result.detail).toMatchObject({ withCaptions: 1, withoutCaptions: 1 });
  });

  it('records the run count on the video it came from', async () => {
    const captions: CaptionSource = { get: async () => CAPTION };
    const result = await makeS8Evidence(captions).run([row('a')], ctx);
    const e = result.survivors[0]?.enrichment as { evidenceRuns?: number };
    expect(e.evidenceRuns).toBeGreaterThan(0);
  });

  it('is the same on a second run — no model, no clock', async () => {
    const captions: CaptionSource = { get: async () => CAPTION };
    const a = await makeS8Evidence(captions).run([row('a')], ctx);
    const b = await makeS8Evidence(captions).run([row('a')], ctx);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
