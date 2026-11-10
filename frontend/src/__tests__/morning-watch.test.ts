import { describe, expect, it } from 'vitest';

import {
  addJudgedToday,
  counterText,
  goalCells,
  goalRowText,
  isGoalDoneToday,
  metaLine,
  parseWatchDaily,
  parseWatchToday,
  pickTodaysVideos,
  remainingToday,
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

  it("today's judged count is used only when the server sent whole numbers >= 0 per cell", () => {
    expect(parseWatchToday({ '기술/개발': 2, '학습/교육': 0 })).toEqual({
      '기술/개발': 2,
      '학습/교육': 0,
    });
    expect(parseWatchToday({})).toEqual({});
    expect(parseWatchToday(undefined)).toBeNull();
    expect(parseWatchToday(null)).toBeNull();
    expect(parseWatchToday([1, 2])).toBeNull();
    expect(parseWatchToday({ '기술/개발': -1 })).toBeNull();
    expect(parseWatchToday({ '기술/개발': 1.5 })).toBeNull();
    expect(parseWatchToday({ '기술/개발': '2' })).toBeNull();
  });

  it('remaining per goal: daily minus judged today, never below 0; unknown count = daily', () => {
    const today = { '기술/개발': 2, '학습/교육': 5, '건강/피트니스': 7 };
    expect(remainingToday(5, today, '기술/개발')).toBe(3);
    expect(remainingToday(5, today, '학습/교육')).toBe(0);
    expect(remainingToday(5, today, '건강/피트니스')).toBe(0);
    // a cell missing from the count has judged nothing today
    expect(remainingToday(5, today, '창작/예술')).toBe(5);
    // older server without the count: as before
    expect(remainingToday(5, null, '학습/교육')).toBe(5);
    // the list is the first `remaining` unjudged cards of the goal
    const cards = ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => card(x.repeat(11), '기술/개발'));
    expect(
      pickTodaysVideos(cards, '기술/개발', remainingToday(5, today, '기술/개발')).map(
        (c) => c.videoId
      )
    ).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
    expect(pickTodaysVideos(cards, '학습/교육', remainingToday(5, today, '학습/교육'))).toEqual([]);
  });

  it("'오늘은 끝' only when the count is known and used up; one answer moves the local count", () => {
    expect(isGoalDoneToday(5, { '기술/개발': 5 }, '기술/개발')).toBe(true);
    expect(isGoalDoneToday(5, { '기술/개발': 4 }, '기술/개발')).toBe(false);
    expect(isGoalDoneToday(5, {}, '기술/개발')).toBe(false);
    expect(isGoalDoneToday(5, null, '기술/개발')).toBe(false);
    const after = addJudgedToday({ '기술/개발': 4 }, '기술/개발');
    expect(after).toEqual({ '기술/개발': 5 });
    expect(isGoalDoneToday(5, after, '기술/개발')).toBe(true);
    expect(addJudgedToday({}, '학습/교육')).toEqual({ '학습/교육': 1 });
    expect(addJudgedToday(null, '학습/교육')).toBeNull();
  });

  it("goal row text: '오늘은 끝', '오늘 n편' or '오늘 영상 없음'", () => {
    expect(goalRowText(0, true)).toBe('오늘은 끝');
    expect(goalRowText(3, true)).toBe('오늘은 끝');
    expect(goalRowText(3, false)).toBe('오늘 3편');
    expect(goalRowText(0, false)).toBe('오늘 영상 없음');
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
