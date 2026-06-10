/**
 * CP499+ EN query pass — weak-cell-only (James-approved design (B)).
 *
 * Pins:
 *   - weak-cell math (raw < threshold; failed queries count 0)
 *   - translate fail-open (no key / LLM throw / parse mismatch → null)
 *   - fanout integration: ONLY weak cells get translated+fired; EN calls
 *     carry regionCode KR and NO relevanceLanguage; results merge with the
 *     cell's index through the same gates; OFF = single pass bit-identical;
 *     translation-null = EN pass skipped, ko results untouched.
 */

jest.mock('@/skills/plugins/video-discover/v2/youtube-client', () => ({
  searchVideos: jest.fn(),
  resolveSearchApiKeys: jest.fn().mockReturnValue(['key1']),
  titleIndicatesShorts: jest.fn().mockReturnValue(false),
  titleHitsBlocklist: jest.fn().mockReturnValue(false),
}));
jest.mock('@/skills/plugins/video-discover/v2/keyword-builder', () => ({
  buildRuleBasedQueriesSync: jest.fn(),
}));
jest.mock('@/skills/plugins/video-discover/v5/en-query-translate', () => {
  const actual = jest.requireActual('@/skills/plugins/video-discover/v5/en-query-translate');
  return { ...actual, translateQueriesToEn: jest.fn() };
});
jest.mock('@/utils/logger', () => {
  const base: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };
  base['child'] = jest.fn(() => base);
  return { logger: base };
});

const { searchVideos } = jest.requireMock('@/skills/plugins/video-discover/v2/youtube-client');
const { buildRuleBasedQueriesSync } = jest.requireMock(
  '@/skills/plugins/video-discover/v2/keyword-builder'
);
const { translateQueriesToEn } = jest.requireMock(
  '@/skills/plugins/video-discover/v5/en-query-translate'
);

import { runYouTubeFanout } from '@/skills/plugins/video-discover/v5/youtube-fanout';
import {
  computeWeakCells,
  parseEnTranslateResponse,
} from '@/skills/plugins/video-discover/v5/en-query-translate';

// The module is mocked above for the fanout integration; pull the REAL
// translate impl for the fail-open unit tests.
const { translateQueriesToEn: realTranslate } = jest.requireActual(
  '@/skills/plugins/video-discover/v5/en-query-translate'
);
import { resetV5ConfigForTest } from '@/skills/plugins/video-discover/v5/config';

const item = (id: string, title: string) => ({
  id: { videoId: id },
  snippet: {
    title,
    channelTitle: 'ch',
    channelId: 'cid',
    publishedAt: '2026-01-01T00:00:00Z',
    thumbnails: { high: { url: 'u' } },
  },
});
const koItems = (n: number, p: string) =>
  Array.from({ length: n }, (_, i) => item(`${p}-${i}`, `한국어 영상 ${p} ${i}`));

const baseInput = {
  centerGoal: '바이브 코딩',
  subGoals: ['기초', '심화'],
  focusTags: [],
  targetLevel: 'standard',
  language: 'ko' as const,
  env: { OPENROUTER_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv,
};

beforeEach(() => {
  jest.clearAllMocks();
  resetV5ConfigForTest();
  buildRuleBasedQueriesSync.mockReturnValue([
    { query: '바이브 코딩 기초', source: 'subgoal', cellIndex: 0 },
    { query: '바이브 코딩 심화 희귀주제', source: 'subgoal', cellIndex: 1 },
  ]);
});

describe('computeWeakCells (pure)', () => {
  it('selects cells strictly below the threshold; failed/0-raw cells included', () => {
    const m = new Map([
      [0, 30],
      [1, 7],
      [2, 0],
      [3, 8],
    ]);
    expect(computeWeakCells(m, 8)).toEqual([1, 2]); // 8 itself is NOT weak
  });
});

describe('translate fail-open (real impl)', () => {
  it('parse mismatch / missing key / empty value → null', () => {
    const targets = [{ cellIndex: 1, query: 'q' }];
    expect(parseEnTranslateResponse('not-json', targets)).toBeNull();
    expect(parseEnTranslateResponse('{"9":"x"}', targets)).toBeNull();
    expect(parseEnTranslateResponse('{"1":""}', targets)).toBeNull();
    expect(parseEnTranslateResponse('{"1":"vibe coding basics"}', targets)?.get(1)).toBe(
      'vibe coding basics'
    );
  });

  it('LLM throw → null (caller skips EN pass)', async () => {
    const out = await realTranslate([{ cellIndex: 1, query: 'q' }], {
      generateImpl: async () => {
        throw new Error('503');
      },
    });
    expect(out).toBeNull();
  });

  it('no key and no impl → null', async () => {
    expect(await realTranslate([{ cellIndex: 1, query: 'q' }], {})).toBeNull();
  });
});

describe('fanout EN pass integration', () => {
  it('ko+ON: only the weak cell is translated + fired (KR region, NO relevanceLanguage), results merge into its cell', async () => {
    // cell0 rich (30 raw), cell1 weak (0 raw)
    searchVideos.mockImplementation(({ query }: { query: string }) =>
      Promise.resolve(
        query.startsWith('바이브 코딩 기초')
          ? koItems(30, 'rich')
          : query === 'vibe coding advanced rare topic'
            ? [item('en-1', 'Vibe Coding Advanced Rare Topic Guide')]
            : []
      )
    );
    translateQueriesToEn.mockResolvedValue(new Map([[1, 'vibe coding advanced rare topic']]));

    const res = await runYouTubeFanout({ ...baseInput, includeEnCards: true });

    // translate got ONLY the weak cell's query
    expect(translateQueriesToEn).toHaveBeenCalledTimes(1);
    expect(translateQueriesToEn.mock.calls[0][0]).toEqual([
      { cellIndex: 1, query: '바이브 코딩 심화 희귀주제' },
    ]);

    // 2 ko calls + 1 EN call; the EN call = KR region, relevanceLanguage absent
    expect(searchVideos).toHaveBeenCalledTimes(3);
    const enCall = searchVideos.mock.calls[2][0];
    expect(enCall.query).toBe('vibe coding advanced rare topic');
    expect(enCall.regionCode).toBe('KR');
    expect(enCall.relevanceLanguage).toBeUndefined();

    // EN candidate merged with the weak cell's index
    const en = res.candidates.find((c) => c.videoId === 'en-1');
    expect(en?.cellIndex).toBe(1);

    expect(res.enPass).toMatchObject({
      fired: true,
      translated: true,
      weakCells: [1],
      queriesFired: 1,
      candidatesAdded: 1,
    });
    // quota counts the EN pass (+100u per fired query)
    expect(res.quotaUnitsApprox).toBe((2 + 1) * 100);
    // perQuery carries the EN entry
    expect(res.perQuery.find((q) => q.source === 'en_pass')?.cellIndex).toBe(1);
  });

  it('ko+OFF: single pass — translate never called, no extra search', async () => {
    searchVideos.mockResolvedValue(koItems(2, 'q'));
    const res = await runYouTubeFanout({ ...baseInput, includeEnCards: false });
    expect(translateQueriesToEn).not.toHaveBeenCalled();
    expect(searchVideos).toHaveBeenCalledTimes(2);
    expect(res.enPass.fired).toBe(false);
    expect(res.quotaUnitsApprox).toBe(200);
  });

  it('translation null (fail-open): EN pass skipped, ko results untouched', async () => {
    searchVideos.mockResolvedValue([]); // every cell weak
    translateQueriesToEn.mockResolvedValue(null);
    const res = await runYouTubeFanout({ ...baseInput, includeEnCards: true });
    expect(res.enPass).toMatchObject({ fired: false, translated: false });
    expect(res.enPass.weakCells).toEqual([0, 1]);
    expect(searchVideos).toHaveBeenCalledTimes(2); // no second pass
  });
});
