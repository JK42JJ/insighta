/**
 * Pool-serve fill worker — CP499+ (UX 원칙 2).
 *
 * Locks the unified 3-stage contract (James 2026-06-11):
 *   - 1차 pool: semantic gate ≥ threshold → insert with the score COPIED;
 *   - 2차 live fallback fires ONLY when the pool leaves the cell short
 *     (1차 충족 ⇒ live NOT called = quota saved), ONE search.list per cell,
 *     live candidates pass the SAME hygiene + semantic gates;
 *   - 3차: zero passes ⇒ zero inserts (honest empty cell) + run recorded;
 *   - dispatcher: deficit = minPerCell - placed, flag-gated, bypassFlag for
 *     the admin canary.
 */

// ── Mocks (before imports) ──────────────────────────────────────────────────

const mockBossInstance = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  work: jest.fn().mockResolvedValue('worker-id'),
  send: jest.fn().mockResolvedValue('job-1'),
  schedule: jest.fn().mockResolvedValue(undefined),
  getQueueSize: jest.fn().mockResolvedValue(0),
};
jest.mock('pg-boss', () => jest.fn().mockImplementation(() => mockBossInstance));

const mockQueryRaw = jest.fn();
const mockExecuteRaw = jest.fn().mockResolvedValue(1);
const mockYvFindUnique = jest.fn();
const mockYvCreate = jest.fn();
const mockUvsCreateMany = jest.fn().mockResolvedValue({ count: 1 });
const mockSkillRunsCreate = jest
  .fn()
  .mockResolvedValue({ id: '00000000-0000-4000-8000-00000000aaaa' });
const mockMandalaFindFirst = jest.fn();
const mockLevelsFindMany = jest.fn();
const mockLevelsFindFirst = jest.fn();
jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    $queryRaw: (...a: unknown[]) => mockQueryRaw(...a),
    $executeRaw: (...a: unknown[]) => mockExecuteRaw(...a),
    youtube_videos: { findUnique: mockYvFindUnique, create: mockYvCreate },
    userVideoState: { createMany: mockUvsCreateMany },
    skill_runs: { create: mockSkillRunsCreate },
    user_mandalas: { findFirst: mockMandalaFindFirst },
    user_mandala_levels: { findMany: mockLevelsFindMany, findFirst: mockLevelsFindFirst },
  }),
}));

const mockCompute = jest.fn();
jest.mock('@/modules/relevance/compute-card-relevance', () => ({
  computeCardRelevance: (...a: unknown[]) => mockCompute(...a),
}));

const mockPoolCandidates = jest.fn();
jest.mock('@/skills/plugins/video-discover/v3/hybrid-rerank', () => ({
  tsvectorKeywordCandidatesPerCell: (...a: unknown[]) => mockPoolCandidates(...a),
}));

// Partial mock: stub the network fns, keep the REAL title gates so the test
// exercises the actual hygiene posture (#905 included via the v5 gate below).
const mockSearchVideos = jest.fn();
jest.mock('@/skills/plugins/video-discover/v2/youtube-client', () => {
  const actual = jest.requireActual('@/skills/plugins/video-discover/v2/youtube-client');
  return {
    ...actual,
    searchVideos: (...a: unknown[]) => mockSearchVideos(...a),
    resolveSearchApiKeys: () => ['key-1'],
    resolveVideosApiKeys: () => ['vkey-1'],
    videosBatch: (...a: unknown[]) => mockVideosBatch(...a),
  };
});

// CP500+ shorts gate replica deps — probe is stubbed (no HTTP in unit tests);
// duration>=180 short-circuits in the handler itself so the stub is only hit
// for <180/unknown candidates.
const mockVideosBatch = jest.fn().mockResolvedValue([]);
const mockIsShortCached = jest
  .fn()
  .mockResolvedValue({ isShort: false, signal: 'probe_2xx_watch' });
jest.mock('@/modules/video-pool/is-short', () => ({
  SHORT_MAX_DURATION_SEC: 180,
  isShortCached: (...a: unknown[]) => mockIsShortCached(...a),
}));
jest.mock('@/skills/plugins/video-discover/v5/config', () => ({
  getV5Config: () => ({ shortProbeDeadlineMs: 4000 }),
}));
jest.mock('@/skills/plugins/video-discover/v5/executor', () => ({
  parseIsoDurationSeconds: (iso: string | null | undefined) =>
    iso === 'PT45S' ? 45 : iso === 'PT10M' ? 600 : null,
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────

import { getJobQueue } from '../../../src/modules/queue/manager';
import {
  registerPoolServeFillWorker,
  dispatchPoolServeForMandala,
} from '../../../src/modules/queue/handlers/pool-serve-fill';
import { JOB_NAMES, type PoolServeFillPayload } from '../../../src/modules/queue/types';
import { loadPoolServeConfig } from '../../../src/config/pool-serve';

type Handler = (job: { id: string; data: PoolServeFillPayload }) => Promise<void>;

const UUID_USER = '00000000-0000-4000-8000-000000000001';
const UUID_MANDALA = '00000000-0000-4000-8000-000000000002';
const UUID_RUN = '00000000-0000-4000-8000-00000000aaaa';

const basePayload: PoolServeFillPayload = {
  userId: UUID_USER,
  mandalaId: UUID_MANDALA,
  cellIndex: 3,
  cellGoal: '쿠버네티스 모니터링',
  centerGoal: 'K8s 이용한 상용 서비스 운영 전문가 되기',
  language: 'ko',
  cellQuery: '쿠버네티스 모니터링',
  deficit: 2,
  runId: UUID_RUN,
};

const poolCand = (id: string, title: string) => ({
  videoId: id,
  title,
  description: 'desc',
  channelName: 'ch',
  channelId: 'chid',
  thumbnail: null,
  viewCount: 100,
  likeCount: 1,
  durationSec: 600,
  publishedAt: new Date('2026-01-01'),
});

beforeAll(async () => {
  await getJobQueue().start();
});
afterAll(async () => {
  await getJobQueue().stop();
});
beforeEach(() => {
  jest.clearAllMocks();
  // default DB shims: owned=[] / vmr cache miss / skill_runs concat ok
  mockQueryRaw.mockResolvedValue([]);
  mockYvFindUnique.mockResolvedValue({ id: 'uuid-yv-1' });
  mockUvsCreateMany.mockResolvedValue({ count: 1 });
  delete process.env['RELEVANCE_RUBRIC_ENABLED'];
});

async function getHandler(): Promise<Handler> {
  await registerPoolServeFillWorker();
  const call = mockBossInstance.work.mock.calls.find((c) => c[0] === JOB_NAMES.POOL_SERVE_FILL);
  if (!call) throw new Error('worker not registered');
  return call[2] as Handler;
}

describe('config defaults', () => {
  it('flag OFF by default; live fallback ON (same-bundle lever); provisional numbers', () => {
    const cfg = loadPoolServeConfig({} as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(false);
    expect(cfg.liveFallback).toBe(true);
    expect(cfg.relevanceMin).toBe(60);
    expect(cfg.minPerCell).toBe(3);
  });
});

describe('1차 pool gate', () => {
  it('passes ≥ threshold are inserted with the score COPIED; live NOT called when pool fills the need', async () => {
    mockPoolCandidates.mockResolvedValueOnce([
      poolCand('vidA1234567', '쿠버네티스 모니터링 입문'),
      poolCand('vidB1234567', '프로메테우스 실전 강의'),
    ]);
    mockCompute.mockResolvedValueOnce({ ok: true, relevancePct: 82 });
    mockCompute.mockResolvedValueOnce({ ok: true, relevancePct: 71 });
    const handler = await getHandler();

    await handler({ id: 'j1', data: basePayload });

    // both inserted with relevance copy
    expect(mockUvsCreateMany).toHaveBeenCalledTimes(2);
    const first = mockUvsCreateMany.mock.calls[0][0].data[0];
    expect(first).toMatchObject({
      user_id: UUID_USER,
      mandala_id: UUID_MANDALA,
      cell_index: 3,
      auto_added: true,
      relevance_pct: 82,
    });
    // 1차 충족 ⇒ 2차 미발동 (quota 절약)
    expect(mockSearchVideos).not.toHaveBeenCalled();
  });

  it('below-threshold pool candidates are NOT inserted', async () => {
    mockPoolCandidates.mockResolvedValueOnce([poolCand('vidC1234567', '쿠버네티스 잡담')]);
    mockCompute.mockResolvedValueOnce({ ok: true, relevancePct: 35 });
    mockSearchVideos.mockResolvedValueOnce([]); // live finds nothing either
    const handler = await getHandler();

    await handler({ id: 'j2', data: basePayload });

    expect(mockUvsCreateMany).not.toHaveBeenCalled();
  });
});

describe('2차 live fallback', () => {
  it('fires ONLY when pool leaves the cell short; live candidates pass the SAME gates; ONE search call', async () => {
    mockPoolCandidates.mockResolvedValueOnce([]); // pool empty
    mockSearchVideos.mockResolvedValueOnce([
      {
        id: { videoId: 'liveKo12345' },
        snippet: { title: '쿠버네티스 모니터링 구축기', publishedAt: '2026-05-01T00:00:00Z' },
      },
      {
        id: { videoId: 'liveEn12345' },
        // English-dominant — must be dropped by the #905 hygiene gate BEFORE scoring
        snippet: { title: 'Kubernetes Monitoring with Prometheus & Grafana' },
      },
      {
        id: { videoId: 'liveLow1234' },
        snippet: { title: '쿠버네티스 단순 뉴스' },
      },
    ]);
    mockCompute.mockResolvedValueOnce({ ok: true, relevancePct: 77 }); // 구축기
    mockCompute.mockResolvedValueOnce({ ok: true, relevancePct: 20 }); // 뉴스 — gate rejects
    mockYvFindUnique.mockResolvedValue(null); // live videos not in youtube_videos yet
    mockYvCreate.mockResolvedValue({ id: 'uuid-live-1' });
    const handler = await getHandler();

    await handler({ id: 'j3', data: basePayload });

    expect(mockSearchVideos).toHaveBeenCalledTimes(1); // 셀당 1콜 cap
    expect(mockSearchVideos.mock.calls[0][0]).toMatchObject({
      relevanceLanguage: 'ko',
      regionCode: 'KR',
    });
    // English-dominant live title never reached the scorer
    expect(mockCompute).toHaveBeenCalledTimes(2);
    // only the ≥60 Korean candidate inserted; youtube_videos upserted for it
    expect(mockYvCreate).toHaveBeenCalledTimes(1);
    expect(mockUvsCreateMany).toHaveBeenCalledTimes(1);
    expect(mockUvsCreateMany.mock.calls[0][0].data[0].relevance_pct).toBe(77);
  });

  it('live failure is non-fatal — pool passes still insert', async () => {
    mockPoolCandidates.mockResolvedValueOnce([poolCand('vidD1234567', '쿠버네티스 보안 기초')]);
    mockCompute.mockResolvedValueOnce({ ok: true, relevancePct: 65 });
    mockSearchVideos.mockRejectedValueOnce(new Error('quotaExceeded'));
    const handler = await getHandler();

    await handler({ id: 'j4', data: { ...basePayload, deficit: 3 } });

    expect(mockUvsCreateMany).toHaveBeenCalledTimes(1);
  });
});

describe('3차 honest empty', () => {
  it('zero passes ⇒ zero inserts, run outcome still recorded', async () => {
    mockPoolCandidates.mockResolvedValueOnce([]);
    mockSearchVideos.mockResolvedValueOnce([]);
    const handler = await getHandler();

    await handler({ id: 'j5', data: basePayload });

    expect(mockUvsCreateMany).not.toHaveBeenCalled();
    expect(mockCompute).not.toHaveBeenCalled();
    // run record concat fired (finally block)
    expect(mockExecuteRaw).toHaveBeenCalled();
  });
});

describe('dispatchPoolServeForMandala', () => {
  it('flag off + no bypass ⇒ null, zero DB work', async () => {
    const r = await dispatchPoolServeForMandala(UUID_USER, UUID_MANDALA);
    expect(r.runId).toBeNull();
    expect(mockMandalaFindFirst).not.toHaveBeenCalled();
  });

  it('bypassFlag: deficit = minPerCell - placed; full cells skipped; jobs enqueued per deficit cell', async () => {
    mockMandalaFindFirst.mockResolvedValueOnce({ language: 'ko' });
    mockLevelsFindMany.mockResolvedValueOnce([
      { position: 0, center_goal: '클러스터 구축' }, // placed 5 → no deficit
      { position: 1, center_goal: '모니터링' }, // placed 1 → deficit 2
      { position: 2, center_goal: '장애 대응' }, // placed 0 → deficit 3
    ]);
    mockLevelsFindFirst.mockResolvedValueOnce({ center_goal: 'K8s 전문가' });
    mockQueryRaw.mockResolvedValueOnce([
      { cell_index: 0, n: 5 },
      { cell_index: 1, n: 1 },
    ]);

    const r = await dispatchPoolServeForMandala(UUID_USER, UUID_MANDALA, { bypassFlag: true });

    expect(r.runId).toBe(UUID_RUN);
    expect(r.deficitCells).toEqual([1, 2]);
    expect(mockSkillRunsCreate).toHaveBeenCalledTimes(1);
    expect(mockBossInstance.send).toHaveBeenCalledTimes(2);
    const job1 = mockBossInstance.send.mock.calls[0][1];
    expect(job1).toMatchObject({ cellIndex: 1, deficit: 2, cellGoal: '모니터링' });
  });
});

// ── CP500+ shorts gate (v5 placement gate replica) ───────────────────────────

describe('CP500+ shorts gate — guard-replication fix', () => {
  it('pool candidate <180s flagged short by the probe is dropped BEFORE scoring', async () => {
    mockPoolCandidates.mockResolvedValueOnce([
      { ...poolCand('vidS1234567', '쿠버네티스 1분 요약'), durationSec: 45 },
    ]);
    mockIsShortCached.mockResolvedValueOnce({ isShort: true, signal: 'probe_redirect_shorts' });
    mockSearchVideos.mockResolvedValueOnce([]); // live empty
    const handler = await getHandler();

    await handler({ id: 'js1', data: basePayload });

    expect(mockIsShortCached).toHaveBeenCalledWith('vidS1234567', 45, expect.anything());
    expect(mockCompute).not.toHaveBeenCalled(); // dropped pre-gate (no Haiku spend)
    expect(mockUvsCreateMany).not.toHaveBeenCalled();
  });

  it('duration>=180 short-circuits — kept WITHOUT a probe call (v5 semantics)', async () => {
    mockPoolCandidates.mockResolvedValueOnce([
      { ...poolCand('vidL1234567', '쿠버네티스 풀강의'), durationSec: 600 },
    ]);
    mockCompute.mockResolvedValueOnce({ ok: true, relevancePct: 80 });
    const handler = await getHandler();

    await handler({ id: 'js2', data: basePayload });

    expect(mockIsShortCached).not.toHaveBeenCalled();
    expect(mockUvsCreateMany).toHaveBeenCalledTimes(1);
  });

  it('live candidates get durations via ONE videos.list call, then the SAME gate drops shorts', async () => {
    mockPoolCandidates.mockResolvedValueOnce([]); // pool empty → live fires
    mockSearchVideos.mockResolvedValueOnce([
      { id: { videoId: 'liveShort01' }, snippet: { title: '도커 쇼츠 모음' } },
      { id: { videoId: 'liveLong001' }, snippet: { title: '도커 운영 강의 풀버전' } },
    ]);
    mockVideosBatch.mockResolvedValueOnce([
      { id: 'liveShort01', contentDetails: { duration: 'PT45S' } },
      { id: 'liveLong001', contentDetails: { duration: 'PT10M' } },
    ]);
    mockIsShortCached.mockResolvedValueOnce({ isShort: true, signal: 'probe_redirect_shorts' });
    mockCompute.mockResolvedValueOnce({ ok: true, relevancePct: 75 });
    const handler = await getHandler();

    await handler({ id: 'js3', data: basePayload });

    expect(mockVideosBatch).toHaveBeenCalledTimes(1);
    expect(mockVideosBatch.mock.calls[0][0].videoIds).toEqual(['liveShort01', 'liveLong001']);
    // short(45s) probed+dropped; long(600s) kept with NO probe → exactly 1 probe call
    expect(mockIsShortCached).toHaveBeenCalledTimes(1);
    expect(mockIsShortCached).toHaveBeenCalledWith('liveShort01', 45, expect.anything());
    expect(mockUvsCreateMany).toHaveBeenCalledTimes(1);
    const row = mockUvsCreateMany.mock.calls[0][0].data[0];
    expect(row.relevance_pct).toBe(75);
  });

  it('videos.list failure is non-fatal — gate falls back to probe-only on unknown durations', async () => {
    mockPoolCandidates.mockResolvedValueOnce([]);
    mockSearchVideos.mockResolvedValueOnce([
      { id: { videoId: 'liveUnknown' }, snippet: { title: '도커 강의' } },
    ]);
    mockVideosBatch.mockRejectedValueOnce(new Error('videos.list HTTP 403'));
    mockIsShortCached.mockResolvedValueOnce({ isShort: false, signal: 'probe_2xx_watch' });
    mockCompute.mockResolvedValueOnce({ ok: true, relevancePct: 70 });
    const handler = await getHandler();

    await handler({ id: 'js4', data: basePayload });

    expect(mockIsShortCached).toHaveBeenCalledWith('liveUnknown', null, expect.anything());
    expect(mockUvsCreateMany).toHaveBeenCalledTimes(1);
  });
});
