/**
 * Regression tests for the v3 mandala filter — the 9-axis relevance gate
 * that rejects off-domain candidates and routes the rest to the best-fit
 * cell. Covers the prod-observed contamination cases from 2026-04-16.
 */

import { applyMandalaFilter, MIN_SUB_RELEVANCE, type FilterCandidate } from '../mandala-filter';

function cand(videoId: string, title: string, description = ''): FilterCandidate {
  return { videoId, title, description };
}

describe('applyMandalaFilter — center gate (Gate 1)', () => {
  const input = {
    centerGoal: '일일 습관 성장',
    subGoals: [
      '아침 루틴 설계',
      '학습 시간 확보',
      '신체 건강 관리',
      '감정 및 정신 관리',
      '저녁 성찰 및 회고 습관',
      '목표 진행상황 추적 시스템',
      '방해요소 제거 및 환경 최적화',
      '루틴 지속성 유지 및 동기부여',
    ],
    language: 'ko' as const,
  };

  test('drops "하느님 자비의 기도" — no center token overlap', () => {
    const result = applyMandalaFilter([cand('v1', '찬미로 드리는 하느님 자비의 기도 5단')], input);
    for (const list of result.values()) expect(list).toHaveLength(0);
  });

  test('drops "부업추천" — no center token overlap', () => {
    const result = applyMandalaFilter(
      [cand('v2', '[부업추천] 하루 8분! 온라인부업 다해보고 알려드립니다')],
      input
    );
    for (const list of result.values()) expect(list).toHaveLength(0);
  });

  test('drops "정보처리기능사 필기" — no center token overlap', () => {
    const result = applyMandalaFilter(
      [cand('v3', '[균쌤] 정보처리기능사 필기 22강 - 운영체제 Windows 개요')],
      input
    );
    for (const list of result.values()) expect(list).toHaveLength(0);
  });
});

describe('applyMandalaFilter — center gate with substring (수능특강 case)', () => {
  const input = {
    centerGoal: '수능 대비 100일',
    subGoals: [
      '국어 영역 실전 문제풀이',
      '수학 개념 정리 및 응용',
      '영어 어휘 확장',
      '과학탐구 암기',
      '모의고사 오답노트',
      '학습 플래너 수립',
      '수면과 체력 관리',
      '수능 당일 컨디션',
    ],
    language: 'ko' as const,
  };

  test('drops "한능검" — "수능" not in title, not substring-compatible', () => {
    const result = applyMandalaFilter(
      [cand('v1', '여기서 약20점!! 2026 벼락치기 한능검 1부')],
      input
    );
    for (const list of result.values()) expect(list).toHaveLength(0);
  });

  test('admits "2027 수능특강 영어독해" — "수능" is substring of "수능특강"', () => {
    const result = applyMandalaFilter(
      [cand('v2', '2027 수능특강 영어독해 1강 1번 풀이', '영어 독해 문제풀이')],
      input
    );
    const totalKept = Array.from(result.values()).reduce((n, list) => n + list.length, 0);
    expect(totalKept).toBe(1);
  });
});

describe('applyMandalaFilter — sub_goal routing (Gate 2)', () => {
  const input = {
    centerGoal: '토플 100점 달성',
    subGoals: [
      'Reading 25점 이상',
      'Listening 25점 이상',
      'Speaking 23점 이상',
      'Writing 25점 이상',
      'Grammar 복습',
      '학습 루틴 관리',
      '오답노트 작성',
      '시험일 컨디션 관리',
    ],
    language: 'ko' as const,
  };

  test('TEPS material dropped — passes center ("토플"? no) but no sub_goal overlap', () => {
    // This video has no 토플 token — should fail Gate 1 and be dropped.
    const result = applyMandalaFilter(
      [cand('v1', '텝스 단어 자면서 외우는 기출텝스 보카', '영어 공부')],
      input
    );
    for (const list of result.values()) expect(list).toHaveLength(0);
  });

  test('real TOEFL Reading video routed to Reading cell', () => {
    const result = applyMandalaFilter(
      [cand('v2', '토플 Reading 만점 전략', '토플 Reading 지문 빠르게 읽는 법 25점 이상 목표')],
      input
    );
    const reading = result.get(0) ?? [];
    expect(reading).toHaveLength(1);
    expect(reading[0]!.score).toBeGreaterThan(0);
  });
});

describe('applyMandalaFilter — score ordering', () => {
  test('per-cell results sorted by score desc', () => {
    const input = {
      centerGoal: '요리 입문자 한식 마스터',
      subGoals: [
        '밥 짓기 기초',
        '국 끓이기',
        '반찬 만들기',
        '김치 담그기',
        '찌개 끓이기',
        '양념 이해',
        '조리도구 활용',
        '한식 상차림',
      ],
      language: 'ko' as const,
    };
    const candidates: FilterCandidate[] = [
      cand('high', '한식 반찬 만들기 완벽 가이드', '반찬 만들기 반찬 반찬'),
      cand('med', '한식 요리 반찬 간단 레시피', '요리 기본'),
      cand('low', '한식 반찬 조금', ''),
    ];
    const result = applyMandalaFilter(candidates, input);
    const list = result.get(2) ?? []; // 반찬 만들기 is cell 2
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1]!.score).toBeGreaterThanOrEqual(list[i]!.score);
    }
  });
});

describe('applyMandalaFilter — 1-char Korean token preservation (CP389 bug #414)', () => {
  // Regression for the "AI 시대의 뇌 활용법" case where the center token
  // `뇌` (1 char) was silently dropped by the old `length >= 2` tokenizer.
  // Fix: Hangul single-syllable tokens are now retained. English 1-char
  // letters remain filtered (so stray `a` in titles doesn't leak through).
  const input = {
    centerGoal: 'AI 시대의 뇌 활용법',
    subGoals: [
      'AI와 인간 뇌의 역할 분담',
      '창의 비판 사고력 강화',
      '집중력 관리 기술',
      'AI 도구 뇌 시너지',
      '장기 기억 학습',
      '감정 지능 인간관계',
      '뇌 건강 신체 습관',
      '메타인지 자기 학습',
    ],
    language: 'ko' as const,
  };

  test('admits "박문호 교수의 뇌 과학 강연" via the 뇌 token (was dropped pre-fix)', () => {
    const result = applyMandalaFilter(
      [cand('v1', '박문호 교수의 뇌 과학 강연', '뇌 과학 강의 심화')],
      input
    );
    const totalKept = Array.from(result.values()).reduce((n, list) => n + list.length, 0);
    expect(totalKept).toBe(1);
  });

  test('known limitation: "Cramify AI 벼락치기" still passes on single "ai" hit', () => {
    // This PR does not tighten the non-focus branch of the center gate.
    // "Cramify AI 벼락치기" passes Gate 1 because "ai" overlaps with the
    // centerGoal tokens (≥ one hit rule, unchanged), and it passes Gate 2
    // because the jaccard threshold (MIN_SUB_RELEVANCE = 0.05) is very
    // lenient — a single shared "ai" token with the "AI 도구 뇌 시너지"
    // sub_goal clears it. A future scoring pass will raise the bar; for
    // now this test documents the accepted residual noise so regressing
    // in the opposite direction (accidentally dropping it) is visible.
    const result = applyMandalaFilter(
      [cand('v1', 'Cramify AI 벼락치기 공부법', '벼락치기 강의 요약')],
      input
    );
    const totalKept = Array.from(result.values()).reduce((n, list) => n + list.length, 0);
    expect(totalKept).toBe(1);
  });
});

describe('applyMandalaFilter — focusTags OR gate (CP389 bug #414)', () => {
  // Regression for the wizard-supplied focus_tags ("박문호", "이인아", "뇌과학")
  // being ignored at the filter layer. With the fix, a title that contains
  // any focus tag token passes the center gate even if the centerGoal
  // tokens are absent.
  const input = {
    centerGoal: 'AI 시대의 뇌 활용법',
    subGoals: [
      'AI와 인간 뇌의 역할 분담',
      '창의 비판 사고력 강화',
      '집중력 관리 기술',
      'AI 도구 뇌 시너지',
      '장기 기억 학습',
      '감정 지능 인간관계',
      '뇌 건강 신체 습관',
      '메타인지 자기 학습',
    ],
    language: 'ko' as const,
    focusTags: ['뇌과학', '박문호', '이인아'],
  };

  test('admits "이인아 교수 인간관계 강연" via focus-tag match', () => {
    // No centerGoal token (ai/시대의/뇌/활용법) is in the title, so the
    // pre-fix filter would drop this. Post-fix: focus-tag "이인아" matches
    // "이인아" in the title → passes Gate 1.
    const result = applyMandalaFilter(
      [cand('v1', '이인아 교수 인간관계 강연', '이인아 교수의 뇌과학 기반 인간관계 강의 심화편')],
      input
    );
    const totalKept = Array.from(result.values()).reduce((n, list) => n + list.length, 0);
    expect(totalKept).toBe(1);
  });

  test('admits "박문호의 자연과학 세상" — focus-tag hit, no centerGoal overlap', () => {
    const result = applyMandalaFilter(
      [cand('v2', '박문호의 자연과학 세상 - 뇌과학 입문', '박문호 교수 장기 기억 학습 특강')],
      input
    );
    const totalKept = Array.from(result.values()).reduce((n, list) => n + list.length, 0);
    expect(totalKept).toBe(1);
  });

  test('without focusTags, "박문호" title is dropped (control for the OR gate)', () => {
    const noFocus = { ...input, focusTags: undefined };
    const result = applyMandalaFilter(
      [cand('v1', '박문호의 자연과학 세상', '박문호 교수 특강')],
      noFocus
    );
    const totalKept = Array.from(result.values()).reduce((n, list) => n + list.length, 0);
    expect(totalKept).toBe(0);
  });

  test('empty focusTags array is treated the same as undefined', () => {
    const emptyFocus = { ...input, focusTags: [] };
    const result = applyMandalaFilter(
      [cand('v1', '박문호의 자연과학 세상', '박문호 교수 특강')],
      emptyFocus
    );
    const totalKept = Array.from(result.values()).reduce((n, list) => n + list.length, 0);
    expect(totalKept).toBe(0);
  });
});

describe('applyMandalaFilter — empty input and edge cases', () => {
  test('empty candidates returns empty per-cell lists', () => {
    const result = applyMandalaFilter([], {
      centerGoal: '무언가',
      subGoals: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      language: 'ko',
    });
    expect(result.size).toBe(8);
    for (const list of result.values()) expect(list).toHaveLength(0);
  });

  test('empty centerGoal keeps center gate open (sub_goal alone decides)', () => {
    const result = applyMandalaFilter([cand('v1', '아침 루틴 정리', '아침 루틴 매일')], {
      centerGoal: '',
      subGoals: ['아침 루틴 설계', 'x', 'x', 'x', 'x', 'x', 'x', 'x'],
      language: 'ko',
    });
    const list = result.get(0) ?? [];
    expect(list).toHaveLength(1);
  });

  test('MIN_SUB_RELEVANCE threshold is public and 0.05', () => {
    expect(MIN_SUB_RELEVANCE).toBe(0.05);
  });
});
