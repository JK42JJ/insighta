/**
 * v2 translations (CP499+ 출시 트랙) — James 요구 4케이스:
 *   1) ko 만다라 + 영어 v2 → 한국어 번역 저장·표시
 *   2) en 만다라 + 영어 v2 → 원본 (번역 경로 자체 미발동 = lang===source)
 *   3) 번역 실패 → 원어 폴백 + 실패 카운트 기록, 캡(3) 도달 시 LLM 미호출
 *   4) 구조 보존 strict — 키/배열길이/숫자 불일치 = 실패 처리 (#896 계열)
 */

const noopFn = jest.fn();
const noopLogger = {
  info: noopFn,
  warn: noopFn,
  error: noopFn,
  debug: noopFn,
  child: () => noopLogger,
};
jest.mock('@/utils/logger', () => ({ logger: noopLogger }));

const updateMock = jest.fn().mockResolvedValue({});
jest.mock('@/modules/database', () => ({
  getPrismaClient: () => ({ video_rich_summaries: { update: updateMock } }),
}));
jest.mock('@/modules/llm/openrouter', () => ({
  OpenRouterGenerationProvider: jest.fn(),
}));

import {
  sameShape,
  parseTranslateResponse,
  translateRichSummaryPayload,
  translateAndStore,
  getStoredTranslation,
  translationFailureCount,
  MAX_TRANSLATE_FAILURES,
  type TranslatablePayload,
} from '@/modules/skills/rich-summary-translator';

const payload: TranslatablePayload = {
  one_liner: 'Build production apps with Claude',
  core: { tl_dr: 'English summary', key_points: [{ text: 'point A', at: '01:23' }] },
  analysis: { core_argument: 'arg', mandala_fit: { score: 85 } },
  segments: [{ title: 'Intro', from: 0, to: 60, relevance_pct: 72 }],
};

const koTranslated = {
  one_liner: '클로드로 프로덕션 앱 만들기',
  core: { tl_dr: '한국어 요약', key_points: [{ text: '포인트 A', at: '01:23' }] },
  analysis: { core_argument: '논지', mandala_fit: { score: 85 } },
  segments: [{ title: '도입', from: 0, to: 60, relevance_pct: 72 }],
};

beforeEach(() => jest.clearAllMocks());

describe('① ko 만다라 + 영어 v2 → 번역 저장', () => {
  it('translates, verifies shape, stores into translations jsonb under "ko"', async () => {
    const gen = jest.fn().mockResolvedValue(JSON.stringify(koTranslated));
    const out = await translateAndStore({
      videoId: 'vid01',
      targetLang: 'ko',
      payload,
      translations: null,
      generateImpl: gen,
    });
    expect(out?.one_liner).toBe('클로드로 프로덕션 앱 만들기');
    const saved = updateMock.mock.calls[0]![0].data.translations;
    expect(getStoredTranslation(saved, 'ko')?.one_liner).toBe('클로드로 프로덕션 앱 만들기');
  });
});

describe('② en 만다라 + 영어 v2 → 원본 (분기 미발동 계약)', () => {
  it('the route guard is lang !== source_language — equal languages never reach translate; getStoredTranslation on empty is null', () => {
    // 라우트 분기 조건의 양쪽 절반을 핀: 저장 없음 → null (원본 서빙)
    expect(getStoredTranslation(null, 'en')).toBeNull();
    expect(translationFailureCount(null, 'en')).toBe(0);
  });
});

describe('③ 번역 실패 → 원어 폴백 + 실패 캡', () => {
  it('LLM failure returns null and records _failures.n', async () => {
    const gen = jest.fn().mockRejectedValue(new Error('503'));
    const out = await translateAndStore({
      videoId: 'vid01',
      targetLang: 'ko',
      payload,
      translations: null,
      generateImpl: gen,
    });
    expect(out).toBeNull();
    const saved = updateMock.mock.calls[0]![0].data.translations;
    expect(translationFailureCount(saved, 'ko')).toBe(1);
  });

  it(`at the cap (${MAX_TRANSLATE_FAILURES}) the LLM is NOT called at all — original pinned`, async () => {
    const gen = jest.fn();
    const out = await translateAndStore({
      videoId: 'vid01',
      targetLang: 'ko',
      payload,
      translations: { _failures: { ko: { n: MAX_TRANSLATE_FAILURES, last_at: 'x' } } },
      generateImpl: gen,
    });
    expect(out).toBeNull();
    expect(gen).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled(); // no per-view re-fire writes
  });
});

describe('④ 구조 보존 strict (#896 계열)', () => {
  it('key mismatch / array length change / NUMBER drift → fail (null)', async () => {
    const missingKey = { ...koTranslated, core: { tl_dr: '요약' } }; // key_points dropped
    const lenChange = { ...koTranslated, segments: [] };
    const numDrift = {
      ...koTranslated,
      segments: [{ title: '도입', from: 0, to: 61, relevance_pct: 72 }],
    };
    for (const bad of [missingKey, lenChange, numDrift]) {
      const gen = jest.fn().mockResolvedValue(JSON.stringify(bad));
      expect(await translateRichSummaryPayload(payload, 'ko', { generateImpl: gen })).toBeNull();
    }
  });

  it('fenced output still parses (proven parser mirror) and good shape passes', async () => {
    const gen = jest.fn().mockResolvedValue('```json\n' + JSON.stringify(koTranslated) + '\n```');
    const out = await translateRichSummaryPayload(payload, 'ko', { generateImpl: gen });
    expect(out?.one_liner).toBe('클로드로 프로덕션 앱 만들기');
  });

  it('sameShape primitives: strings free, numbers/booleans byte-equal', () => {
    expect(sameShape({ a: 'x', n: 1 }, { a: 'y', n: 1 })).toBe(true);
    expect(sameShape({ n: 1 }, { n: 2 })).toBe(false);
    expect(parseTranslateResponse('garbage')).toBeNull();
  });
});
