import { describe, expect, it } from 'vitest';

import {
  counterText,
  goalCells,
  goalChipState,
  goalRowText,
  metaLine,
  parseWatchDaily,
  parseWatchTodayMap,
  segmentStates,
  unansweredInBatch,
  withBatch,
  withOneJudged,
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

  it('batch videos still to answer keep their batch index (shown_position), in batch order', () => {
    const items = [
      card('a0000000000', '기술/개발'),
      card(undefined, '기술/개발'),
      card('c0000000000', '기술/개발'),
      card('d0000000000', '기술/개발'),
    ];
    expect(
      unansweredInBatch(items, new Set(['a0000000000'])).map((r) => [r.video.videoId, r.position])
    ).toEqual([
      ['c0000000000', 2],
      ['d0000000000', 3],
    ]);
    expect(unansweredInBatch(items, new Set())[0]).toEqual({ video: items[0], position: 0 });
    expect(unansweredInBatch([], new Set())).toEqual([]);
  });

  it('the per-day count is used only when the server sent a positive whole number', () => {
    expect(parseWatchDaily(5)).toBe(5);
    expect(parseWatchDaily(undefined)).toBeNull();
    expect(parseWatchDaily(0)).toBeNull();
    expect(parseWatchDaily(2.5)).toBeNull();
    expect(parseWatchDaily('5')).toBeNull();
  });

  it('the per-goal map from GET /watch/today is used only when every field is well formed', () => {
    const ok = {
      '기술/개발': { issued: 5, judged: 2, available: 0 },
      '학습/교육': { issued: null, judged: 0, available: 3 },
    };
    expect(parseWatchTodayMap(ok)).toEqual(ok);
    expect(parseWatchTodayMap({})).toEqual({});
    expect(parseWatchTodayMap(undefined)).toBeNull();
    expect(parseWatchTodayMap([1])).toBeNull();
    expect(parseWatchTodayMap({ x: { issued: -1, judged: 0, available: 0 } })).toBeNull();
    expect(parseWatchTodayMap({ x: { issued: 1, judged: 0.5, available: 0 } })).toBeNull();
    expect(parseWatchTodayMap({ x: { issued: 1, judged: 0 } })).toBeNull();
    expect(parseWatchTodayMap({ x: 3 })).toBeNull();
  });

  it("chip state comes from today's batch only: none / done / open with the CTA count", () => {
    // no batch, no candidates: disabled 오늘 영상 없음
    expect(goalChipState({ issued: null, judged: 0, available: 0 })).toEqual({
      kind: 'none',
      count: 0,
    });
    // no batch yet: a new batch would hand out `available`
    expect(goalChipState({ issued: null, judged: 0, available: 4 })).toEqual({
      kind: 'open',
      count: 4,
    });
    // a batch partly answered: the rest
    expect(goalChipState({ issued: 5, judged: 2, available: 0 })).toEqual({
      kind: 'open',
      count: 3,
    });
    // a batch answered in full: 오늘은 끝
    expect(goalChipState({ issued: 3, judged: 3, available: 0 })).toEqual({
      kind: 'done',
      count: 0,
    });
    expect(goalChipState(undefined)).toEqual({ kind: 'none', count: 0 });
  });

  it('the local map moves with a batch and with each answer, so the chip turns done', () => {
    const t0 = { '기술/개발': { issued: null, judged: 0, available: 2 } };
    const t1 = withBatch(t0, '기술/개발', 2, 0);
    expect(t1['기술/개발']).toEqual({ issued: 2, judged: 0, available: 0 });
    const t2 = withOneJudged(withOneJudged(t1, '기술/개발'), '기술/개발');
    expect(goalChipState(t2['기술/개발']).kind).toBe('done');
    // an unknown goal is left alone
    expect(withOneJudged(t1, '학습/교육')).toBe(t1);
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
