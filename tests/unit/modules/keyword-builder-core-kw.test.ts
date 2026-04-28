/**
 * keyword-builder — extractCoreKeyword (Issue #543, 2026-04-28)
 *
 * Sub_goal natural-language sentences from mandala-gen are condensed to a
 * 2-noun keyword phrase so concatenation with centerGoal stays short and
 * avoids YouTube broad-match cross-domain noise.
 *
 * Prod incident reference: "최적의 공부 환경 구축 및 방해 요소 제거"
 * (22 chars) + center "일일 공부 습관 만들기" produced a 33-char broad
 * query that recalled "Google One AI 프로젝트" → 109 unrelated cards.
 */

import {
  buildSearchQueries,
  extractCoreKeyword,
  type KeywordBuilderInput,
} from '@/skills/plugins/video-discover/v2/keyword-builder';

describe('extractCoreKeyword (Issue #543)', () => {
  test('drops modifiers + light verbs + conjunctions ("최적의 공부 환경 구축 및 방해 요소 제거")', () => {
    const result = extractCoreKeyword('최적의 공부 환경 구축 및 방해 요소 제거', 'ko');
    expect(result).toContain('공부');
    expect(result).toContain('환경');
    expect(result.length).toBeLessThanOrEqual(10);
  });

  test('strips multi-char postpositions + verbal endings ("포모도로 기법으로 집중력 향상시키기")', () => {
    const result = extractCoreKeyword('포모도로 기법으로 집중력 향상시키기', 'ko');
    expect(result).toContain('포모도로');
    // verbal-ending token "향상시키기" must not survive
    expect(result).not.toContain('시키기');
    // postposition "으로" must be stripped from "기법으로"
    expect(result).not.toMatch(/기법으로/);
    expect(result.length).toBeLessThanOrEqual(10);
  });

  test('drops modifier "매일" + verbal endings ("매일 공부할 시간 정하고 고정 루틴 만들기")', () => {
    const result = extractCoreKeyword('매일 공부할 시간 정하고 고정 루틴 만들기', 'ko');
    expect(result).not.toMatch(/^매일/);
    expect(result).not.toContain('만들기');
    expect(result).not.toContain('정하고');
    expect(result.length).toBeLessThanOrEqual(10);
  });

  test('caps result at 10 chars even with all-noun input', () => {
    const result = extractCoreKeyword('데이터베이스 마이크로서비스 분산처리 아키텍처', 'ko');
    expect(result.length).toBeLessThanOrEqual(10);
  });

  test('empty input returns empty string', () => {
    expect(extractCoreKeyword('', 'ko')).toBe('');
    expect(extractCoreKeyword('   ', 'ko')).toBe('');
  });

  test('all-stopword input falls back to extractCoreKeyphrase (= original after centerGoal cleanup)', () => {
    const result = extractCoreKeyword('하기', 'ko');
    expect(result).toBe('하기');
  });

  test('English language path delegates to extractCoreKeyphrase ("en")', () => {
    const result = extractCoreKeyword('Master Spanish Vocabulary', 'en');
    expect(result.toLowerCase()).toContain('master');
    expect(result.toLowerCase()).toContain('spanish');
  });

  test('non-Hangul Korean-language input still passes through gracefully', () => {
    const result = extractCoreKeyword('react hooks', 'ko');
    expect(result.toLowerCase()).toContain('react');
  });
});

describe('buildSearchQueries — Issue #543 query length regression', () => {
  const baseInput: KeywordBuilderInput = {
    centerGoal: '일일 공부 습관 만들기',
    subGoals: [
      '최적의 공부 환경 구축 및 방해 요소 제거',
      '포모도로 기법으로 집중력 향상시키기',
      '공부 목표와 학습 영역 명확히 정의하기',
      '매일 공부할 시간 정하고 고정 루틴 만들기',
      '자기 평가와 복습으로 학습 효과 극대화',
      '학습 동기 부여를 위한 보상 체계 마련',
      '집중력 향상을 위한 멘탈 관리 기법',
      '효율적인 노트 정리와 정보 구조화 방법',
    ],
    language: 'ko',
  };

  test('subgoal queries stay ≤ 20 chars after extractCoreKeyword condensation', async () => {
    const queries = await buildSearchQueries(baseInput);
    const subgoalQueries = queries.filter((q) => q.source === 'subgoal');
    expect(subgoalQueries.length).toBeGreaterThan(0);
    for (const q of subgoalQueries) {
      expect(q.query.length).toBeLessThanOrEqual(20);
    }
  });

  test('subgoal query for prod-incident sub_goal contains "공부 환경"', async () => {
    const queries = await buildSearchQueries(baseInput);
    const subgoalQueries = queries.filter((q) => q.source === 'subgoal');
    const hasEnvironment = subgoalQueries.some(
      (q) => q.query.includes('공부') && q.query.includes('환경')
    );
    expect(hasEnvironment).toBe(true);
  });

  test('subgoal query never contains the dropped tokens "구축", "제거", "만들기"', async () => {
    const queries = await buildSearchQueries(baseInput);
    const subgoalQueries = queries.filter((q) => q.source === 'subgoal');
    for (const q of subgoalQueries) {
      const subgoalPart = q.query.replace(baseInput.centerGoal, '').trim();
      expect(subgoalPart).not.toMatch(/구축\s*$/);
      expect(subgoalPart).not.toMatch(/제거\s*$/);
      expect(subgoalPart).not.toMatch(/만들기\s*$/);
    }
  });
});
