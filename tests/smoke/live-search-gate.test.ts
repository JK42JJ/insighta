/**
 * D-01 live-search exposure gate — partition/cache/demotion contract.
 * Floor-incident lessons under test: scoring failure DEMOTES (never hides),
 * tail past top-N is demoted unscored, audio mismatch hides (null passes).
 */

const mockFindMany = jest.fn();
const mockExecuteRaw = jest.fn();
const mockCompute = jest.fn();

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    video_mandala_relevance: { findMany: mockFindMany },
    $executeRaw: (...args: unknown[]) => mockExecuteRaw(...args),
  }),
}));
jest.mock('@/modules/relevance/compute-card-relevance', () => ({
  computeCardRelevance: (...args: unknown[]) => mockCompute(...args),
}));
jest.mock('@/config/relevance-rubric', () => ({
  loadRelevanceRubricConfig: () => ({ enabled: false }),
}));

import {
  gateLiveSearchCards,
  audioLanguageMismatch,
  promoPenaltyMatch,
} from '../../src/modules/inflow-gate/live-search-gate';

const CFG = { mode: 'on' as const, topN: 3, burst: 3, relevanceMin: 60 };
const CTX = {
  mandalaId: '00000000-0000-0000-0000-000000000000',
  centerGoal: '머신러닝 마스터',
  subGoals: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
  language: 'ko' as const,
  cfg: CFG,
};
const card = (id: string, audio: string | null = null) => ({
  videoId: id,
  title: `title-${id}`,
  cellIndex: 0,
  audioLanguage: audio,
});

describe('audioLanguageMismatch', () => {
  test('null passes (fail-open); en passes everywhere', () => {
    expect(audioLanguageMismatch(null, 'ko')).toBe(false);
    expect(audioLanguageMismatch('en-US', 'ko')).toBe(false);
    expect(audioLanguageMismatch('en', 'en')).toBe(false);
  });
  test('clear mismatch hides — Arabic audio on en mandala (script-invisible case)', () => {
    expect(audioLanguageMismatch('ar', 'en')).toBe(true);
    expect(audioLanguageMismatch('ko-KR', 'en')).toBe(true);
    expect(audioLanguageMismatch('th', 'ko')).toBe(true);
  });
  test('non-linguistic ISO 639 codes fail-open — zxx/und/mul/mis are not a language mismatch (T1 2026-07-03)', () => {
    // YouTube mis-tags Korean ETF videos as zxx; must not drop them.
    expect(audioLanguageMismatch('zxx', 'ko')).toBe(false);
    expect(audioLanguageMismatch('zxx', 'en')).toBe(false);
    expect(audioLanguageMismatch('und', 'ko')).toBe(false);
    expect(audioLanguageMismatch('mul', 'ko')).toBe(false);
    expect(audioLanguageMismatch('mis', 'en')).toBe(false);
  });
  test('regression: zxx pass does NOT open determinate mismatches — ar still drops', () => {
    expect(audioLanguageMismatch('ar', 'ko')).toBe(true);
    expect(audioLanguageMismatch('ja', 'ko')).toBe(true);
    expect(audioLanguageMismatch('ja', 'en')).toBe(true);
  });
});

describe('promoPenaltyMatch (축3 commercial-bias, demote-only)', () => {
  test('flags scam-adjacent / aggro / FUD titles (before-anchor top-6: 1·4·6)', () => {
    // #1 aggro pump, #4 scam-adjacent affiliate, #6 FUD dismissal.
    expect(promoPenaltyMatch('비트코인 한 번 더 털고 갑니다 (대응 전략)', '트레이더')).toBe(
      'aggro'
    );
    expect(
      promoPenaltyMatch('[코인거래소추천] 참여시 100$ 수익률차이 만드는조건', '코인거래소')
    ).toBe('scam');
    expect(promoPenaltyMatch('이더리움? 리플? 다 쉿코인입니다. 절대 사지 마세요', '주식쟁이')).toBe(
      'fud'
    );
  });
  test('trade axis requires COMPOUND channel + title mechanics', () => {
    // "거래소 홍보맨" + 배율/청산가 → trade; channel alone or title alone → clean.
    expect(promoPenaltyMatch('레버리지 배율 설정·청산가 관리', '비트코인 거래소 홍보맨')).toBe(
      'trade'
    );
    expect(promoPenaltyMatch('비트코인 기초 개념 정리', '비트코인 거래소 홍보맨')).toBe(null);
    expect(promoPenaltyMatch('레버리지 배율 설정 강의', '정상 교육 채널')).toBe(null);
  });
  test('regression: legit content is NOT flagged (bare 수익률/사기/위험 disproved)', () => {
    // Naive word cuts學살 these — the compound/specific design must pass them.
    expect(promoPenaltyMatch('나스닥 100 ETF 적립식 투자, 개미의 마지막 무기', '토스')).toBe(null);
    expect(promoPenaltyMatch('신용카드 사기 검출 실습: 분류 평가 지표', '박홍규')).toBe(null);
    expect(promoPenaltyMatch('위험자산 ETF 운용 전략', '우리투자증권')).toBe(null);
    expect(promoPenaltyMatch('클라우드 서버 조심히 써야하는 이유', '조코딩 JoCoding')).toBe(null);
    expect(promoPenaltyMatch(null, null)).toBe(null);
  });
});

describe('gateLiveSearchCards', () => {
  beforeEach(() => {
    mockFindMany.mockReset().mockResolvedValue([]);
    mockExecuteRaw.mockReset().mockResolvedValue(1);
    mockCompute.mockReset();
  });

  test('pass sorted by gc desc; below-min hidden; tail demoted unscored', async () => {
    mockCompute
      .mockResolvedValueOnce({ ok: true, relevancePct: 70 })
      .mockResolvedValueOnce({ ok: true, relevancePct: 40 })
      .mockResolvedValueOnce({ ok: true, relevancePct: 90 });
    const cards = [card('a'), card('b'), card('c'), card('tail1'), card('tail2')];
    const r = await gateLiveSearchCards(cards, CTX);
    expect(r.exposed.map((c) => c.videoId)).toEqual(['c', 'a', 'tail1', 'tail2']);
    expect(r.gcDropped).toBe(1);
    expect(r.demoted).toBe(2);
    expect(mockCompute).toHaveBeenCalledTimes(3);
  });

  test('scoring failure demotes, never hides (floor-incident lesson)', async () => {
    mockCompute
      .mockResolvedValueOnce({ ok: true, relevancePct: 80 })
      .mockResolvedValueOnce({ ok: false, reason: 'provider_error: timeout' })
      .mockResolvedValueOnce({ ok: true, relevancePct: 75 });
    const r = await gateLiveSearchCards([card('a'), card('b'), card('c')], CTX);
    expect(r.exposed.map((c) => c.videoId)).toEqual(['a', 'c', 'b']);
    expect(r.gcDropped).toBe(0);
  });

  test('cache hit skips scoring and costs nothing', async () => {
    mockFindMany.mockResolvedValue([
      { video_id: 'a', relevance_pct: 85, detail: null },
      { video_id: 'b', relevance_pct: 30, detail: null },
    ]);
    mockCompute.mockResolvedValueOnce({ ok: true, relevancePct: 65 });
    const r = await gateLiveSearchCards([card('a'), card('b'), card('c')], CTX);
    expect(r.cacheHits).toBe(2);
    expect(mockCompute).toHaveBeenCalledTimes(1);
    expect(r.exposed.map((c) => c.videoId)).toEqual(['a', 'c']);
    expect(r.gcDropped).toBe(1);
  });

  test('audio mismatch hides before scoring + logs the dropped item detail', async () => {
    mockCompute.mockResolvedValue({ ok: true, relevancePct: 99 });
    const r = await gateLiveSearchCards([card('a', 'ar'), card('b', 'ko')], CTX);
    expect(r.langDropped).toBe(1);
    expect(r.exposed.map((c) => c.videoId)).toEqual(['b']);
    // L2 canary blocker — dropped-item audio label logged for false-positive eyeball
    expect(r.langDroppedItems).toEqual([{ videoId: 'a', audioLang: 'ar', target: 'ko' }]);
  });
});

describe('orderByCachedGc (ON전략 A rank-demote)', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  test('orders by cached gc desc; uncached keep pick order below cached (no-flicker)', async () => {
    const { orderByCachedGc } = await import('../../src/modules/inflow-gate/live-search-gate');
    mockFindMany.mockResolvedValue([
      { video_id: 'b', relevance_pct: 90 },
      { video_id: 'a', relevance_pct: 50 },
    ]);
    const items = [card('a'), card('b'), card('c'), card('d')]; // c,d uncached
    const r = await orderByCachedGc(items, '00000000-0000-0000-0000-000000000000');
    // cached first (b90, a50) then uncached in original pick order (c, d)
    expect(r.ordered.map((x) => x.videoId)).toEqual(['b', 'a', 'c', 'd']);
    expect(r.cacheOrderedCount).toBe(2);
  });

  test('no cache = pick order preserved (first search supply-first, +0ms)', async () => {
    const { orderByCachedGc } = await import('../../src/modules/inflow-gate/live-search-gate');
    mockFindMany.mockResolvedValue([]);
    const items = [card('a'), card('b'), card('c')];
    const r = await orderByCachedGc(items, '00000000-0000-0000-0000-000000000000');
    expect(r.ordered.map((x) => x.videoId)).toEqual(['a', 'b', 'c']);
    expect(r.cacheOrderedCount).toBe(0);
  });

  test('shadow invariant: promo-penalty status does NOT change exposure order (logging-only, floor lesson)', async () => {
    // Supervisor condition 1: promo_penalty_hits is observation-only. A card
    // whose TITLE matches the promo penalty must keep its gc-based rank — the
    // shadow signal never demotes. Here a promo-titled card holds gc 90 and
    // stays #1; ordering is by gc alone, promo status ignored.
    const { orderByCachedGc } = await import('../../src/modules/inflow-gate/live-search-gate');
    const promoCard = {
      videoId: 'p',
      title: '한 번 더 털고 갑니다',
      cellIndex: 0,
      audioLanguage: null,
    };
    const cleanCard = {
      videoId: 'q',
      title: '비트코인 기초 개념',
      cellIndex: 0,
      audioLanguage: null,
    };
    mockFindMany.mockResolvedValue([
      { video_id: 'p', relevance_pct: 90 },
      { video_id: 'q', relevance_pct: 40 },
    ]);
    const r = await orderByCachedGc([cleanCard, promoCard], '00000000-0000-0000-0000-000000000000');
    // promo card (gc 90) ranks above clean card (gc 40) — penalty NOT applied.
    expect(r.ordered.map((x) => x.videoId)).toEqual(['p', 'q']);
  });

  test('cache read failure falls back to pick order (nothing hidden — floor lesson)', async () => {
    const { orderByCachedGc } = await import('../../src/modules/inflow-gate/live-search-gate');
    mockFindMany.mockRejectedValue(new Error('db down'));
    const items = [card('a'), card('b')];
    const r = await orderByCachedGc(items, '00000000-0000-0000-0000-000000000000');
    expect(r.ordered.map((x) => x.videoId)).toEqual(['a', 'b']);
  });
});
