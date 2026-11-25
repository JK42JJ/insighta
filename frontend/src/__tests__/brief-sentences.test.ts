import { describe, expect, it } from 'vitest';

import type { MorningPage } from '@/features/morning-cards/api';
import {
  briefSentences,
  briefText,
  splitSentences,
  usedParts,
} from '@/features/morning-feed/brief-sentences';
import real from '@/features/morning-feed/brief-sentences.fixture.json';

/** Sentences per paragraph, counted by hand on the page. */
const COUNTS = [5, 3, 4, 4, 4, 4, 3, 5, 3];
const EXPECTED_IDS = COUNTS.flatMap((n, p) => Array.from({ length: n }, (_x, k) => `p${p}.s${k}`));
const PAGE = real as unknown as MorningPage;

describe('splitSentences', () => {
  it('ends at an end mark followed by space or the end', () => {
    expect(splitSentences('가나다. 라마바! 사아? 자차')).toEqual([
      '가나다.',
      '라마바!',
      '사아?',
      '자차',
    ]);
    expect(splitSentences('6.0 미만이 1년 유지된다. 4.5배다.')).toEqual([
      '6.0 미만이 1년 유지된다.',
      '4.5배다.',
    ]);
    expect(splitSentences('')).toEqual([]);
  });
  it('keeps a quotation whole and with its quoting ending', () => {
    expect(splitSentences('그는 "나쁜 건 없어요. 정말로요."라며 웃었다. 끝이다.')).toEqual([
      '그는 "나쁜 건 없어요. 정말로요."라며 웃었다.',
      '끝이다.',
    ]);
    expect(splitSentences('말을 남겼다. “금방 익숙해져요.” 그래서 줄였다.')).toEqual([
      '말을 남겼다.',
      '“금방 익숙해져요.”',
      '그래서 줄였다.',
    ]);
    expect(splitSentences('“아니다.” 라고 답했다. 끝.')).toEqual(['“아니다.” 라고 답했다.', '끝.']);
  });
  it('a number or an abbreviation with a full stop is no end', () => {
    expect(splitSentences('2. 다음 vs. 이전이다. 끝.')).toEqual(['2. 다음 vs. 이전이다.', '끝.']);
  });
});

describe('briefText on a published page (재테크 2026-11-25)', () => {
  it('numbers paragraphs over the whole page, core first', () => {
    const t = briefText(PAGE);
    expect(t.core.map((p) => [p.index, p.sentences.length])).toEqual([
      [0, 5],
      [1, 3],
    ]);
    expect(t.note.flatMap((s) => s.paragraphs.map((p) => p.index))).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });
  it('gives every sentence one id; the text is complete; every source is a listed video', () => {
    const all = briefSentences(PAGE);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    expect(all.map((s) => s.id)).toEqual(EXPECTED_IDS);
    const t = briefText(PAGE);
    const notes = PAGE.note.flatMap((s) => s.paragraphs.map((q) => q.text));
    const mine = t.note.flatMap((s) =>
      s.paragraphs.map((p) => p.sentences.map((x) => x.text).join(' '))
    );
    expect(mine).toEqual(notes);
    expect(
      all.filter((s) => s.id.startsWith('p0') || s.id.startsWith('p1')).map((s) => s.text)
    ).toEqual(PAGE.core.map((c) => c.text));
    const ids = new Set(PAGE.videos.map((v) => v.video_id));
    for (const s of all) {
      expect(s.sources.length).toBeGreaterThan(0);
      for (const x of s.sources) expect(ids.has(x.video_id)).toBe(true);
    }
  });
  it('a note paragraph of several sentences shares its sources (scope paragraph)', () => {
    const p = briefText(PAGE).note[0]!.paragraphs[0]!;
    expect(p.sentences.length).toBeGreaterThan(1);
    expect(new Set(p.sentences.map((s) => s.scope))).toEqual(new Set(['paragraph']));
    expect(p.sentences[0]!.sources).toEqual(PAGE.note[0]!.paragraphs[0]!.sources);
  });
  it('the parts a video is used in: the core sentence with its second, a shared source once', () => {
    const id = PAGE.core[0]!.sources[0]!.video_id;
    const parts = usedParts(PAGE, id);
    expect(parts[0]).toEqual({
      sentenceId: 'p0.s0',
      text: PAGE.core[0]!.text,
      t: PAGE.core[0]!.sources[0]!.t,
      more: [],
    });
    // a text is listed once, whatever the number of its seconds
    for (const v of PAGE.videos) {
      const texts = usedParts(PAGE, v.video_id).map((x) => x.text);
      expect(new Set(texts).size).toBe(texts.length);
    }
  });
  it('one part per note paragraph: its first sentence, the first second, the others ascending (2026-11-26)', () => {
    const at = (t: number, video_id = 'a') => ({ video_id, t });
    const page = {
      core: [{ text: '핵심.', sources: [at(140)], para: 1 }],
      note: [
        {
          heading: '소제목',
          paragraphs: [
            { text: '첫 문장. 둘째 문장.', sources: [at(100), at(740), at(520)] },
            { text: '셋째. 넷째.', sources: [at(240), at(220)] },
            // several videos: whose words the first sentence is, is not known
            { text: '남의 말. 이 영상 말.', sources: [at(9, 'b'), at(300)] },
            { text: '또 남의 말. 또 이 영상 말.', sources: [at(11, 'b'), at(80)] },
          ],
        },
      ],
    };
    expect(usedParts(page, 'a')).toEqual([
      { sentenceId: 'p0.s0', text: '핵심.', t: 140, more: [] },
      { sentenceId: 'p1.s0', text: '첫 문장.', t: 100, more: [520, 740] },
      { sentenceId: 'p2.s0', text: '셋째.', t: 240, more: [220] },
      { sentenceId: 'p3.s0', text: '소제목', t: 300, more: [80] },
    ]);
    expect(usedParts(page, 'b')).toEqual([
      { sentenceId: 'p3.s0', text: '소제목', t: 9, more: [11] },
    ]);
  });
});

describe('earlier formats', () => {
  it('core without para: one paragraph per item, split; the same source once', () => {
    const t = briefText({
      core: [
        {
          text: '하나다. 둘이다.',
          sources: [
            { video_id: 'a', t: 1 },
            { video_id: 'a', t: 1 },
            { video_id: 'a', t: 9 },
          ],
        },
        { text: '셋이다.', sources: [] },
      ],
      note: [],
    });
    expect(t.core.map((p) => p.sentences.map((s) => s.id))).toEqual([
      ['p0.s0', 'p0.s1'],
      ['p1.s0'],
    ]);
    expect(t.core[0]!.sentences[1]!.sources).toHaveLength(2);
    expect(t.core[0]!.videoCount).toBe(1);
    expect(t.core[1]!.sentences[0]!.scope).toBe('sentence');
  });
});
