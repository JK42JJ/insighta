/**
 * Observability Phase 1 (STEP 3) — hermetic integration test for the v5
 * add-cards emission path (stages A fanout + B executor). Runs the REAL
 * runV5Executor in cell_binning mode (no LLM, no OpenRouter) with a fully
 * mocked YouTube fetch, so it is deterministic and offline.
 *
 * Proves two things and stays as a permanent regression guard:
 *   1. traceCandidates reconstruct A (fanout off_lang drop) + B (PLACED /
 *      not_picked) from a real executor run, with live-sync gc/cosine null.
 *   2. The observation is decision-neutral: SEARCH_TRACE_ENABLED on vs off
 *      yields byte-identical serving cards (fixed YouTube → deterministic).
 */

let mockTraceEnabled = true;
jest.mock('@/config/index', () => ({
  get config() {
    return {
      searchTrace: {
        get enabled() {
          return mockTraceEnabled;
        },
      },
      discoverTracing: { enabled: false },
      app: { isDevelopment: false, isProduction: false, isTest: true },
      // mailer.ts creates its transporter at module scope from config.gmail —
      // the import chain reaches it, so the mock must provide the block.
      gmail: { smtpHost: 'localhost', smtpPort: 587, smtpFrom: 'test@test.local' },
    };
  },
}));
jest.mock('@/utils/logger', () => {
  const fns = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { logger: { ...fns, child: () => fns } };
});
// The cell_binning executor path touches no DB; stub the client (both entry
// points) so the module graph does not eagerly instantiate Prisma.
jest.mock('@/modules/database', () => ({ getPrismaClient: () => ({}) }));
jest.mock('@/modules/database/client', () => ({ getPrismaClient: () => ({}) }));

import { runV5Executor, type V5ExecuteInput } from '../v5/executor';

const ENV = {
  V5_PICKER_MODE: 'cell_binning',
  V5_TARGET_PICKS: '10',
  V5_DIVERSITY_GUARD: 'false',
  V5_SHORT_PROBE_DEADLINE_MS: '0',
  V5_KO_EN_TITLE_DROP: 'true',
  YOUTUBE_API_KEY_SEARCH: 'test-search-key',
  YOUTUBE_API_KEY: 'test-key',
} as unknown as NodeJS.ProcessEnv;

// 20 Korean survivors (> picker overpick, so both not_picked and
// slice_overflow appear) + 1 Chinese title (off_lang drop on a ko mandala).
const KO_TITLES = Array.from(
  { length: 20 },
  (_, i) => `쿠버네티스 실전 강좌 파트${i + 1} 완전정복 가이드`
);
const SEARCH_ITEMS = [
  ...KO_TITLES.map((title, i) => ({
    videoId: `k${i + 1}`,
    title,
    channelId: `ch${i + 1}`,
    channel: `채널${i + 1}`,
  })),
  { videoId: 'cn1', title: '完整的中文视频教程课程内容', channelId: 'chcn', channel: '中文频道' },
];

function mockFetch(): typeof fetch {
  return jest.fn(async (url: string) => {
    if (url.includes('/youtube/v3/search')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: SEARCH_ITEMS.map((it) => ({
            id: { videoId: it.videoId },
            snippet: {
              title: it.title,
              channelTitle: it.channel,
              channelId: it.channelId,
              publishedAt: '2026-04-01T00:00:00Z',
              thumbnails: { high: { url: `t-${it.videoId}` } },
            },
          })),
        }),
      };
    }
    if (url.includes('/youtube/v3/videos')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: SEARCH_ITEMS.map((it) => ({
            id: it.videoId,
            snippet: { title: it.title, channelTitle: it.channel },
            statistics: { viewCount: '50000' },
            contentDetails: { duration: 'PT10M' }, // >= 180s → no short probe
          })),
        }),
      };
    }
    throw new Error(`Unmocked URL: ${url}`);
  }) as unknown as typeof fetch;
}

function input(): V5ExecuteInput {
  return {
    centerGoal: '쿠버네티스 전문가 되기',
    subGoals: ['입문', '배포', '네트워킹', '스토리지', '보안', '운영', '모니터링', '트러블슈팅'],
    focusTags: [],
    targetLevel: 'standard',
    language: 'ko',
    excludeVideoIds: new Set<string>(),
    env: ENV,
  };
}

describe('v5 executor search-trace emission (hermetic, cell_binning)', () => {
  beforeEach(() => {
    global.fetch = mockFetch();
  });

  it('reconstructs A+B journey with live-sync gc/cosine null', async () => {
    mockTraceEnabled = true;
    const res = await runV5Executor(input());

    expect(res.diagnostics.traceCandidates).toBeDefined();
    const tc = res.diagnostics.traceCandidates!;
    const byId = Object.fromEntries(tc.map((c) => [c.videoId, c]));

    // A — fanout off-language drop.
    expect(byId['cn1']).toMatchObject({
      decision: 'DROPPED',
      dropReason: 'off_lang',
      stageReached: 'fanout',
      sourceKind: 'live',
    });

    // B — 20 ko survivors split into PLACED (= serving cards) + downstream
    // drops (not_picked / slice_overflow / shorts). Their sum = survivor count.
    const placed = tc.filter((c) => c.decision === 'PLACED');
    const notPicked = tc.filter((c) => c.dropReason === 'not_picked');
    const sliceOverflow = tc.filter((c) => c.dropReason === 'slice_overflow');
    const shorts = tc.filter((c) => c.dropReason === 'shorts');
    expect(placed.length).toBe(res.cards.length);
    expect(placed.length).toBeGreaterThan(0);
    expect(notPicked.length).toBeGreaterThan(0); // 20 survivors > picker overpick
    expect(placed.length + notPicked.length + sliceOverflow.length + shorts.length).toBe(
      res.diagnostics.afterExcludeFilter
    );

    // PLACED carry the picker score + a final cell; live sync gc/cosine/ts null.
    for (const c of placed) {
      expect(c.finalCellIndex).not.toBeUndefined();
      expect(c.llmPickScore).not.toBeUndefined();
    }
    for (const c of tc) {
      expect(c.relevanceGc ?? null).toBeNull();
      expect(c.cosine ?? null).toBeNull();
      expect(c.tsRank ?? null).toBeNull();
    }

    // No videoId double-keyed (duplicate occurrences are not traced).
    expect(new Set(tc.map((c) => c.videoId)).size).toBe(tc.length);
  });

  it('is decision-neutral: flag on vs off yields identical serving cards', async () => {
    mockTraceEnabled = true;
    const on = await runV5Executor(input());

    mockTraceEnabled = false;
    global.fetch = mockFetch();
    const off = await runV5Executor(input());

    expect(off.diagnostics.traceCandidates).toBeUndefined();
    expect(off.cards.map((c) => c.videoId).sort()).toEqual(on.cards.map((c) => c.videoId).sort());
  });
});
