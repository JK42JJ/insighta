/**
 * Rich Summary v2 — prompt + validator + completeness + reader (CP437).
 */

import {
  buildV2Prompt,
  validateV2Layered,
  scoreCompleteness,
  V2ValidationError,
  PASS_THRESHOLD,
  ONE_LINER_MAX_LEN,
  type RichSummaryV2Layered,
} from '@/modules/skills/rich-summary-v2-prompt';
import {
  readRichSummary,
  adaptV1ToLayered,
  type RichSummaryRow,
} from '@/modules/skills/rich-summary-reader';

function validSummary(overrides: Partial<RichSummaryV2Layered> = {}): RichSummaryV2Layered {
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
      bias_signals: {
        has_ad: false,
        is_sponsored: false,
        subjectivity_level: 'low',
        notes: '',
      },
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
    ...overrides,
  };
}

describe('buildV2Prompt', () => {
  test('substitutes title / description / channel / language', () => {
    const out = buildV2Prompt({
      title: '시간관리 강의',
      description: '3단계 핵심 정리',
      channel: 'TestChannel',
      language: 'ko',
    });
    expect(out).toContain('시간관리 강의');
    expect(out).toContain('3단계 핵심 정리');
    expect(out).toContain('TestChannel');
    expect(out).toContain('ko');
    expect(out).toContain('Korean');
  });

  test('truncates description to 800 chars', () => {
    const long = 'x'.repeat(2000);
    const out = buildV2Prompt({ title: 't', description: long, channel: 'c', language: 'en' });
    // ensure the truncated version, not the full 2000-char string, is in the prompt
    expect(out.includes('x'.repeat(800))).toBe(true);
    expect(out.includes('x'.repeat(801))).toBe(false);
  });
});

describe('validateV2Layered', () => {
  test('accepts a fully-formed payload', () => {
    expect(() => validateV2Layered(validSummary())).not.toThrow();
  });

  test('rejects unknown domain slug', () => {
    expect(() =>
      validateV2Layered({
        ...validSummary(),
        core: { ...validSummary().core, domain: 'unknown_slug' },
      })
    ).toThrow(V2ValidationError);
  });

  test('rejects qa_pairs with non-1/2/3 level', () => {
    const bad = validSummary();
    expect(() =>
      validateV2Layered({
        ...bad,
        lora: { qa_pairs: [{ level: 4, q: 'q', a: 'a', context: 'video' }] },
      })
    ).toThrow(V2ValidationError);
  });

  test('rejects missing analysis.mandala_fit', () => {
    const bad = validSummary();
    const broken = {
      ...bad,
      analysis: { ...bad.analysis, mandala_fit: undefined },
    };
    expect(() => validateV2Layered(broken)).toThrow(V2ValidationError);
  });
});

describe('scoreCompleteness', () => {
  test('passes when all 10 weights are met', () => {
    const r = scoreCompleteness(validSummary());
    expect(r.score).toBe(1);
    expect(r.passed).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  test('fails when key_concepts < 3 (weight subtracted, reason recorded)', () => {
    const s = validSummary();
    s.analysis.key_concepts = [{ term: 'a', definition: 'b' }];
    const r = scoreCompleteness(s);
    expect(r.score).toBeLessThan(1);
    expect(r.score).toBeCloseTo(0.9, 5);
    expect(r.reasons.some((x) => x.includes('key_concepts'))).toBe(true);
  });

  test('fails completeness when 4 weights drop (score < 0.7)', () => {
    const s = validSummary();
    s.analysis.key_concepts = [];
    s.analysis.actionables = [];
    s.analysis.mandala_fit.suggested_goals = [];
    s.lora.qa_pairs = [];
    const r = scoreCompleteness(s);
    expect(r.passed).toBe(false);
    expect(r.score).toBeLessThan(PASS_THRESHOLD);
  });

  test('fails when one_liner exceeds 20 chars', () => {
    const s = validSummary();
    s.core.one_liner = '가'.repeat(ONE_LINER_MAX_LEN + 1);
    const r = scoreCompleteness(s);
    expect(r.score).toBeLessThan(1);
    expect(r.reasons.some((x) => x.includes('one_liner'))).toBe(true);
  });

  test('records L1 reason when qa_pairs < 5 (single weight drop)', () => {
    const s = validSummary();
    s.lora.qa_pairs = s.lora.qa_pairs.slice(0, 4);
    const r = scoreCompleteness(s);
    expect(r.score).toBeLessThan(1);
    expect(r.reasons.some((x) => x.includes('L1'))).toBe(true);
  });
});

describe('readRichSummary template_version branch', () => {
  function row(over: Partial<RichSummaryRow>): RichSummaryRow {
    return {
      video_id: 'abc12345xyz',
      template_version: 'v2',
      one_liner: 'one liner',
      structured: null,
      core: null,
      analysis: null,
      segments: null,
      translations: null,
      lora: null,
      completeness: null,
      quality_score: null,
      quality_flag: null,
      source_language: null,
      model: null,
      ...over,
    };
  }

  test('v2 row returns layered columns directly', () => {
    const summary = validSummary();
    const r = readRichSummary(
      row({
        template_version: 'v2',
        core: summary.core,
        analysis: summary.analysis,
        lora: summary.lora,
        completeness: 0.9,
        quality_flag: 'pass',
        source_language: 'ko',
      })
    );
    expect(r.templateVersion).toBe('v2');
    expect(r.sourceLanguage).toBe('ko');
    expect(r.score).toBe(0.9);
    expect(r.core?.domain).toBe('learning');
    expect(r.lora?.qa_pairs.length).toBe(5);
  });

  test('v1 row falls back through adapter — no LoRA, partial core', () => {
    const v1Structured = {
      core_argument: 'v1 핵심 주장',
      actionables: ['행동 1', '행동 2', '행동 3'],
      content_type: 'tutorial',
      depth_level: 'beginner',
      mandala_fit: {
        suggested_topics: ['learning'], // matches a slug → adapter picks it
        relevance_rationale: 'v1 rationale',
      },
      bias_signals: ['Commercial intent'],
    };
    const r = readRichSummary(
      row({
        template_version: 'v1',
        structured: v1Structured,
        one_liner: 'fallback one_liner',
        quality_score: 0.85,
        quality_flag: 'pass',
        source_language: 'ko',
      })
    );
    expect(r.templateVersion).toBe('v1');
    expect(r.score).toBe(0.85);
    expect(r.lora).toBeNull();
    expect(r.core?.domain).toBe('learning');
    expect(r.analysis?.actionables.length).toBe(3);
    expect(r.analysis?.mandala_fit.relevance_rationale).toBe('v1 rationale');
  });

  test('adaptV1ToLayered returns null core when domain is unknown', () => {
    const adapted = adaptV1ToLayered(
      {
        core_argument: 'foo',
        actionables: ['x'],
        content_type: 'tutorial',
        depth_level: 'beginner',
        mandala_fit: { suggested_topics: ['nonexistent_topic'] },
      },
      ''
    );
    expect(adapted.core).toBeNull();
    expect(adapted.analysis).not.toBeNull();
  });
});
