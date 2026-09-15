/**
 * Rich Summary v2 — unique_claim (2026-09-15).
 *
 * Locks three things: the prompt asks for the field only when the flag is on,
 * the validator keeps a well-formed claim and drops a malformed one without
 * failing the summary, and the verbatim gate passes only a contiguous run of
 * the claim found inside ±UNIQUE_CLAIM_WINDOW_SEC of its timestamp.
 */

import {
  buildV2Prompt,
  validateV2Layered,
  verifyUniqueClaim,
  parseAnnotatedTranscript,
  normalizeForVerbatim,
  uniqueClaimMinMatchLen,
  UNIQUE_CLAIM_MIN_MATCH_HANGUL,
  UNIQUE_CLAIM_MIN_MATCH_LATIN,
  UNIQUE_CLAIM_WINDOW_SEC,
  UNIQUE_CLAIM_TEXT_MAX_LEN,
  type RichSummaryV2Layered,
} from '@/modules/skills/rich-summary-v2-prompt';
import { loadRichSummaryConfig } from '@/config/rich-summary';

const ORIGINAL_SENTENCE = '다른 유튜브에서 얘기하지 않는 가장 중요한 내용을 발췌해 줘';

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
        },
        {
          idx: 1,
          from_sec: 120,
          to_sec: 300,
          title: '핵심',
          summary: '3단계 설명',
          relevance_pct: 80,
        },
      ],
      atoms: [
        { idx: 0, type: 'fact', text: '시간관리는 3단계', timestamp_sec: 60 },
        { idx: 1, type: 'tip', text: '포모도로 25분', timestamp_sec: 180 },
      ],
    },
  };
}

const TRANSCRIPT_KO = [
  '[02:10] 상태 부분에서 설정을 하시면 원하시는 업무 상태를 개별적으로 설정하실 수가 있습니다.',
  '[02:18] 이 상태 부분에서 진행, QA 요청, VOC 공유, 추가 연구 필요와 같은 상태를 개별적으로 생성하신 다음',
  '[02:31] 저장을 누르시게 되면 원하시는 업무 상태를 해당 프로젝트에서 직접 설정하실 수가 있습니다.',
  '[09:05] 그러면 결제할 수 있는 페이지도 하나 만들어야 되겠죠.',
].join('\n');

const TRANSCRIPT_EN = [
  '[01:10] Boil the bracken only six to eight minutes until a fingernail slightly enters the stem.',
  '[01:20] Then soak it twelve to twenty four hours and change the water four or five times.',
  '[08:00] Serve with sesame oil and a pinch of salt.',
].join('\n');

describe('buildV2Prompt — unique_claim request is flag-gated', () => {
  const base = {
    title: '플로우 CX 사례',
    description: '설명',
    channel: 'Flow',
    language: 'ko' as const,
  };

  test('omitted / false: prompt does not mention unique_claim', () => {
    expect(buildV2Prompt(base)).not.toContain('unique_claim');
    expect(buildV2Prompt({ ...base, uniqueClaim: false })).not.toContain('unique_claim');
  });

  test('true: prompt carries the field, the original sentence verbatim, and the rule', () => {
    const p = buildV2Prompt({ ...base, uniqueClaim: true });
    expect(p).toContain('"unique_claim"');
    expect(p).toContain(ORIGINAL_SENTENCE);
    expect(p).toContain('core.unique_claim: exactly ONE claim');
    expect(p).not.toContain('{unique_claim_field}');
    expect(p).not.toContain('{unique_claim_rule}');
  });
});

describe('loadRichSummaryConfig — RICH_SUMMARY_UNIQUE_CLAIM_ENABLED', () => {
  test('defaults to off', () => {
    expect(loadRichSummaryConfig({}).uniqueClaimEnabled).toBe(false);
  });
  test('reads true', () => {
    expect(
      loadRichSummaryConfig({ RICH_SUMMARY_UNIQUE_CLAIM_ENABLED: 'true' }).uniqueClaimEnabled
    ).toBe(true);
  });
});

describe('validateV2Layered — unique_claim parsing', () => {
  test('well-formed claim is kept, timestamp floored', () => {
    const p = validPayload();
    const raw = {
      ...p,
      core: {
        ...p.core,
        unique_claim: {
          text: '상태값 4종을 커스텀한다',
          timestamp_sec: 138.7,
          why_unique: '흔한 요약엔 없음',
        },
      },
    };
    const out = validateV2Layered(raw);
    expect(out.core.unique_claim).toEqual({
      text: '상태값 4종을 커스텀한다',
      timestamp_sec: 138,
      why_unique: '흔한 요약엔 없음',
    });
  });

  test.each([
    ['missing text', { timestamp_sec: 10 }],
    ['negative timestamp', { text: '주장', timestamp_sec: -1 }],
    ['non-numeric timestamp', { text: '주장', timestamp_sec: 'soon' }],
    ['over the length cap', { text: 'x'.repeat(UNIQUE_CLAIM_TEXT_MAX_LEN + 1), timestamp_sec: 10 }],
    ['not an object', 'just a string'],
  ])('malformed claim (%s) is dropped without failing the summary', (_label, uc) => {
    const p = validPayload();
    const out = validateV2Layered({ ...p, core: { ...p.core, unique_claim: uc } });
    expect(out.core.unique_claim).toBeUndefined();
    expect(out.core.one_liner).toBe('시간관리 핵심 3단계');
  });
});

describe('verifyUniqueClaim — verbatim gate', () => {
  test('Korean claim with a verbatim run inside the window passes and reports the line', () => {
    const v = verifyUniqueClaim(
      {
        text: "업무 상태를 '진행, QA 요청, VOC 공유, 추가 연구 필요'와 같은 상태를 개별적으로 생성한다",
        timestamp_sec: 150,
      },
      TRANSCRIPT_KO
    );
    expect(v.pass).toBe(true);
    expect(v.reason).toBe('ok');
    expect(v.minMatchLen).toBe(UNIQUE_CLAIM_MIN_MATCH_HANGUL);
    expect(v.longestRun).toBeGreaterThanOrEqual(UNIQUE_CLAIM_MIN_MATCH_HANGUL);
    expect(v.matchedAtSec).toBe(138);
    expect(v.tsErrorSec).toBe(12);
  });

  test('same words, timestamp outside the window: no_window', () => {
    const v = verifyUniqueClaim(
      {
        text: '진행, QA 요청, VOC 공유, 추가 연구 필요와 같은 상태를 개별적으로 생성',
        timestamp_sec: 545 + UNIQUE_CLAIM_WINDOW_SEC + 300,
      },
      TRANSCRIPT_KO
    );
    expect(v.pass).toBe(false);
    expect(v.reason).toBe('no_window');
  });

  test('paraphrase inside the window: no_verbatim_run', () => {
    const v = verifyUniqueClaim(
      {
        text: '한쪽만 정신줄을 잡고 있으면 대화가 회복된다는 비대칭 회복 원칙',
        timestamp_sec: 140,
      },
      TRANSCRIPT_KO
    );
    expect(v.pass).toBe(false);
    expect(v.reason).toBe('no_verbatim_run');
    expect(v.longestRun).toBeLessThan(UNIQUE_CLAIM_MIN_MATCH_HANGUL);
  });

  test('punctuation and spacing differences do not break the match', () => {
    const v = verifyUniqueClaim(
      {
        text: '"진행/QA요청/VOC공유/추가연구필요"와 같은 상태를 개별적으로 생성하신다',
        timestamp_sec: 140,
      },
      TRANSCRIPT_KO
    );
    expect(v.pass).toBe(true);
  });

  test('Latin claim uses the longer minimum run', () => {
    expect(uniqueClaimMinMatchLen('Boil the bracken only six to eight minutes')).toBe(
      UNIQUE_CLAIM_MIN_MATCH_LATIN
    );
    const pass = verifyUniqueClaim(
      {
        text: 'Boil the bracken only six to eight minutes until a fingernail slightly enters the stem',
        timestamp_sec: 75,
      },
      TRANSCRIPT_EN
    );
    expect(pass.pass).toBe(true);
    expect(pass.matchedAtSec).toBe(70);
    const short = verifyUniqueClaim(
      { text: 'Boil the bracken only briefly, then rest it overnight', timestamp_sec: 75 },
      TRANSCRIPT_EN
    );
    expect(short.pass).toBe(false);
    expect(short.reason).toBe('no_verbatim_run');
  });

  test('claim shorter than the minimum run cannot pass', () => {
    const v = verifyUniqueClaim({ text: '저장을 누른다', timestamp_sec: 150 }, TRANSCRIPT_KO);
    expect(v.pass).toBe(false);
    expect(v.reason).toBe('empty_claim');
  });

  test('plain-text transcript (no [mm:ss] lines) never passes', () => {
    const v = verifyUniqueClaim(
      { text: '진행, QA 요청, VOC 공유, 추가 연구 필요와 같은 상태', timestamp_sec: 138 },
      '진행, QA 요청, VOC 공유, 추가 연구 필요와 같은 상태를 개별적으로 생성'
    );
    expect(v.pass).toBe(false);
    expect(v.reason).toBe('no_window');
  });
});

describe('helpers', () => {
  test('parseAnnotatedTranscript reads mm:ss and hh:mm:ss', () => {
    const lines = parseAnnotatedTranscript('[02:18] a\n[01:02:03] b\nno stamp\n[00:00]');
    expect(lines).toEqual([
      { sec: 138, text: 'a' },
      { sec: 3723, text: 'b' },
      { sec: 0, text: '' },
    ]);
  });
  test('normalizeForVerbatim strips spacing and punctuation, keeps letters', () => {
    expect(normalizeForVerbatim('진행, QA 요청!  VOC 공유')).toBe('진행qa요청voc공유');
  });
});
