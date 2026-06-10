/**
 * CP499+ EN-ONLY search ('영문 카드 포함' — James final re-correction).
 *
 * Intent: the English action fetches ENGLISH CARDS ONLY — not a ko+en mix
 * (mixing measured: KO crowds EN out; floor/mix binning removed). ON ⇒ the
 * ko cell queries are translated and REPLACE the live set: no KO pass, no
 * competition, quota-NEUTRAL (same N search.list calls). Translation failure
 * ⇒ fall back to the normal ko run (results over nothing). Empty/low-cell
 * priority is unchanged (binByCells round-robin over per-cell buckets).
 *
 * Pins: replace-mode fire (ko queries NOT searched) / EN params (rl=en,
 * KR region) / hangul titles dropped from results / cellIndex preserved /
 * OFF bit-identical / translation-null ko fallback.
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
import { parseEnTranslateResponse } from '@/skills/plugins/video-discover/v5/en-query-translate';

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
    { query: '바이브 코딩 심화', source: 'subgoal', cellIndex: 1 },
  ]);
});

describe('translate fail-open (real impl)', () => {
  it('parse mismatch / LLM throw / no key → null', async () => {
    const targets = [{ cellIndex: 1, query: 'q' }];
    expect(parseEnTranslateResponse('not-json', targets)).toBeNull();
    expect(parseEnTranslateResponse('{"1":"vibe coding"}', targets)?.get(1)).toBe('vibe coding');
    expect(
      await realTranslate(targets, {
        generateImpl: async () => {
          throw new Error('503');
        },
      })
    ).toBeNull();
    expect(await realTranslate(targets, {})).toBeNull();
  });
});

describe('EN-only replace mode', () => {
  it('ON: ko queries are NOT searched — EN queries replace them (quota-neutral), rl=en + KR region', async () => {
    translateQueriesToEn.mockResolvedValue(
      new Map([
        [0, 'vibe coding basics'],
        [1, 'vibe coding advanced'],
      ])
    );
    searchVideos.mockImplementation(({ query }: { query: string }) =>
      Promise.resolve(
        query === 'vibe coding basics'
          ? [item('en-0', 'Vibe Coding Basics'), item('ko-x', '한국어 섞임 영상')]
          : [item('en-1', 'Advanced Vibe Coding')]
      )
    );

    const res = await runYouTubeFanout({ ...baseInput, includeEnCards: true });

    // exactly 2 searches — the EN ones; quota neutral
    expect(searchVideos).toHaveBeenCalledTimes(2);
    const queries = searchVideos.mock.calls.map(
      (c: unknown[]) => (c[0] as { query: string }).query
    );
    expect(queries.sort()).toEqual(['vibe coding advanced', 'vibe coding basics']);
    for (const c of searchVideos.mock.calls) {
      expect(c[0].relevanceLanguage).toBe('en');
      expect(c[0].regionCode).toBe('KR');
    }
    expect(res.quotaUnitsApprox).toBe(200);

    // English-only result set: the hangul title is dropped
    const ids = res.candidates.map((c) => c.videoId).sort();
    expect(ids).toEqual(['en-0', 'en-1']);
    expect(res.offLangDropped).toBe(1);

    // cellIndex preserved through translation
    expect(res.candidates.find((c) => c.videoId === 'en-0')?.cellIndex).toBe(0);
    expect(res.candidates.find((c) => c.videoId === 'en-1')?.cellIndex).toBe(1);

    expect(res.enPass).toMatchObject({
      fired: true,
      translated: true,
      cellsFired: [0, 1],
      queriesFired: 2,
      candidatesAdded: 2,
    });
    expect(res.perQuery.every((q) => q.source === 'en_only')).toBe(true);
  });

  it('OFF: bit-identical normal ko run — no translate call', async () => {
    searchVideos.mockResolvedValue([item('ko-1', '한국어 영상')]);
    const res = await runYouTubeFanout({ ...baseInput, includeEnCards: false });
    expect(translateQueriesToEn).not.toHaveBeenCalled();
    expect(searchVideos).toHaveBeenCalledTimes(2);
    expect(searchVideos.mock.calls[0][0].relevanceLanguage).toBe('ko');
    expect(res.enPass.fired).toBe(false);
    expect(res.candidates.map((c) => c.videoId)).toContain('ko-1');
  });

  it('translation null: falls back to the normal ko run (results over nothing)', async () => {
    translateQueriesToEn.mockResolvedValue(null);
    searchVideos.mockResolvedValue([item('ko-1', '한국어 영상')]);
    const res = await runYouTubeFanout({ ...baseInput, includeEnCards: true });
    const queries = searchVideos.mock.calls.map(
      (c: unknown[]) => (c[0] as { query: string }).query
    );
    expect(queries).toEqual(['바이브 코딩 기초', '바이브 코딩 심화']); // ko queries ran
    expect(res.enPass).toMatchObject({ fired: false, translated: false });
    expect(res.candidates.map((c) => c.videoId)).toContain('ko-1'); // user still gets cards
  });

  it('en mandala: toggle is a no-op (en path unchanged)', async () => {
    searchVideos.mockResolvedValue([item('en-a', 'English Video')]);
    const res = await runYouTubeFanout({ ...baseInput, language: 'en', includeEnCards: true });
    expect(translateQueriesToEn).not.toHaveBeenCalled();
    expect(searchVideos.mock.calls[0][0].relevanceLanguage).toBe('en');
    expect(res.enPass.fired).toBe(false);
  });
});
