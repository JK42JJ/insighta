/**
 * v5 fanout — CP491 F5c per-query observability.
 * Verifies perQuery records raw count + q_ok per attempted query, independent
 * of fulfillment (rejected query → rawCount 0, fulfilled false).
 */

import {
  runYouTubeFanout,
  rotateKeys,
  isOffLanguageTitle,
} from '@/skills/plugins/video-discover/v5/youtube-fanout';
import { resetV5ConfigForTest } from '@/skills/plugins/video-discover/v5/config';

jest.mock('@/skills/plugins/video-discover/v2/youtube-client', () => ({
  searchVideos: jest.fn(),
  resolveSearchApiKeys: jest.fn().mockReturnValue(['key1']),
  titleIndicatesShorts: jest.fn().mockReturnValue(false),
  titleHitsBlocklist: jest.fn().mockReturnValue(false),
}));

jest.mock('@/skills/plugins/video-discover/v2/keyword-builder', () => ({
  buildRuleBasedQueriesSync: jest.fn(),
}));

const { searchVideos } = jest.requireMock('@/skills/plugins/video-discover/v2/youtube-client');
const { buildRuleBasedQueriesSync } = jest.requireMock(
  '@/skills/plugins/video-discover/v2/keyword-builder'
);

function items(n: number, prefix: string) {
  return Array.from({ length: n }, (_, i) => ({
    id: { videoId: `${prefix}_${i}` },
    snippet: {
      title: `T${prefix}${i}`,
      description: 'd',
      channelTitle: 'c',
      channelId: 'ch',
      publishedAt: '2026-01-01T00:00:00Z',
      thumbnails: { high: { url: 'u' } },
    },
  }));
}

describe('runYouTubeFanout — F5c perQuery', () => {
  beforeEach(() => {
    resetV5ConfigForTest();
    searchVideos.mockReset();
    buildRuleBasedQueriesSync.mockReset();
  });

  test('perQuery records raw count + q_ok per query, including rejected', async () => {
    buildRuleBasedQueriesSync.mockReturnValue([
      { query: 'q0', source: 'core', cellIndex: null },
      { query: 'q1', source: 'subgoal', cellIndex: 1 },
      { query: 'q2', source: 'subgoal', cellIndex: 2 },
    ]);
    searchVideos.mockImplementation(({ query }: { query: string }) => {
      if (query === 'q1') return Promise.reject(new Error('quota'));
      return Promise.resolve(items(query === 'q0' ? 5 : 3, query));
    });

    const res = await runYouTubeFanout({
      centerGoal: 'goal',
      subGoals: [],
      focusTags: [],
      targetLevel: 'standard',
      language: 'en',
      env: {} as NodeJS.ProcessEnv,
    });

    expect(res.perQuery).toHaveLength(3);
    expect(res.perQuery[0]).toEqual({
      query: 'q0',
      source: 'core',
      cellIndex: null,
      rawCount: 5,
      fulfilled: true,
    });
    expect(res.perQuery[1]).toEqual({
      query: 'q1',
      source: 'subgoal',
      cellIndex: 1,
      rawCount: 0,
      fulfilled: false,
    });
    expect(res.perQuery[2]).toMatchObject({ query: 'q2', rawCount: 3, fulfilled: true });
    expect(res.queriesSucceeded).toBe(2);
    expect(res.candidates).toHaveLength(8); // 5 + 3, all unique
  });

  test("CP499+ '영문 카드 포함' EN-only: ON without translation (no key) falls back to the ko run; OFF keeps 'ko'", async () => {
    // No OPENROUTER_API_KEY in env → translateQueriesToEn fail-opens to null
    // → the run falls back to the normal ko pass (relevanceLanguage 'ko').
    // The EN-only success path (rl='en', replace-mode) is pinned in
    // v5-en-pass.test.ts.
    buildRuleBasedQueriesSync.mockReturnValue([{ query: 'q0', source: 'core', cellIndex: null }]);
    searchVideos.mockResolvedValue(items(2, 'q'));
    const base = {
      centerGoal: 'goal',
      subGoals: [],
      focusTags: [],
      targetLevel: 'standard',
      language: 'ko' as const,
      env: {} as NodeJS.ProcessEnv,
    };

    await runYouTubeFanout({ ...base, includeEnCards: true });
    for (const call of searchVideos.mock.calls) {
      expect(call[0].relevanceLanguage).toBe('ko'); // fail-open ko fallback
    }

    searchVideos.mockClear();
    searchVideos.mockResolvedValue(items(2, 'q'));
    await runYouTubeFanout({ ...base, includeEnCards: false });
    for (const call of searchVideos.mock.calls) {
      expect(call[0].relevanceLanguage).toBe('ko'); // OFF = current behaviour
    }
  });

  test('ROI1: forwards publishedAfter to every searchVideos call', async () => {
    buildRuleBasedQueriesSync.mockReturnValue([
      { query: 'q0', source: 'core', cellIndex: null },
      { query: 'q1', source: 'subgoal', cellIndex: 1 },
    ]);
    searchVideos.mockResolvedValue(items(2, 'q'));
    const iso = '2025-06-01T00:00:00.000Z';
    await runYouTubeFanout({
      centerGoal: 'goal',
      subGoals: [],
      focusTags: [],
      targetLevel: 'standard',
      language: 'en',
      env: {} as NodeJS.ProcessEnv,
      publishedAfter: iso,
    });
    expect(searchVideos).toHaveBeenCalled();
    for (const call of searchVideos.mock.calls) {
      expect(call[0]).toMatchObject({ publishedAfter: iso });
    }
  });

  test('ROI1: publishedAfter undefined when not provided (unchanged behavior)', async () => {
    buildRuleBasedQueriesSync.mockReturnValue([{ query: 'q0', source: 'core', cellIndex: null }]);
    searchVideos.mockResolvedValue(items(2, 'q'));
    await runYouTubeFanout({
      centerGoal: 'goal',
      subGoals: [],
      focusTags: [],
      targetLevel: 'standard',
      language: 'en',
      env: {} as NodeJS.ProcessEnv,
    });
    expect(searchVideos.mock.calls[0]![0].publishedAfter).toBeUndefined();
  });
});

/**
 * CP493 — merged-gen precomputedQueries. When the wizard's merged structure+
 * queries call produced full per-cell coverage, fanout must use those queries
 * verbatim and SKIP its own query-gen (preserving goal-context continuity).
 */
describe('runYouTubeFanout — CP493 precomputedQueries (merged-gen)', () => {
  beforeEach(() => {
    resetV5ConfigForTest();
    searchVideos.mockReset();
    buildRuleBasedQueriesSync.mockReset();
  });

  test('uses precomputedQueries verbatim, skips query-gen, mode=merged', async () => {
    searchVideos.mockImplementation(({ query }: { query: string }) =>
      Promise.resolve(items(3, query))
    );
    const res = await runYouTubeFanout({
      centerGoal: 'goal',
      subGoals: ['a', 'b'],
      focusTags: [],
      targetLevel: 'standard',
      language: 'en',
      env: {} as NodeJS.ProcessEnv,
      precomputedQueries: [
        { cellIndex: 0, query: 'merged q0' },
        { cellIndex: 1, query: 'merged q1' },
      ],
    });
    // query-gen must NOT be invoked when precomputed queries are supplied.
    expect(buildRuleBasedQueriesSync).not.toHaveBeenCalled();
    const searched = searchVideos.mock.calls.map(
      (c: unknown[]) => (c[0] as { query: string }).query
    );
    expect(searched.sort()).toEqual(['merged q0', 'merged q1']);
    expect(res.queryGen.mode).toBe('merged');
    expect(res.queryGen.llmCells).toBe(2);
    expect(res.queryGen.fellBack).toBe(false);
    expect(res.perQuery.map((p) => p.source)).toEqual(['merged', 'merged']);
    expect(res.perQuery.map((p) => p.cellIndex)).toEqual([0, 1]);
  });

  test('empty precomputedQueries → falls through to rule query-gen (unchanged)', async () => {
    buildRuleBasedQueriesSync.mockReturnValue([{ query: 'rq', source: 'core', cellIndex: null }]);
    searchVideos.mockResolvedValue(items(2, 'rq'));
    const res = await runYouTubeFanout({
      centerGoal: 'goal',
      subGoals: ['a'],
      focusTags: [],
      targetLevel: 'standard',
      language: 'en',
      env: {} as NodeJS.ProcessEnv,
      precomputedQueries: [],
    });
    expect(buildRuleBasedQueriesSync).toHaveBeenCalled();
    expect(res.queryGen.mode).toBe('rule');
  });
});

/**
 * CP492 — per-query key rotation. All N parallel queries previously shared the
 * same key array → every query hit keys[0] first → YouTube 429 rateLimitExceeded
 * cascade (0 results under burst, ~50% supply loss normally). rotateKeys spreads
 * the primary key across queries while keeping failover order.
 */
describe('rotateKeys', () => {
  const keys = ['k0', 'k1', 'k2', 'k3'];

  test('query 0 starts at k0 (unchanged order)', () => {
    expect(rotateKeys(keys, 0)).toEqual(['k0', 'k1', 'k2', 'k3']);
  });

  test('query i starts at keys[i] with the rest as failover', () => {
    expect(rotateKeys(keys, 1)).toEqual(['k1', 'k2', 'k3', 'k0']);
    expect(rotateKeys(keys, 2)).toEqual(['k2', 'k3', 'k0', 'k1']);
    expect(rotateKeys(keys, 3)).toEqual(['k3', 'k0', 'k1', 'k2']);
  });

  test('wraps when i >= keyCount (more queries than keys)', () => {
    expect(rotateKeys(keys, 4)).toEqual(rotateKeys(keys, 0)); // 4 % 4 = 0
    expect(rotateKeys(keys, 5)).toEqual(rotateKeys(keys, 1));
  });

  test('N distinct queries get N distinct primary keys (no pile-up on keys[0])', () => {
    const primaries = Array.from({ length: keys.length }, (_, i) => rotateKeys(keys, i)[0]);
    expect(new Set(primaries).size).toBe(keys.length); // all distinct
  });

  test('every rotation is a permutation (failover still covers all keys)', () => {
    for (let i = 0; i < keys.length; i += 1) {
      expect([...rotateKeys(keys, i)].sort()).toEqual([...keys].sort());
    }
  });

  test('0/1-key inputs returned unchanged (no rotation possible)', () => {
    expect(rotateKeys([], 3)).toEqual([]);
    expect(rotateKeys(['only'], 3)).toEqual(['only']);
  });
});

/**
 * CP492 — off-language hard drop. YouTube backfilled sparse Korean queries with
 * high-view Chinese dramas. Must drop CLEAR off-language titles only (no false
 * positives on English-titled or Hanja-mixed Korean content).
 */
describe('isOffLanguageTitle (CP492)', () => {
  test('ko: drops Chinese-drama titles (no Hangul + Han-dominant)', () => {
    expect(isOffLanguageTitle('【MULTISUB】《彩礼加倍？反手向新娘闺蜜求婚》', 'ko')).toBe(true);
    expect(isOffLanguageTitle('重生换嫁，长命百岁了', 'ko')).toBe(true);
    expect(isOffLanguageTitle('仙武狂婿都市无敌', 'ko')).toBe(true);
  });

  test('ko: KEEPS English-titled Korean content (no Han)', () => {
    expect(isOffLanguageTitle('[Team Drill] Run & Chase Drill (레이업 훈련)', 'ko')).toBe(false);
    expect(isOffLanguageTitle('농구 훈련 4인 pass cut meet out 연습', 'ko')).toBe(false);
    expect(isOffLanguageTitle('Basketball Shooting Form Drills', 'ko')).toBe(false);
  });

  test('ko: KEEPS Hanja-mixed Korean (Hangul present)', () => {
    expect(isOffLanguageTitle('농구 戰術 훈련법', 'ko')).toBe(false);
    expect(isOffLanguageTitle('통일 농구 방북단', 'ko')).toBe(false);
  });

  test('conservative: a single Han char is never dropped', () => {
    expect(isOffLanguageTitle('球 basketball', 'ko')).toBe(false); // han=1 < 2
  });

  test('en: drops CJK-dominant titles (no Latin + Han)', () => {
    expect(isOffLanguageTitle('彩礼加倍反手向新娘', 'en')).toBe(true);
  });

  test('en: KEEPS Latin titles even with stray Han', () => {
    expect(isOffLanguageTitle('Kung Fu 功夫 basics', 'en')).toBe(false); // latin present
  });

  // CP492 2차 gate — T1 (non-Latin foreign scripts) + T2 (Turkish diacritics).
  test('ko T1: drops Arabic / Thai / Cyrillic / Devanagari / Hebrew (no Hangul)', () => {
    expect(isOffLanguageTitle('استرجع شغفك في الحياة', 'ko')).toBe(true); // Arabic
    expect(isOffLanguageTitle('วิธีเรียนรู้ทักษะใหม่อย่างรวดเร็ว', 'ko')).toBe(true); // Thai
    expect(isOffLanguageTitle('Как быстро выучить навык', 'ko')).toBe(true); // Cyrillic
    expect(isOffLanguageTitle('कौशल कैसे सीखें', 'ko')).toBe(true); // Devanagari
  });

  test('ko T2: drops Turkish (Latin-based) via ≥2 Turkish diacritics', () => {
    // Real leaked title — mostly Latin, but Çıktı/İndirimler carry ç/ı/İ.
    expect(
      isOffLanguageTitle('Star Atlas Town Hall - C4 PTR Çıktı, UE5 ve Dev İndirimler!', 'ko')
    ).toBe(true);
  });

  test('ko: KEEPS off-topic ENGLISH (Track 3, not a language drop)', () => {
    // Off-topic but valid English → kept here; topic relevance is Track 3.
    expect(isOffLanguageTitle("Inside SpaceX's Flywheel: What Tesla Investors Missed", 'ko')).toBe(
      false
    );
    expect(isOffLanguageTitle('Part 5 How Influencer Helped Rebuild After Disaster', 'ko')).toBe(
      false
    );
  });

  test('ko T2 conservative: a single stray Turkish diacritic is NOT dropped', () => {
    // façade-style loanword (one ç) must not false-drop English.
    expect(isOffLanguageTitle('The façade of productivity', 'ko')).toBe(false); // turkish=1 < 2
  });
});
