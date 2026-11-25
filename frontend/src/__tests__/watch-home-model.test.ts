import { describe, expect, it } from 'vitest';

import {
  headlineSize,
  pastHeadlinePx,
  seenDateLabel,
  briefDateLabel,
  HOME_BUTTON_LABEL,
  homeTint,
  nextWithPage,
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
  it('always 브리프 읽기 (decision 2026-11-14 user test)', () => {
    expect(HOME_BUTTON_LABEL).toBe('브리프 읽기');
  });
  it('brief date: the date only, today reads 오늘 · (decision 2026-11-14 user test)', () => {
    expect(briefDateLabel('2026-11-16', '2026-11-16')).toBe('오늘 · 11월 16일');
    expect(briefDateLabel('2026-11-13', '2026-11-16')).toBe('11월 13일');
    expect(briefDateLabel('2026-02-30', '2026-11-16')).toBe('');
  });
});

describe('home headline roll and ground colour (2026-11-25)', () => {
  const cells = ['기술/개발', '비즈니스/커리어', '재테크/투자'];
  it('goes to the next domain with a brief, round again; null when there is no other', () => {
    const pages = { '기술/개발': 1, '재테크/투자': 1 };
    expect(nextWithPage(cells, pages, '기술/개발')).toBe('재테크/투자');
    expect(nextWithPage(cells, pages, '재테크/투자')).toBe('기술/개발');
    expect(nextWithPage(cells, pages, '기술/개발', 2)).toBeNull();
    expect(nextWithPage(cells, { '기술/개발': 1 }, '기술/개발')).toBeNull();
    expect(nextWithPage(cells, {}, '기술/개발')).toBeNull();
  });
  it('every shown domain has its own colour', () => {
    const all = [
      '기술/개발',
      '비즈니스/커리어',
      '재테크/투자',
      '학습/교육',
      '건강/피트니스',
      '인간관계/커뮤니티',
      '창작/예술',
      '라이프스타일/여행',
    ].map(homeTint);
    expect(all.every(Boolean)).toBe(true);
    expect(new Set(all).size).toBe(8);
    expect(homeTint('오늘 전체')).toBeUndefined();
  });
});
