/**
 * CP499+ EN query pass — fire/assign separation (James re-correction).
 *
 * FIRE: toggle ON ⇒ EVERY searched cell gets its EN query (unconditional —
 * the toggle is an explicit user request for English). No weak-cell gate.
 * ASSIGN: EN supplements, never displaces — per-cell buckets keep insertion
 * order (KO first, EN appended) and binByCells round-robins by rank, so
 * KO-poor cells reach EN at shallow ranks while KO-rich cells keep KO ahead.
 *
 * Pins: fire-all / EN params (KR + no relevanceLanguage) / cell-preserved
 * merge / OFF bit-identical / translate fail-open skip / binByCells
 * assignment invariants (KO-before-EN in a rich cell; EN early in a poor cell).
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
import { binByCells } from '@/skills/plugins/video-discover/v5/executor';
import { parseEnTranslateResponse } from '@/skills/plugins/video-discover/v5/en-query-translate';
import type { FanoutCandidate } from '@/skills/plugins/video-discover/v5/youtube-fanout';

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

describe('fanout EN pass — FIRE is unconditional on the toggle', () => {
  it('ko+ON: EVERY cell is translated + fired, even KO-rich ones (no weak gate)', async () => {
    // BOTH cells rich (30 raw each) — pre-correction code would fire nothing.
    searchVideos.mockImplementation(({ query }: { query: string }) =>
      Promise.resolve(
        query === 'vibe coding basics'
          ? [item('en-0', 'Vibe Coding Basics in English')]
          : query === 'vibe coding advanced'
            ? [item('en-1', 'Advanced Vibe Coding Guide')]
            : koItems(30, query.includes('기초') ? 'rich0' : 'rich1')
      )
    );
    translateQueriesToEn.mockResolvedValue(
      new Map([
        [0, 'vibe coding basics'],
        [1, 'vibe coding advanced'],
      ])
    );

    const res = await runYouTubeFanout({ ...baseInput, includeEnCards: true });

    expect(translateQueriesToEn).toHaveBeenCalledTimes(1);
    expect(translateQueriesToEn.mock.calls[0][0]).toEqual([
      { cellIndex: 0, query: '바이브 코딩 기초' },
      { cellIndex: 1, query: '바이브 코딩 심화' },
    ]);

    // 2 ko + 2 EN calls; EN calls carry KR region and NO relevanceLanguage
    expect(searchVideos).toHaveBeenCalledTimes(4);
    for (const call of searchVideos.mock.calls.slice(2)) {
      expect(call[0].regionCode).toBe('KR');
      expect(call[0].relevanceLanguage).toBeUndefined();
    }

    expect(res.enPass).toMatchObject({
      fired: true,
      translated: true,
      cellsFired: [0, 1],
      queriesFired: 2,
      candidatesAdded: 2,
    });
    expect(res.candidates.find((c) => c.videoId === 'en-0')?.cellIndex).toBe(0);
    expect(res.candidates.find((c) => c.videoId === 'en-1')?.cellIndex).toBe(1);
    expect(res.quotaUnitsApprox).toBe((2 + 2) * 100);
  });

  it('ko+OFF: single pass bit-identical — no translate, no extra search', async () => {
    searchVideos.mockResolvedValue(koItems(2, 'q'));
    const res = await runYouTubeFanout({ ...baseInput, includeEnCards: false });
    expect(translateQueriesToEn).not.toHaveBeenCalled();
    expect(searchVideos).toHaveBeenCalledTimes(2);
    expect(res.enPass.fired).toBe(false);
    expect(res.quotaUnitsApprox).toBe(200);
  });

  it('translation null (fail-open): EN pass skipped, ko results untouched', async () => {
    searchVideos.mockResolvedValue(koItems(3, 'q'));
    translateQueriesToEn.mockResolvedValue(null);
    const res = await runYouTubeFanout({ ...baseInput, includeEnCards: true });
    expect(res.enPass).toMatchObject({ fired: false, translated: false, cellsFired: [0, 1] });
    expect(searchVideos).toHaveBeenCalledTimes(2);
  });
});

describe('binByCells ASSIGN — EN supplements, never displaces (James spec 2)', () => {
  const cand = (videoId: string, cellIndex: number): FanoutCandidate => ({
    videoId,
    title: videoId,
    description: '',
    channelTitle: '',
    channelId: '',
    publishedAt: '',
    thumbnailUrl: '',
    cellIndex,
    fromEnPass: videoId.startsWith('en'),
  });

  it('KO-rich cell keeps KO ahead of EN; KO-poor cell receives EN at shallow rank', () => {
    // cell 0: 4 KO then 1 EN appended; cell 1: 1 KO then 1 EN appended.
    const survivors = [
      cand('ko0-a', 0),
      cand('ko0-b', 0),
      cand('ko0-c', 0),
      cand('ko0-d', 0),
      cand('ko1-a', 1),
      cand('en0-x', 0),
      cand('en1-x', 1),
    ];
    // floor=0 (OFF / pre-floor): tight budget drops the rich cell's EN.
    const noFloor = binByCells(survivors, 8, 1, 0).map((p) => p.videoId);
    expect(noFloor).not.toContain('en0-x');
    expect(noFloor).toContain('en1-x');

    // ★ floor=2 (toggle fired): the rich cell now SURFACES its EN inside the
    // slice (criterion ③ — "toggle ON = English visible" even in KO-rich
    // cells) while KO keeps the slice front (only the reserved tail yields).
    const floored = binByCells(survivors, 8, 1, 2).map((p) => p.videoId);
    expect(floored).toContain('en0-x');
    expect(floored.indexOf('en0-x')).toBeGreaterThan(floored.indexOf('ko0-c')); // KO front intact
    expect(floored).toContain('en1-x');
    expect(floored.indexOf('en1-x')).toBeGreaterThan(floored.indexOf('ko1-a'));
  });

  it('floor gives unused EN slots back to KO (cell with no EN unchanged)', () => {
    const survivors = [cand('ko-a', 0), cand('ko-b', 0), cand('ko-c', 0), cand('ko-d', 0)];
    const out = binByCells(survivors, 4, 1, 2).map((p) => p.videoId);
    expect(out).toEqual(['ko-a', 'ko-b', 'ko-c', 'ko-d']);
  });
});
