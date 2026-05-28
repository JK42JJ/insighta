/**
 * Regression guard: upsert-direct route MUST forward `segments` to
 * validateV2Layered (CP488+ 3차 backfill fail root cause).
 *
 * Bug history (2026-05-28): the route's validateV2Layered call passed only
 * {core, analysis, lora} — segments was omitted. validateV2Layered then
 * populated summary.segments = undefined. scoreCompleteness saw sectionCount
 * = 0 + atomCount = 0 → segmentsValid = false → 422 completeness_below_
 * threshold for every Mac Mini payload (50+ videos in the failing batch).
 *
 * This test exercises the validator/scorer contract directly. The route's
 * forwarding of `segments` is also guarded statically by
 * scripts/health-check-v2-pipeline.sh stage L1 (grep on the source file).
 */

import {
  validateV2Layered,
  scoreCompleteness,
  V2ValidationError,
  type RichSummaryV2Layered,
} from '@/modules/skills/rich-summary-v2-prompt';

function validCoreAnalysisLora(): Omit<RichSummaryV2Layered, 'segments'> {
  return {
    core: {
      one_liner: '시간관리 핵심 3단계',
      domain: 'learning',
      depth_level: 'beginner',
      content_type: 'tutorial',
      target_audience: '시간관리가 어려운 직장인',
    },
    analysis: {
      core_argument: '효과적인 시간관리는 계획 / 실행 / 회고의 3단계로 구성된다.',
      key_concepts: [
        { term: '포모도로', definition: '25분 집중 + 5분 휴식' },
        { term: '타임블로킹', definition: '시간대별 업무 고정 배치' },
        { term: '회고', definition: '하루 끝 5분 정리' },
      ],
      entities: [
        { name: '포모도로', type: 'concept' },
        { name: '타임블로킹', type: 'concept' },
      ],
      actionables: ['오늘 저녁 내일 할 일 3가지 적기', '포모도로 앱 설치', '회고 노트 시작하기'],
      mandala_fit: {
        suggested_goals: ['생산성 향상', '루틴 만들기'],
        relevance_rationale: '직접 적용 가능한 시간관리 기법.',
        mandala_relevance_pct: 75,
      },
      bias_signals: { has_ad: false, is_sponsored: false, subjectivity_level: 'low', notes: '' },
      prerequisites: '',
    },
    lora: {
      qa_pairs: [
        { level: 1, q: 'Q1', a: 'A1', context: 'video' },
        { level: 1, q: 'Q2', a: 'A2', context: 'video' },
        { level: 1, q: 'Q3', a: 'A3', context: 'video' },
        { level: 1, q: 'Q4', a: 'A4', context: 'video' },
        { level: 1, q: 'Q5', a: 'A5', context: 'video' },
      ],
    },
  };
}

const TWO_SECTION_SEGMENTS = {
  sections: [
    { idx: 0, from_sec: 0, to_sec: 120, title: 'Intro', summary: 'overview' },
    { idx: 1, from_sec: 120, to_sec: 240, title: 'Detail', summary: 'core mechanism' },
  ],
  atoms: [
    { idx: 0, type: 'fact', text: 'Atom 1', timestamp_sec: 30 },
    { idx: 1, type: 'tip', text: 'Atom 2', timestamp_sec: 150 },
  ],
};

const ONE_CHUNK_SHORT_VIDEO_SEGMENTS = {
  sections: [{ idx: 0, from_sec: 0, to_sec: 162, title: 'Whole', summary: 'short video' }],
  atoms: [{ idx: 0, type: 'fact', text: 'Atom', timestamp_sec: 80 }],
};

describe('upsert-direct: segments forward to validateV2Layered (CP488+ regression)', () => {
  test('segments forwarded → summary.segments populated → completeness passes', () => {
    const base = validCoreAnalysisLora();
    const summary = validateV2Layered({ ...base, segments: TWO_SECTION_SEGMENTS });
    expect(summary.segments).toBeDefined();
    expect(summary.segments?.sections?.length).toBe(2);
    expect(summary.segments?.atoms?.length).toBe(2);

    const score = scoreCompleteness(summary);
    expect(score.passed).toBe(true);
    expect(score.reasons).not.toContain('segments.sections empty: 0 (expected 1+)');
  });

  test('segments OMITTED (the bug) → completeness fails with "segments.sections empty"', () => {
    const base = validCoreAnalysisLora();
    // Bug repro: omit segments from the validateV2Layered call.
    const summary = validateV2Layered(base);
    expect(summary.segments).toBeUndefined();

    const score = scoreCompleteness(summary);
    expect(score.passed).toBe(false);
    expect(score.reasons).toContain('segments.sections empty: 0 (expected 1+)');
    expect(score.reasons).toContain('segments.atoms empty: 0 (expected 1+)');
    // score itself can still be high — the regression is that passed=false
    // even when core/analysis/lora are perfect.
    expect(score.score).toBeGreaterThanOrEqual(0.7);
  });

  test('short video, 1 chunk, real to_sec — passes (no MIN_SECTIONS=3 hard cap)', () => {
    const base = validCoreAnalysisLora();
    const summary = validateV2Layered({ ...base, segments: ONE_CHUNK_SHORT_VIDEO_SEGMENTS });
    expect(summary.segments?.sections?.length).toBe(1);

    const score = scoreCompleteness(summary);
    expect(score.passed).toBe(true);
  });

  test('all sections to_sec=0 (description-only fallback) → still fails', () => {
    const base = validCoreAnalysisLora();
    const summary = validateV2Layered({
      ...base,
      segments: {
        sections: [{ idx: 0, from_sec: 0, to_sec: 0, title: 'Fallback', summary: 'desc only' }],
        atoms: [{ idx: 0, type: 'fact', text: 'Atom', timestamp_sec: 0 }],
      },
    });
    const score = scoreCompleteness(summary);
    expect(score.passed).toBe(false);
    expect(score.reasons).toContain(
      'segments.sections all have to_sec=0 (description-only fallback)'
    );
  });
});

describe('upsert-direct: mandala_relevance_pct default-0 inject (CP488+)', () => {
  test('payload missing mandala_relevance_pct → validator throws (route MUST default-0 first)', () => {
    const base = validCoreAnalysisLora();
    // Simulate Mac Mini process-one.sh embedded prompt that predates CP462+:
    // mandala_fit object lacks the field entirely.
    const broken = {
      ...base,
      analysis: {
        ...base.analysis,
        mandala_fit: {
          suggested_goals: base.analysis.mandala_fit.suggested_goals,
          relevance_rationale: base.analysis.mandala_fit.relevance_rationale,
          // mandala_relevance_pct deliberately absent
        },
      },
    };
    let caught: V2ValidationError | null = null;
    try {
      validateV2Layered(broken);
    } catch (err) {
      caught = err as V2ValidationError;
    }
    expect(caught).toBeInstanceOf(V2ValidationError);
    expect(caught?.path).toBe('analysis.mandala_fit.mandala_relevance_pct');

    // The route applies the default-0 patch BEFORE calling the validator —
    // this is the contract that keeps the bulk path unblocked.
    const patched = {
      ...broken,
      analysis: {
        ...broken.analysis,
        mandala_fit: { ...broken.analysis.mandala_fit, mandala_relevance_pct: 0 },
      },
    };
    expect(() => validateV2Layered(patched)).not.toThrow();
  });
});
