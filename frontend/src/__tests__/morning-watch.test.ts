import { describe, expect, it } from 'vitest';

import {
  counterText,
  goalCells,
  metaLine,
  parseWatchDaily,
  pickTodaysVideos,
  segmentStates,
} from '@/features/morning-feed/watch-list';

const CELLS = [
  { label: '기술/개발', short: '기술·개발', dom: 0 },
  { label: '비즈니스/커리어', short: '비즈니스', dom: 0 },
  { label: '오늘 전체', short: '오늘 전체', dom: -1 },
  { label: '건강/피트니스', short: '건강', dom: 0 },
];

const card = (videoId: string | undefined, cell: string) => ({ videoId, cell });

describe('watch screen helpers', () => {
  it('goals are the cells without the centre cell, in feed order', () => {
    expect(goalCells(CELLS).map((c) => c.label)).toEqual([
      '기술/개발',
      '비즈니스/커리어',
      '건강/피트니스',
    ]);
  });

  it("today's videos: first n of the cell in feed order, skipping judged ones and cards without a video", () => {
    const cards = [
      card('a0000000000', '기술/개발'),
      card('b0000000000', '비즈니스/커리어'),
      card('c0000000000', '기술/개발'),
      card(undefined, '기술/개발'),
      card('d0000000000', '기술/개발'),
      card('e0000000000', '기술/개발'),
    ];
    expect(pickTodaysVideos(cards, '기술/개발', 2).map((c) => c.videoId)).toEqual([
      'a0000000000',
      'c0000000000',
    ]);
    expect(
      pickTodaysVideos(cards, '기술/개발', 2, new Set(['a0000000000'])).map((c) => c.videoId)
    ).toEqual(['c0000000000', 'd0000000000']);
    // fewer cards than n: no padding
    expect(pickTodaysVideos(cards, '비즈니스/커리어', 5)).toHaveLength(1);
    expect(pickTodaysVideos(cards, '건강/피트니스', 5)).toEqual([]);
    expect(pickTodaysVideos(cards, '기술/개발', 0)).toEqual([]);
  });

  it('the per-day count is used only when the server sent a positive whole number', () => {
    expect(parseWatchDaily(5)).toBe(5);
    expect(parseWatchDaily(undefined)).toBeNull();
    expect(parseWatchDaily(0)).toBeNull();
    expect(parseWatchDaily(2.5)).toBeNull();
    expect(parseWatchDaily('5')).toBeNull();
  });

  it('segments: passed, current, rest; counter counts from 1', () => {
    expect(segmentStates(5, 0)).toEqual(['current', 'rest', 'rest', 'rest', 'rest']);
    expect(segmentStates(5, 2)).toEqual(['done', 'done', 'current', 'rest', 'rest']);
    expect(segmentStates(0, 0)).toEqual([]);
    expect(counterText(0, 5)).toBe('1 / 5');
    expect(counterText(1, 5)).toBe('2 / 5');
  });

  it('meta line leaves out a missing part instead of filling it in', () => {
    expect(metaLine('채널', 660, '기술·개발')).toBe('채널 · 11분 · 기술·개발');
    expect(metaLine('', 660, '기술·개발')).toBe('11분 · 기술·개발');
    expect(metaLine('채널', 0, '기술·개발')).toBe('채널 · 기술·개발');
    expect(metaLine(undefined, null, '')).toBe('');
  });
});
