import { describe, expect, it } from 'vitest';

import {
  headlineSize,
  pastHeadlinePx,
  seenDateLabel,
  homeButtonOf,
} from '@/features/morning-feed/watch-home-model';

const S21 = '에이전트의 성패는 모델보다 평가 체계에서 갈린다';
const S29 = 'AI Agent 서비스는 모델이 아니라 기억과 검증에서 승부가 난다';

describe('daily home headline size (README §헤드라인 table)', () => {
  it('24 characters or fewer: ÷8.45 -> 32.5 / 41 / 45.5 px at 320 / 390 / 430', () => {
    expect([320, 390, 430].map((w) => headlineSize(w, S21).fontPx)).toEqual([32.5, 41, 45.5]);
    expect(headlineSize(390, S21)).toMatchObject({ trackEm: -0.04, lineHeight: 1.22 });
  });
  it('25 to 36 characters: ÷9.1 -> 30.5 / 38 / 42.5 px', () => {
    expect([320, 390, 430].map((w) => headlineSize(w, S29).fontPx)).toEqual([30.5, 38, 42.5]);
    expect(headlineSize(390, S29)).toMatchObject({ trackEm: -0.035, lineHeight: 1.24 });
  });
  it('wider than 430 is computed as 430', () => {
    expect(headlineSize(800, S29).fontPx).toBe(42.5);
  });
});

describe('seen date label', () => {
  it('writes the calendar date with its weekday', () => {
    expect(seenDateLabel('2026-11-13')).toBe('11월 13일 금요일');
    expect(seenDateLabel('2026-11-14')).toBe('11월 14일 토요일');
  });
  it('empty for anything that is not a real date', () => {
    expect(seenDateLabel('2026-02-30')).toBe('');
    expect(seenDateLabel('11/13')).toBe('');
  });
});

describe('past list headline size', () => {
  it('(width − 44) ÷ 16.5: 16.5 / 21 / 23.5 px', () => {
    expect([320, 390, 430].map(pastHeadlinePx)).toEqual([16.5, 21, 23.5]);
  });
});

describe('home button (decision 2026-11-14: always one)', () => {
  it("today's page first, then today's videos, else the shown page", () => {
    expect(homeButtonOf('2026-11-14', '2026-11-14', 5)).toEqual({
      label: '오늘의 장 읽기',
      target: 'page',
    });
    expect(homeButtonOf('2026-11-13', '2026-11-14', 5)).toEqual({
      label: '오늘의 영상 5편 보기',
      target: 'videos',
    });
    expect(homeButtonOf('2026-11-13', '2026-11-14', 0)).toEqual({
      label: '이 장 읽기',
      target: 'page',
    });
  });
});
