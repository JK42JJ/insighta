import { describe, expect, it } from 'vitest';

import { r3VideoOf } from '@/features/morning-feed/watch-r3-video';
import { parseSafeOverride } from '@/features/morning-feed/use-watch-frame';
import {
  AMBIENT_FALLBACK,
  ambientOrDefault,
  channelMetaText,
  clockText,
  feedBlocks,
  immersiveBlocks,
  immersiveHeight,
  playerHeight,
  uploadDayText,
} from '@/features/morning-feed/watch-r3-layout';

// README "화면 높이 기준": with browser bars 642 / no insets; added to the home screen 844 / 47 / 34
const SAFARI = { vh: 642, safeTop: 0, safeBottom: 0, playerH: 219 };
const HOME = { vh: 844, safeTop: 47, safeBottom: 34, playerH: 219 };
const ALL = { why: true, summary: true, checks: true, points: true };

describe('watch 수정 3: player height', () => {
  it('is width × 9/16 and never under 200 (YouTube minimum player size)', () => {
    expect(playerHeight(390)).toBe(219);
    expect(playerHeight(430)).toBe(242);
    expect(playerHeight(356)).toBe(200);
    expect(playerHeight(320)).toBe(200);
  });
});

describe('watch 수정 3: feed card blocks (README 정보 블록)', () => {
  it('with bars: 고른 이유 and 한 줄 요약 fit (info 206, card 544)', () => {
    const b = feedBlocks(SAFARI, ALL);
    expect([b.showWhy, b.showSummary, b.showChecks, b.showPoints]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(b.height).toBe(338 + 206);
  });

  it('without bars: all four fit (info 310)', () => {
    const b = feedBlocks(HOME, ALL);
    expect([b.showWhy, b.showSummary, b.showChecks, b.showPoints]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(b.height).toBe(338 + 310);
  });

  it('no data: the blocks are hidden and the card is 400 (338 + 62)', () => {
    const b = feedBlocks(SAFARI, { why: false, summary: false, checks: false, points: false });
    expect(b.height).toBe(400);
  });

  it('checks live inside the 고른 이유 band: no reason, no checks (experiment: reason empty)', () => {
    const b = feedBlocks(HOME, { ...ALL, why: false });
    expect(b.showWhy).toBe(false);
    expect(b.showChecks).toBe(false);
    expect(b.showSummary).toBe(true);
  });
});

describe('watch 수정 3: immersive playback (README §4, decision 4c)', () => {
  it('card height = app − safe areas − header (594 / 715)', () => {
    expect(immersiveHeight(SAFARI)).toBe(594);
    expect(immersiveHeight(HOME)).toBe(715);
  });

  it('table of contents: 2 rows with bars, up to 4 without', () => {
    const has = { chapters: 6, why: true, summary: true, next: true };
    expect(immersiveBlocks(SAFARI, has).chapterRows).toBe(2);
    expect(immersiveBlocks(HOME, has).chapterRows).toBe(4);
    expect(immersiveBlocks(HOME, { ...has, chapters: 3 }).chapterRows).toBe(3);
  });

  it('no table of contents, with bars: 고른 이유 + large next preview', () => {
    const b = immersiveBlocks(SAFARI, { chapters: 0, why: true, summary: true, next: true });
    expect([b.showWhy, b.nextBig, b.showSummary]).toEqual([true, true, false]);
  });

  it('no table of contents, without bars: 고른 이유 + preview + 한 줄 요약', () => {
    const b = immersiveBlocks(HOME, { chapters: 0, why: true, summary: true, next: true });
    expect([b.showWhy, b.nextBig, b.showSummary]).toEqual([true, true, true]);
  });

  it('no info at all: only the preview; the last card keeps the one-line row', () => {
    expect(
      immersiveBlocks(HOME, { chapters: 0, why: false, summary: false, next: true }).nextBig
    ).toBe(true);
    expect(
      immersiveBlocks(HOME, { chapters: 0, why: false, summary: false, next: false }).nextBig
    ).toBe(false);
  });
});

describe('watch 수정 3: texts and colours', () => {
  it('channel row: minutes and the KST upload day; missing parts left out', () => {
    expect(channelMetaText(360, '2026-11-09T03:00:00Z')).toBe('6분 · 11월 9일');
    // 23:30 UTC on the 8th is the 9th in KST
    expect(uploadDayText('2026-11-08T23:30:00Z')).toBe('11월 9일');
    expect(channelMetaText(360, undefined)).toBe('6분');
    expect(channelMetaText(null, 'nope')).toBe('');
  });

  it('playback clock', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(42.9)).toBe('0:42');
    expect(clockText(725)).toBe('12:05');
    expect(clockText(Number.NaN)).toBe('0:00');
  });

  it('ambient: the server colour when it is #rrggbb, Ink Navy otherwise', () => {
    expect(ambientOrDefault('#201e32')).toBe('#201e32');
    expect(ambientOrDefault(undefined)).toBe(AMBIENT_FALLBACK);
    expect(ambientOrDefault('red; background:url(x)')).toBe(AMBIENT_FALLBACK);
  });

  it('safe-area test hook parses only two small numbers', () => {
    expect(parseSafeOverride('47,34')).toEqual({ safeTop: 47, safeBottom: 34 });
    expect(parseSafeOverride('47')).toBeNull();
    expect(parseSafeOverride(null)).toBeNull();
  });
});

describe('watch 수정 3: live video view', () => {
  const base = {
    bg: '',
    ini: '코',
    thumb: '',
    dur: '6:00',
    ago: '',
    ch: '코드팩토리',
    chMeta: '',
    title: 'T',
    cell: '기술/개발',
    why: '',
    videoId: 'aaaaaaaaaaa',
    durationSec: 360,
  };

  it('blocks come only from data; an empty reason stays empty (hidden)', () => {
    const v = r3VideoOf(base, 0);
    expect(v.why).toBe('');
    expect(v.summary).toBe('');
    expect(v.checks).toEqual([]);
    expect(v.chapters).toEqual([]);
  });

  it('only confirmed checks are drawn, without the mark (the screen adds ✓)', () => {
    const v = r3VideoOf(
      {
        ...base,
        reasonLines: ['첫째', '둘째'],
        checks: [{ text: '✓ 한국어 음성' }, { text: '음성 언어 영어' }],
      },
      1
    );
    expect(v.why).toBe('첫째 둘째');
    expect(v.checks).toEqual(['한국어 음성']);
    expect(v.altIcon).toBe(true);
  });
});
