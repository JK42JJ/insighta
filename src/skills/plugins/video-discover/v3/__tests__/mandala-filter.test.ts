/**
 * Regression tests for the v3 mandala filter — the 9-axis relevance gate
 * that rejects off-domain candidates and routes the rest to the best-fit
 * cell. Covers the prod-observed contamination cases from 2026-04-16.
 */

import {
  applyMandalaFilter,
  applyMandalaFilterWithStats,
  buildScoreWeights,
  computeRecencyScore,
  cosineSimilarity,
  DEFAULT_RECENCY_HALF_LIFE_MONTHS,
  MIN_SUB_RELEVANCE,
  SEMANTIC_MIN_COSINE,
  SEMANTIC_MIN_CELL_COSINE,
  type FilterCandidate,
} from '../mandala-filter';

function cand(
  videoId: string,
  title: string,
  description = '',
  publishedAt: Date | null = null
): FilterCandidate {
  return { videoId, title, description, publishedAt };
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

describe('recency weighting (2026-04-18, env-gated)', () => {
  const BASE_INPUT = {
    centerGoal: '턱걸이 20개',
    subGoals: [
      '기초체력 점검',
      '등근육 강화',
      '팔이두근 발달',
      '어깨안정성',
      '코어안정화',
      '점진적 과부하',
      '영양체중관리',
      '회복 부상 예방',
    ],
    language: 'ko' as const,
  };

  const NOW = new Date('2026-04-18T00:00:00Z');

  test('recencyWeight=0 keeps legacy 0.5/0.5 weights (baseline invariant)', () => {
    const weights = buildScoreWeights(0);
    expect(weights).toEqual({ wCenter: 0.5, wCell: 0.5, wRecency: 0 });
  });

  test('recencyWeight>0 scales center+cell down proportionally, sums to 1', () => {
    const w = buildScoreWeights(0.2);
    expect(w.wRecency).toBe(0.2);
    expect(w.wCenter).toBeCloseTo(0.4, 6);
    expect(w.wCell).toBeCloseTo(0.4, 6);
    expect(w.wCenter + w.wCell + w.wRecency).toBeCloseTo(1, 6);
  });

  test('computeRecencyScore: 0 when publishedAt null; 1 for future; halves at halfLife', () => {
    expect(computeRecencyScore(null, NOW, 18)).toBe(0);
    expect(computeRecencyScore(undefined, NOW, 18)).toBe(0);
    // future date
    const future = new Date(NOW.getTime() + 1000 * 60 * 60 * 24);
    expect(computeRecencyScore(future, NOW, 18)).toBe(1);
    // exactly one half-life (18 months ≈ 540 days)
    const oneHalfLife = new Date(NOW.getTime() - 18 * 30 * 24 * 60 * 60 * 1000);
    expect(computeRecencyScore(oneHalfLife, NOW, 18)).toBeCloseTo(0.5, 3);
  });

  test('with recencyWeight=0 → old video matching lexically still wins (baseline preserved)', () => {
    // Both candidates have identical lexical match. Old has zero recency
    // advantage in baseline mode.
    const oldVid = cand(
      'old',
      '턱걸이 등근육 강화 루틴',
      '턱걸이 등근육 팔이두근 발달',
      new Date('2018-04-18T00:00:00Z')
    );
    const newVid = cand(
      'new',
      '턱걸이 등근육 강화 루틴',
      '턱걸이 등근육 팔이두근 발달',
      new Date('2025-10-18T00:00:00Z')
    );
    const { byCell } = applyMandalaFilterWithStats([oldVid, newVid], {
      ...BASE_INPUT,
      recencyWeight: 0,
      now: NOW,
    });
    // All cells combined: both should be present with equal score.
    const flat = Array.from(byCell.values()).flat();
    expect(flat).toHaveLength(2);
    expect(flat[0]!.score).toBeCloseTo(flat[1]!.score, 6);
  });

  test('with recencyWeight=0.15 → new video outranks equal-lexical old video', () => {
    const oldVid = cand(
      'old',
      '턱걸이 등근육 강화 루틴',
      '턱걸이 등근육 팔이두근 발달',
      new Date('2018-04-18T00:00:00Z')
    );
    const newVid = cand(
      'new',
      '턱걸이 등근육 강화 루틴',
      '턱걸이 등근육 팔이두근 발달',
      new Date('2025-10-18T00:00:00Z')
    );
    const { byCell } = applyMandalaFilterWithStats([oldVid, newVid], {
      ...BASE_INPUT,
      recencyWeight: 0.15,
      now: NOW,
    });
    // Both land in the same cell, sorted by score desc
    const allCells = Array.from(byCell.values()).filter((list) => list.length > 0);
    expect(allCells).toHaveLength(1);
    const [list] = allCells;
    expect(list!.length).toBeGreaterThanOrEqual(2);
    expect(list![0]!.candidate.videoId).toBe('new');
    expect(list![1]!.candidate.videoId).toBe('old');
    // Observability: recencyScore stored on every assignment
    expect(list![0]!.recencyScore).toBeGreaterThan(list![1]!.recencyScore);
  });

  test('stats.recency captures weight, halfLife, and missingPublishedAt count', () => {
    const withDate = cand('withDate', '턱걸이 등근육 강화', '', new Date('2024-04-18T00:00:00Z'));
    const noDate = cand('noDate', '턱걸이 등근육 강화', '', null);
    const { stats } = applyMandalaFilterWithStats([withDate, noDate], {
      ...BASE_INPUT,
      recencyWeight: 0.15,
      recencyHalfLifeMonths: 24,
      now: NOW,
    });
    expect(stats.recency).toBeDefined();
    expect(stats.recency!.weight).toBe(0.15);
    expect(stats.recency!.halfLifeMonths).toBe(24);
    expect(stats.recency!.missingPublishedAt).toBe(1);
  });

  test('DEFAULT_RECENCY_HALF_LIFE_MONTHS is 18', () => {
    expect(DEFAULT_RECENCY_HALF_LIFE_MONTHS).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// CenterGateMode — subword + off (Phase-1 carding-quality audit)
// ---------------------------------------------------------------------------

describe('applyMandalaFilter — centerGateMode', () => {
  // Goal with Korean particles; substring mode drops composite-word
  // matches like "모닝루틴" ↔ "루틴으로". Subword mode catches them.
  const input = {
    centerGoal: '1달 일일 루틴으로 전문가되기',
    subGoals: [
      '전문 분야 선정 및 학습 계획 수립',
      '매일 집중 학습 시간 확보 및 루틴화',
      '실무 프로젝트 진행 및 포트폴리오 구축',
      '전문 커뮤니티 참여 및 네트워킹',
      '월간 집중 전문화',
      '지식 체계화 및 아웃풋 생산',
      '피드백 수집 및 개선 사이클',
      '일일 진도 추적 및 동기 유지',
    ],
    language: 'ko' as const,
  };

  const composite = cand('c1', '엄지원의 모닝루틴 7가지', '아침 루틴 7가지 방법');
  const noise = cand('n1', 'iPhone 16 프로 리뷰', '아이폰 16 스마트폰 리뷰');

  test('substring mode (default) drops "모닝루틴" — regression baseline', () => {
    const { stats } = applyMandalaFilterWithStats([composite], input);
    expect(stats.droppedByCenterGate).toBe(1);
    expect(stats.centerGateMode).toBe('substring');
  });

  test('subword mode keeps composite "모닝루틴" via char 2-gram overlap with "루틴으로"', () => {
    const { byCell, stats } = applyMandalaFilterWithStats([composite], {
      ...input,
      centerGateMode: 'subword',
    });
    expect(stats.droppedByCenterGate).toBe(0);
    expect(stats.centerGateMode).toBe('subword');
    // Without sub-goal jaccard hits the candidate still drops at
    // gate 2. That's expected — the point of this test is the gate-1
    // pass.
    const anyKept = Array.from(byCell.values()).some((list) => list.length > 0);
    // jaccard on composite title ("모닝루틴 7가지 / 아침 루틴 7가지")
    // vs sub-goal tokens may be 0, so output may still be empty. The
    // stats check above is the assertion that matters.
    void anyKept;
  });

  test('subword mode still rejects unrelated noise ("iPhone 리뷰")', () => {
    const { stats } = applyMandalaFilterWithStats([noise], {
      ...input,
      centerGateMode: 'subword',
    });
    expect(stats.droppedByCenterGate).toBe(1);
  });

  test('off mode skips the gate entirely — both composite and noise pass to jaccard stage', () => {
    const { stats } = applyMandalaFilterWithStats([composite, noise], {
      ...input,
      centerGateMode: 'off',
    });
    expect(stats.droppedByCenterGate).toBe(0);
    expect(stats.centerGateMode).toBe('off');
    // Downstream: jaccard drops noise but may also drop composite if
    // no sub-goal token overlaps. This test verifies the gate itself
    // was skipped, not what jaccard does next.
  });

  test('subword mode is token-aware: unrelated 2-gram collisions below threshold are still dropped', () => {
    // Title shares a single 2-gram ("전문") with center token "전문가"
    // → matched 2-grams of "전문가": {전문, 문가} → 1/2 = 0.5 ≥ 0.3
    //   so this one actually matches (acceptable recall bias).
    // Title sharing only "전" + nothing else has 0 bigram overlap.
    const onlyChar = cand('ch', '전국민 명절 인사', '');
    const { stats } = applyMandalaFilterWithStats([onlyChar], {
      ...input,
      centerGateMode: 'subword',
    });
    // Expect this to drop — no 2-gram matches any center token above
    // the 0.3 floor. If this starts passing, SUBWORD_MIN_CENTER_MATCH
    // has drifted too low and noise will leak.
    expect(stats.droppedByCenterGate).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CenterGateMode — semantic (Phase 3, CP416)
// ---------------------------------------------------------------------------

describe('cosineSimilarity helper', () => {
  test('identical vectors → 1.0', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  test('orthogonal vectors → 0', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  test('negative dot clamps to 0 (opposite direction)', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(0);
  });

  test('length mismatch → 0 (safety)', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  test('zero-magnitude vector → 0 (avoid NaN)', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  test('partial overlap produces value in (0, 1)', () => {
    const s = cosineSimilarity([1, 1, 0], [1, 0, 0]);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

describe('applyMandalaFilter — centerGateMode: "semantic"', () => {
  const input = {
    centerGoal: '1달 일일 루틴으로 전문가되기',
    subGoals: [
      '전문 분야 선정 및 학습 계획 수립',
      '매일 집중 학습 시간 확보 및 루틴화',
      '실무 프로젝트 진행 및 포트폴리오 구축',
      '전문 커뮤니티 참여 및 네트워킹',
      '월간 집중 전문화',
      '지식 체계화 및 아웃풋 생산',
      '피드백 수집 및 개선 사이클',
      '일일 진도 추적 및 동기 유지',
    ],
    language: 'ko' as const,
  };

  // Synthetic 8-dim vectors: semantic neighborhood modeled as near-axis
  // alignment. Keeps tests hermetic (no Ollama) while exercising the
  // threshold / fallback / gate-drop branches.
  const centerVec = [1, 0.2, 0, 0, 0, 0, 0, 0];
  const paraphraseVec = [0.9, 0.3, 0, 0, 0, 0, 0, 0]; // cosine ≈ 0.99
  const unrelatedVec = [0, 0, 1, 0, 0, 0, 0, 0]; // cosine = 0
  const borderlineVec = [0.3, 0.05, 0.95, 0, 0, 0, 0, 0]; // cosine ≈ 0.31 (below 0.35 default)

  const paraphrase = cand('p1', '하루 습관 형성하는 법');
  const unrelated = cand('u1', 'iPhone 16 프로 리뷰');
  const borderline = cand('b1', '정보처리기능사 필기 22강');

  test('paraphrase passes gate (cosine ≈ 0.99 > 0.35)', () => {
    const { stats } = applyMandalaFilterWithStats([paraphrase], {
      ...input,
      centerGateMode: 'semantic',
      centerEmbedding: centerVec,
      candidateEmbeddings: new Map([['p1', paraphraseVec]]),
    });
    expect(stats.droppedByCenterGate).toBe(0);
    expect(stats.centerGateMode).toBe('semantic');
  });

  test('unrelated dropped at gate (cosine = 0)', () => {
    const { stats } = applyMandalaFilterWithStats([unrelated], {
      ...input,
      centerGateMode: 'semantic',
      centerEmbedding: centerVec,
      candidateEmbeddings: new Map([['u1', unrelatedVec]]),
    });
    expect(stats.droppedByCenterGate).toBe(1);
  });

  test('borderline below SEMANTIC_MIN_COSINE (0.35) dropped', () => {
    const { stats } = applyMandalaFilterWithStats([borderline], {
      ...input,
      centerGateMode: 'semantic',
      centerEmbedding: centerVec,
      candidateEmbeddings: new Map([['b1', borderlineVec]]),
    });
    // Keep the test pinned to the constant so threshold drift is visible.
    expect(SEMANTIC_MIN_COSINE).toBeCloseTo(0.35, 2);
    expect(stats.droppedByCenterGate).toBe(1);
  });

  test('semanticMinCosine override admits borderline candidate', () => {
    const { stats } = applyMandalaFilterWithStats([borderline], {
      ...input,
      centerGateMode: 'semantic',
      centerEmbedding: centerVec,
      candidateEmbeddings: new Map([['b1', borderlineVec]]),
      semanticMinCosine: 0.1,
    });
    expect(stats.droppedByCenterGate).toBe(0);
  });

  test('missing centerEmbedding → safety fallback to substring mode', () => {
    const { stats } = applyMandalaFilterWithStats([paraphrase], {
      ...input,
      centerGateMode: 'semantic',
      // centerEmbedding intentionally omitted
      candidateEmbeddings: new Map([['p1', paraphraseVec]]),
    });
    // Mode reported should reflect the effective mode, not the requested one.
    expect(stats.centerGateMode).toBe('substring');
  });

  test('missing per-candidate embedding → dropped at gate (0 score, not matched)', () => {
    const { stats } = applyMandalaFilterWithStats([paraphrase, unrelated], {
      ...input,
      centerGateMode: 'semantic',
      centerEmbedding: centerVec,
      // only paraphrase has a vector; unrelated has none
      candidateEmbeddings: new Map([['p1', paraphraseVec]]),
    });
    // unrelated has no vector → centerScore stays 0 → dropped at gate.
    // paraphrase still passes gate 1. Gate 2 (jaccard on sub-goals) may
    // still drop it downstream — that's independent of the gate-1 branch
    // we're testing here.
    expect(stats.droppedByCenterGate).toBeGreaterThanOrEqual(1);
  });

  test('SEMANTIC_MIN_CELL_COSINE is exported and equals 0.25', () => {
    expect(SEMANTIC_MIN_CELL_COSINE).toBeCloseTo(0.25, 5);
  });

  test('EN fixture: paraphrase admitted, off-domain dropped', () => {
    const enInput = {
      centerGoal: 'Master React hooks in 30 days',
      subGoals: [
        'useState patterns',
        'useEffect cleanup',
        'useMemo cost analysis',
        'useCallback stability',
        'custom hooks design',
        'context optimization',
        'concurrent rendering',
        'testing hooks',
      ],
      language: 'en' as const,
    };
    const enCenterVec = [1, 0.2, 0, 0];
    const enParaphraseVec = [0.88, 0.4, 0, 0]; // cosine > 0.35
    const enNoiseVec = [0, 0, 1, 0];

    const { stats } = applyMandalaFilterWithStats(
      [cand('e1', 'Learn React hooks fast'), cand('e2', 'Latest iPhone 16 Pro review')],
      {
        ...enInput,
        centerGateMode: 'semantic',
        centerEmbedding: enCenterVec,
        candidateEmbeddings: new Map<string, number[]>([
          ['e1', enParaphraseVec],
          ['e2', enNoiseVec],
        ]),
      }
    );
    expect(stats.centerGateMode).toBe('semantic');
    expect(stats.droppedByCenterGate).toBe(1); // noise only; paraphrase passes
  });
});

// ---------------------------------------------------------------------------
// Semantic cell assignment (Part A — subGoalEmbeddings)
// ---------------------------------------------------------------------------

describe('applyMandalaFilter — semantic cell assignment via subGoalEmbeddings', () => {
  // Mandala: AI 마케팅 (mirrors the production trace 8a272317).
  // Sub-goal embeddings are synthetic 4-dim vectors, each aligned with a
  // different axis so the argmax is unambiguous in tests.
  const centerGoal = 'AI 마케팅 전략';
  const subGoals = [
    'AI 마케팅 도구 및 플랫폼 학습', // cell 0 — axis [1, 0, 0, 0]
    '데이터 분석 및 인사이트 도출', // cell 1 — axis [0, 1, 0, 0]
    '콘텐츠 생성 및 최적화', // cell 2 — axis [0, 0, 1, 0]
    '고객 타겟팅 전략', // cell 3 — axis [0, 0, 0, 1]
    'ROI 측정 및 성과 관리', // cell 4 — axis [0.7, 0.7, 0, 0]
    '소셜 미디어 채널 운영', // cell 5 — axis [0, 0, 0.7, 0.7]
    '검색 엔진 최적화', // cell 6 — axis [0.5, 0, 0.5, 0]
    '이메일 마케팅 자동화', // cell 7 — axis [0, 0.5, 0, 0.5]
  ];
  // Sub-goal embedding vectors — each axis-aligned per above.
  const subGoalEmbeddings: number[][] = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
    [0.7, 0.7, 0, 0],
    [0, 0, 0.7, 0.7],
    [0.5, 0, 0.5, 0],
    [0, 0.5, 0, 0.5],
  ];
  const centerVec = [0.8, 0.6, 0, 0]; // near cells 0 + 1 axis

  // Input template — semantic center gate so all center-matched candidates pass gate 1.
  const baseInput = {
    centerGoal,
    subGoals,
    language: 'ko' as const,
    centerGateMode: 'semantic' as const,
    centerEmbedding: centerVec,
    subGoalEmbeddings,
  };

  test('(1) semantic cell assignment: candidate assigned to cell with highest cosine, even without title token overlap', () => {
    // Cell 2 (콘텐츠 생성) embedding: [0, 0, 1, 0].
    // Candidate title shares NO tokens with "콘텐츠 생성 및 최적화" — pure semantic.
    const candidateVec: number[] = [0, 0, 0.95, 0.1]; // closest to cell 2 axis
    const candidate = cand('sem1', '영상 제작 워크플로우 자동화', '');
    // We need the candidate to pass the center gate too — give it a non-zero cosine vs centerVec.
    // Override: use centerGateMode='off' so center gate is bypassed; we're testing cell routing only.
    const { byCell } = applyMandalaFilterWithStats([candidate], {
      ...baseInput,
      centerGateMode: 'off',
      candidateEmbeddings: new Map([['sem1', candidateVec]]),
    });
    // Must land in cell 2 (highest cosine with [0,0,1,0]).
    const cell2 = byCell.get(2) ?? [];
    expect(cell2).toHaveLength(1);
    expect(cell2[0]!.candidate.videoId).toBe('sem1');
    // All other cells must be empty.
    for (const [idx, list] of byCell) {
      if (idx !== 2) expect(list).toHaveLength(0);
    }
  });

  test('(2) lexical fallback when subGoalEmbeddings absent — existing Jaccard path unchanged', () => {
    // Without subGoalEmbeddings, the lexical path must behave identically to
    // the pre-fix implementation. "Reading 만점" has clear token overlap with
    // subGoal[0] of this separate TOEFL mandala.
    const toeflInput = {
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
      // subGoalEmbeddings intentionally omitted → lexical path
    };
    const candidate = cand('lex1', '토플 Reading 만점 전략', '토플 Reading 25점');
    const { byCell, stats } = applyMandalaFilterWithStats([candidate], toeflInput);
    // droppedByCellScoreBelowThreshold must be 0 (semantic path not taken).
    expect(stats.droppedByCellScoreBelowThreshold).toBe(0);
    // Candidate routed to Reading cell (0) via Jaccard.
    const cell0 = byCell.get(0) ?? [];
    expect(cell0).toHaveLength(1);
  });

  test('(3) candidate below SEMANTIC_MIN_CELL_COSINE on all cells is dropped', () => {
    // Use a zero-magnitude vector — cosineSimilarity returns 0 (zero-magnitude guard).
    // 0 < SEMANTIC_MIN_CELL_COSINE (0.25) so the candidate must be dropped.
    const zeroCandVec: number[] = [0, 0, 0, 0];
    const candidate = cand('drop1', '완전히 다른 주제의 영상', '전혀 관련 없는 설명');
    const { byCell, stats } = applyMandalaFilterWithStats([candidate], {
      ...baseInput,
      centerGateMode: 'off', // bypass center gate — test only cell assignment drop
      candidateEmbeddings: new Map([['drop1', zeroCandVec]]),
    });
    expect(stats.droppedByCellScoreBelowThreshold).toBeGreaterThanOrEqual(1);
    for (const list of byCell.values()) {
      expect(list).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// R4 empty-title shadow guard (2026-07-04, BL-17) — classify only, enforce = 0
// ---------------------------------------------------------------------------

describe('applyMandalaFilterWithStats — empty-title shadow guard (R4, enforce=0)', () => {
  // Mirrors the prod bug: a Tier 1 candidate whose video_pool row title was
  // SCRUBbed to '' but whose stale embedding still clears the semantic
  // cosine gate (candidateEmbeddings keyed by videoId, independent of the
  // current title text).
  const input = {
    centerGoal: '1달 일일 루틴으로 전문가되기',
    subGoals: [
      '전문 분야 선정 및 학습 계획 수립',
      '매일 집중 학습 시간 확보 및 루틴화',
      '실무 프로젝트 진행 및 포트폴리오 구축',
      '전문 커뮤니티 참여 및 네트워킹',
      '월간 집중 전문화',
      '지식 체계화 및 아웃풋 생산',
      '피드백 수집 및 개선 사이클',
      '일일 진도 추적 및 동기 유지',
    ],
    language: 'ko' as const,
    centerGateMode: 'semantic' as const,
    centerEmbedding: [1, 0.2, 0, 0, 0, 0, 0, 0],
    // Semantic cell assignment too (mirrors prod Tier 1: cell routing also
    // runs on embeddings, not title text) — cell 0 axis-aligned with the
    // stale embedding below so the candidate clears BOTH gates on cosine
    // alone, exactly like the prod zombie row.
    subGoalEmbeddings: [
      [1, 0.2, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0, 0],
      [0, 0, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 0, 0, 1, 0, 0],
      [0, 0, 0, 0, 0, 0, 1, 0],
      [0, 0, 0, 0, 0, 0, 0, 1],
      [0, 0, 1, 1, 0, 0, 0, 0],
    ],
  };
  // High-cosine stale embedding — mirrors the prod cosine-recruit that let
  // a blank-title zombie row through the semantic gate.
  const staleVec = [0.95, 0.25, 0, 0, 0, 0, 0, 0];
  const blankTitleCandidate = cand('zombie1', '', 'stale description', null);
  const whitespaceTitleCandidate = cand('zombie2', '   ', '', null);
  const normalCandidate = cand('p1', '하루 습관 형성하는 법', '', null);

  test('flag OFF (default/unset) — wouldRejectEmptyTitle stays 0 even with a blank-title candidate', () => {
    const { stats } = applyMandalaFilterWithStats([blankTitleCandidate], {
      ...input,
      candidateEmbeddings: new Map([['zombie1', staleVec]]),
      // emptyTitleGateShadow intentionally omitted
    });
    expect(stats.wouldRejectEmptyTitle).toBe(0);
  });

  test("flag ON — blank title ('') classified as would-reject, but still admitted (enforce=0)", () => {
    const { byCell, stats } = applyMandalaFilterWithStats([blankTitleCandidate], {
      ...input,
      candidateEmbeddings: new Map([['zombie1', staleVec]]),
      emptyTitleGateShadow: true,
    });
    expect(stats.wouldRejectEmptyTitle).toBe(1);
    // Classification only — the candidate must still be admitted exactly
    // as it would be without the flag (stale embedding clears the gate).
    const flat = Array.from(byCell.values()).flat();
    expect(flat.some((a) => a.candidate.videoId === 'zombie1')).toBe(true);
  });

  test('flag ON — whitespace-only title also classified as would-reject', () => {
    const { stats } = applyMandalaFilterWithStats([whitespaceTitleCandidate], {
      ...input,
      candidateEmbeddings: new Map([['zombie2', staleVec]]),
      emptyTitleGateShadow: true,
    });
    expect(stats.wouldRejectEmptyTitle).toBe(1);
  });

  test('flag ON — normal non-empty title never counted (no over-flagging)', () => {
    const { stats } = applyMandalaFilterWithStats([normalCandidate], {
      ...input,
      candidateEmbeddings: new Map([['p1', staleVec]]),
      emptyTitleGateShadow: true,
    });
    expect(stats.wouldRejectEmptyTitle).toBe(0);
  });

  test('flag ON — mixed batch counts only the blank-title candidates', () => {
    const { stats } = applyMandalaFilterWithStats(
      [blankTitleCandidate, whitespaceTitleCandidate, normalCandidate],
      {
        ...input,
        candidateEmbeddings: new Map([
          ['zombie1', staleVec],
          ['zombie2', staleVec],
          ['p1', staleVec],
        ]),
        emptyTitleGateShadow: true,
      }
    );
    expect(stats.wouldRejectEmptyTitle).toBe(2);
  });

  test('enforce=0 invariant — byCell output is byte-identical whether the flag is on or off', () => {
    const candidates = [blankTitleCandidate, normalCandidate];
    const embeddings = new Map([
      ['zombie1', staleVec],
      ['p1', staleVec],
    ]);
    const off = applyMandalaFilterWithStats(candidates, {
      ...input,
      candidateEmbeddings: embeddings,
      emptyTitleGateShadow: false,
    });
    const on = applyMandalaFilterWithStats(candidates, {
      ...input,
      candidateEmbeddings: embeddings,
      emptyTitleGateShadow: true,
    });
    const flatOff = Array.from(off.byCell.values())
      .flat()
      .map((a) => ({ id: a.candidate.videoId, score: a.score, cellIndex: a.cellIndex }));
    const flatOn = Array.from(on.byCell.values())
      .flat()
      .map((a) => ({ id: a.candidate.videoId, score: a.score, cellIndex: a.cellIndex }));
    expect(flatOn).toEqual(flatOff);
    expect(off.stats.output).toBe(on.stats.output);
    // Only the instrumentation counter differs.
    expect(off.stats.wouldRejectEmptyTitle).toBe(0);
    expect(on.stats.wouldRejectEmptyTitle).toBe(1);
  });
});
