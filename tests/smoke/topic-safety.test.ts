/**
 * Topic safety gate (2026-07-27).
 *
 * Anchored on the row that shipped to a user: `ai 란제리 룩북`, stored at
 * norm_score 1.00 and proposed as a study subject chipped "AI·기술".
 */

import { checkTopicSafety, isTopicSafe } from '../../src/modules/moderation/topic-safety';

describe('checkTopicSafety — the keywords that actually reached prod', () => {
  const measured = [
    'ai 란제리 룩북',
    'ai모델 룩북',
    'ai 모델 룩북',
    'ai 란제리 룩북 실사',
    'ai 란제리 룩북 back',
    'ai 룩북',
  ];

  it.each(measured)('blocks %s', (kw) => {
    const v = checkTopicSafety(kw);
    expect(v.safe).toBe(false);
    if (!v.safe) expect(v.category).toBe('explicit');
  });
});

describe('checkTopicSafety — categories', () => {
  it.each([
    ['카지노 슬롯머신 공략', 'gambling'],
    ['주식 리딩방 수익인증', 'solicitation'],
    ['마약 구하는 법', 'illegal'],
    ['비키니 하울', 'explicit'],
    ['casino baccarat tips', 'gambling'],
  ])('blocks %s as %s', (kw, category) => {
    const v = checkTopicSafety(kw);
    expect(v.safe).toBe(false);
    if (!v.safe) expect(v.category).toBe(category);
  });
});

describe('checkTopicSafety — normalisation', () => {
  it('is case-insensitive and ignores spacing', () => {
    expect(isTopicSafe('LOOKBOOK')).toBe(false);
    expect(isTopicSafe('란 제 리')).toBe(false);
    expect(isTopicSafe('Lingerie Haul')).toBe(false);
  });
});

describe('checkTopicSafety — educational carve-out', () => {
  it('allows material ABOUT a problem', () => {
    // measured in trend_signals and caught by a naive scan — it is exactly the
    // kind of content this product exists to serve
    expect(isTopicSafe('청소년 도박 예방 교육')).toBe(true);
    expect(isTopicSafe('도박 중독 상담')).toBe(true);
    expect(isTopicSafe('마약 예방 캠페인')).toBe(true);
  });

  it('does NOT let educational framing rescue explicit content', () => {
    expect(isTopicSafe('란제리 룩북 교육')).toBe(false);
    expect(isTopicSafe('비키니 예방')).toBe(false);
  });
});

describe('checkTopicSafety — no false positives on real learning topics', () => {
  // sampled from the live top-20 of trend_signals
  const legit = [
    'options trading for beginners',
    '개인 철학과',
    '안세영',
    '근력운동 홈트',
    'furniture design',
    '지방선거',
    'ai 에이전트',
    '강아지훈련',
    'woodworking',
    '자바스크립트',
    '파이썬',
    '수능 100일 2등급 올리기',
    '영어회화',
    '토익스피킹',
    'Claude 코드',
    '호흡법',
  ];

  it.each(legit)('allows %s', (kw) => {
    expect(isTopicSafe(kw)).toBe(true);
  });
});

describe('checkTopicSafety — edge cases', () => {
  it('treats empty input as safe (nothing to block)', () => {
    expect(isTopicSafe('')).toBe(true);
    expect(isTopicSafe('   ')).toBe(true);
  });
});
