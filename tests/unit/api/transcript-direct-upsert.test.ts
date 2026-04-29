/**
 * /api/v1/internal/v2-summary/upsert-direct (CP437, 2026-04-29).
 *
 * Smoke-level validation: this route bypasses the LLM entirely. All it
 * does is validate the supplied v2 layered JSON against the same schema
 * the generator produces, then run completeness scoring + DB upsert.
 *
 * The validator + scorer themselves are covered exhaustively in
 * tests/unit/skills/rich-summary-v2.test.ts. This file only proves the
 * route plugs the validator into the right place by re-running it
 * against representative payloads.
 */

import {
  validateV2Layered,
  scoreCompleteness,
  V2ValidationError,
  type RichSummaryV2Layered,
} from '@/modules/skills/rich-summary-v2-prompt';

function validPayload(): RichSummaryV2Layered {
  return {
    core: {
      one_liner: '시간관리 핵심 3단계',
      domain: 'learning',
      depth_level: 'beginner',
      content_type: 'tutorial',
      target_audience: '시간관리가 어려운 직장인',
    },
    analysis: {
      core_argument:
        '효과적인 시간관리는 계획 / 실행 / 회고의 3단계로 구성되며 각 단계가 서로 보완 작용한다.',
      key_concepts: [
        { term: '포모도로', definition: '25분 집중 + 5분 휴식' },
        { term: '타임블로킹', definition: '시간대별 업무 고정 배치' },
        { term: '회고', definition: '하루 끝 5분 정리' },
      ],
      actionables: ['오늘 저녁 내일 할 일 3가지 적기', '포모도로 앱 설치', '회고 노트 시작하기'],
      mandala_fit: {
        suggested_goals: ['생산성 향상', '루틴 만들기'],
        relevance_rationale: '직접 적용 가능한 시간관리 기법.',
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

describe('/v2-summary/upsert-direct payload contract', () => {
  test('valid payload passes validator + completeness', () => {
    const payload = validPayload();
    expect(() => validateV2Layered(payload)).not.toThrow();
    const score = scoreCompleteness(payload);
    expect(score.passed).toBe(true);
    expect(score.score).toBe(1);
  });

  test('rejects missing core (route returns 422)', () => {
    expect(() =>
      validateV2Layered({ analysis: validPayload().analysis, lora: validPayload().lora })
    ).toThrow(V2ValidationError);
  });

  test('rejects missing lora.qa_pairs', () => {
    expect(() =>
      validateV2Layered({
        core: validPayload().core,
        analysis: validPayload().analysis,
        lora: { qa_pairs: undefined },
      })
    ).toThrow(V2ValidationError);
  });

  test('rejects unknown domain (route returns 422)', () => {
    expect(() =>
      validateV2Layered({
        ...validPayload(),
        core: { ...validPayload().core, domain: 'unknown_slug' },
      })
    ).toThrow(V2ValidationError);
  });

  test('insufficient L1 qa_pairs fails completeness threshold', () => {
    const p = validPayload();
    p.lora.qa_pairs = p.lora.qa_pairs.slice(0, 2);
    p.analysis.key_concepts = [];
    p.analysis.actionables = [];
    p.analysis.mandala_fit.suggested_goals = [];
    const score = scoreCompleteness(p);
    expect(score.passed).toBe(false);
    expect(score.score).toBeLessThan(0.7);
  });
});
