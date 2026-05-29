/**
 * Enrichment-depth audit warn-level (CP488+ 2026-05-29).
 *
 * Asserts that `scoreCompleteness` returns `enrichmentRich=false` when one
 * of the 4 enrichment fields is missing/sparse, so the caller (upsert-direct
 * route + cron generator) can stamp `quality_flag='enrichment_low'`.
 *
 * Why: the Mac Mini PROMPT_HEADER fork drift went undetected for 433
 * backfill rows because `scoreCompleteness` only enforced the basic
 * schema. This audit catches future drift at upsert time instead of
 * via post-mortem.
 */

import {
  scoreCompleteness,
  type RichSummaryV2Layered,
} from '@/modules/skills/rich-summary-v2-prompt';

function richPayload(): RichSummaryV2Layered {
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
        { name: '회고 노트', type: 'tool' },
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
    segments: {
      sections: [
        {
          idx: 0,
          from_sec: 0,
          to_sec: 120,
          title: '도입',
          summary: '문제 정의',
          relevance_pct: 60,
          key_points: [{ text: '시간관리는 3단계', timestamp_sec: 30 }],
        },
        {
          idx: 1,
          from_sec: 120,
          to_sec: 300,
          title: '핵심',
          summary: '3단계 설명',
          relevance_pct: 85,
          key_points: [{ text: '포모도로 25분', timestamp_sec: 150 }],
        },
      ],
      atoms: [
        {
          idx: 0,
          type: 'fact',
          text: '시간관리 3단계',
          timestamp_sec: 60,
          entity_refs: ['포모도로'],
        },
        {
          idx: 1,
          type: 'tip',
          text: '포모도로 적용',
          timestamp_sec: 180,
          entity_refs: ['포모도로'],
        },
      ],
    },
  };
}

describe('scoreCompleteness enrichment-depth audit', () => {
  test('rich payload → enrichmentRich=true', () => {
    const score = scoreCompleteness(richPayload());
    expect(score.passed).toBe(true);
    expect(score.enrichmentRich).toBe(true);
    expect(score.enrichmentReasons).toEqual([]);
  });

  test('missing analysis.entities → enrichmentRich=false + reason', () => {
    const p = richPayload();
    p.analysis.entities = [];
    const score = scoreCompleteness(p);
    expect(score.passed).toBe(true); // basic completeness still pass
    expect(score.enrichmentRich).toBe(false);
    expect(score.enrichmentReasons.some((r) => r.includes('analysis.entities'))).toBe(true);
  });

  test('section without relevance_pct → enrichmentRich=false + reason', () => {
    const p = richPayload();
    if (p.segments?.sections?.[0]) {
      delete (p.segments.sections[0] as { relevance_pct?: number }).relevance_pct;
    }
    const score = scoreCompleteness(p);
    expect(score.passed).toBe(true);
    expect(score.enrichmentRich).toBe(false);
    expect(score.enrichmentReasons.some((r) => r.includes('relevance_pct'))).toBe(true);
  });

  test('no section has key_points → enrichmentRich=false + reason', () => {
    const p = richPayload();
    for (const s of p.segments?.sections ?? []) delete s.key_points;
    const score = scoreCompleteness(p);
    expect(score.passed).toBe(true);
    expect(score.enrichmentRich).toBe(false);
    expect(score.enrichmentReasons.some((r) => r.includes('key_points coverage'))).toBe(true);
  });

  test('no atom has entity_refs → enrichmentRich=false + reason', () => {
    const p = richPayload();
    for (const a of p.segments?.atoms ?? []) delete a.entity_refs;
    const score = scoreCompleteness(p);
    expect(score.passed).toBe(true);
    expect(score.enrichmentRich).toBe(false);
    expect(score.enrichmentReasons.some((r) => r.includes('entity_refs coverage'))).toBe(true);
  });

  test('multiple enrichment fields missing → all reasons collected', () => {
    const p = richPayload();
    p.analysis.entities = [];
    for (const s of p.segments?.sections ?? []) delete s.key_points;
    const score = scoreCompleteness(p);
    expect(score.passed).toBe(true);
    expect(score.enrichmentRich).toBe(false);
    expect(score.enrichmentReasons.length).toBeGreaterThanOrEqual(2);
  });
});
