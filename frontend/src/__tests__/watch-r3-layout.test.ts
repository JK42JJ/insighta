import { describe, expect, it } from 'vitest';

import { r3VideoOf } from '@/features/morning-feed/watch-r3-video';
import { parseSafeOverride } from '@/features/morning-feed/use-watch-frame';
import {
  AMBIENT_FALLBACK,
  ambientOrDefault,
  clockText,
  feedBlocks,
  immersiveBlocks,
  immersiveHeight,
  playerHeight,
  sheetTop,
  viewsLengthText,
} from '@/features/morning-feed/watch-r3-layout';
import {
  easeTimeFor,
  progressPercent,
  revealDelayMs,
} from '@/features/morning-feed/watch-r3-motion';

// README "화면 높이 기준": with browser bars 642 / no insets; added to the home screen 844 / 47 / 34
const SAFARI = { vh: 642, safeTop: 0, safeBottom: 0, playerH: 219 };
const HOME = { vh: 844, safeTop: 47, safeBottom: 34, playerH: 219 };

describe('watch 수정 4: player height', () => {
  it('is width × 9/16 and never under 200 (YouTube minimum player size)', () => {
    expect(playerHeight(390)).toBe(219);
    expect(playerHeight(430)).toBe(242);
    expect(playerHeight(356)).toBe(200);
    expect(playerHeight(320)).toBe(200);
  });
});

describe('watch 수정 4: feed card blocks (README §1)', () => {
  const ALL = { why: true, summary: true, checks: true, points: 3 };
  it('with bars: 고른 이유 · 제목 · 요약 (info 210, card 548)', () => {
    const b = feedBlocks(SAFARI, ALL);
    expect([b.showWhy, b.showSummary, b.showChecks, b.pointRows]).toEqual([true, true, false, 0]);
    expect(b.height).toBe(338 + 210);
  });

  it('without bars: everything, table of contents 2 rows (info 314)', () => {
    const b = feedBlocks(HOME, ALL);
    expect([b.showWhy, b.showSummary, b.showChecks, b.pointRows]).toEqual([true, true, true, 2]);
    expect(b.height).toBe(338 + 314);
  });

  it('no data: title + views/length only, card 404 (338 + 66)', () => {
    const b = feedBlocks(SAFARI, { why: false, summary: false, checks: false, points: 0 });
    expect(b.height).toBe(404);
  });

  it('checks live inside the 고른 이유 band: no reason, no checks (experiment: reason empty)', () => {
    const b = feedBlocks(HOME, { ...ALL, why: false });
    expect(b.showWhy).toBe(false);
    expect(b.showChecks).toBe(false);
    expect(b.showSummary).toBe(true);
  });
});

describe('watch 수정 4: immersive playback (README §2, YouTube controls kept = 1b)', () => {
  const FULL = { why: true, summary: true, next: true, afterNext: true, chapters: 3 };
  const BARE = { why: false, summary: false, next: true, afterNext: true, chapters: 0 };
  it('card height = app − safe areas − header 44 (598 / 719)', () => {
    expect(immersiveHeight(SAFARI)).toBe(598);
    expect(immersiveHeight(HOME)).toBe(719);
  });

  it('with bars, all data: 고른 이유 + next preview', () => {
    expect(immersiveBlocks(SAFARI, FULL)).toEqual({
      showWhy: true,
      nextBig: true,
      showSummary: false,
      nextSecond: false,
      chapterRows: 0,
    });
  });

  it('with bars, only age · views · channel: two next previews', () => {
    const b = immersiveBlocks(SAFARI, BARE);
    expect([b.nextBig, b.nextSecond]).toEqual([true, true]);
  });

  it('without bars, all data: 고른 이유 + preview + 요약 + 순서 1줄', () => {
    expect(immersiveBlocks(HOME, FULL)).toEqual({
      showWhy: true,
      nextBig: true,
      showSummary: true,
      nextSecond: false,
      chapterRows: 1,
    });
  });

  it('the last card keeps the one-line row; the second-to-last has no second preview', () => {
    expect(immersiveBlocks(HOME, { ...BARE, next: false, afterNext: false }).nextBig).toBe(false);
    expect(immersiveBlocks(HOME, { ...BARE, afterNext: false }).nextSecond).toBe(false);
  });

  it('the 더 보기 sheet starts under the line: safe top + 44 + 52 + player + 3 (318 at 219)', () => {
    expect(sheetTop(SAFARI)).toBe(318);
    expect(sheetTop(HOME)).toBe(365);
  });
});

describe('watch 수정 4: motion', () => {
  it('ease timing is monotone and spans 0..1', () => {
    expect(easeTimeFor(0)).toBe(0);
    expect(easeTimeFor(1)).toBe(1);
    expect(easeTimeFor(0.25)).toBeLessThan(easeTimeFor(0.75));
  });

  it('the arriving player is started once more than half of it is visible, before the move ends', () => {
    const fwd = revealDelayMs({ dir: 1, distance: 548, viewportH: 598, slotTop: 52, playerH: 219 });
    const back = revealDelayMs({
      dir: -1,
      distance: 548,
      viewportH: 598,
      slotTop: 52,
      playerH: 219,
    });
    expect(fwd).toBeGreaterThan(0);
    expect(fwd).toBeLessThan(420);
    expect(back).toBeGreaterThan(0);
    expect(back).toBeLessThan(420);
    // a short move: already more than half visible at the start
    expect(
      revealDelayMs({ dir: 1, distance: 100, viewportH: 598, slotTop: 52, playerH: 219 })
    ).toBe(0);
  });

  it('progress follows time while playing and stops when paused (no lag)', () => {
    const t = { seconds: 30, duration: 120, playing: true, at: 1000 };
    expect(progressPercent(t, 1000)).toBe(25);
    expect(progressPercent(t, 7000)).toBe(30);
    expect(progressPercent({ ...t, playing: false }, 7000)).toBe(25);
    expect(progressPercent({ ...t, duration: 0 }, 7000)).toBe(0);
  });
});

describe('watch 수정 4: texts and colours', () => {
  it('views · length line; a missing part is left out', () => {
    expect(viewsLengthText('조회수 1.2만회', 360)).toBe('조회수 1.2만회 · 6분');
    expect(viewsLengthText('', 360)).toBe('6분');
    expect(viewsLengthText('조회수 3회', null)).toBe('조회수 3회');
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

describe('watch 수정 4: live video view', () => {
  const base = {
    bg: '',
    ini: '코',
    thumb: '',
    dur: '6:00',
    ch: '코드팩토리',
    chMeta: '',
    title: 'T',
    cell: '기술/개발',
    why: '',
    videoId: 'aaaaaaaaaaa',
    durationSec: 360,
    ago: '3일 전',
    fresh: true,
  };

  it('age and views come from the card (agoLabel / formatViews)', () => {
    const v = r3VideoOf({ ...base, chMeta: '조회수 1.2만회' }, 0);
    expect([v.ageText, v.fresh, v.viewsText]).toEqual(['3일 전', true, '조회수 1.2만회']);
  });

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
