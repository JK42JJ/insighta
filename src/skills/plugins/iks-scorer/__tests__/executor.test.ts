/**
 * iks-scorer — executor tests (preflight + execute combined for compactness)
 *
 * Mocks:
 *   - @/modules/database (mock Prisma client with trend_signals.count/findMany,
 *     scoring_weights.findFirst, keyword_scores.upsert)
 *
 * Phase 2a contract this test pins:
 *   - preflight rejects when trend_signals is empty
 *   - preflight rejects when no active scoring_weights row
 *   - preflight loads weights from active scoring_weights row
 *   - execute reads → scores → upserts each unique keyword
 *   - execute de-duplicates by keyword (highest norm_score wins)
 *   - upsert uses (keyword, language) composite key
 *   - weight_version is captured per row
 *   - status='success' when all upserts succeed
 *   - metrics.rows_written.keyword_scores reflects upsert count
 */

const mockSignalCount = jest.fn();
const mockSignalFindMany = jest.fn();
const mockWeightsFindFirst = jest.fn();
const mockScoreUpsert = jest.fn();

jest.mock('@/modules/database', () => ({
  getPrismaClient: () => ({
    trend_signals: {
      count: mockSignalCount,
      findMany: mockSignalFindMany,
    },
    scoring_weights: {
      findFirst: mockWeightsFindFirst,
    },
    keyword_scores: {
      upsert: mockScoreUpsert,
    },
  }),
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

import { executor } from '../executor';
import type { PreflightContext, ExecuteContext } from '@/skills/_shared/types';

const baseCtx: PreflightContext = {
  userId: '00000000-0000-0000-0000-000000000000',
  tier: 'admin',
  env: {},
};

const v1WeightsRow = {
  version: 1,
  search_demand: 0.15,
  competition: 0.1,
  trend_velocity: 0.15,
  goal_relevance: 0.25,
  learning_value: 0.2,
  content_performance: 0.15,
  active: true,
};

function buildSignals(
  rows: { keyword: string; norm_score: number; raw_score: number; likes?: number }[]
) {
  return rows.map((r) => ({
    id: `id-${r.keyword}`,
    source: 'youtube_trending',
    keyword: r.keyword,
    raw_score: r.raw_score,
    norm_score: r.norm_score,
    velocity: 0,
    metadata: { likeCount: r.likes ?? Math.floor(r.raw_score * 0.04) },
    language: 'ko',
    domain: null,
    fetched_at: new Date(),
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  }));
}

describe('iks-scorer preflight', () => {
  beforeEach(() => {
    mockSignalCount.mockReset();
    mockWeightsFindFirst.mockReset();
  });

  it('rejects when no fresh trend_signals exist', async () => {
    mockSignalCount.mockResolvedValue(0);
    mockWeightsFindFirst.mockResolvedValue(v1WeightsRow);

    const result = await executor.preflight(baseCtx);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/No fresh trend_signals/);
  });

  it('rejects when no active scoring_weights row exists', async () => {
    mockSignalCount.mockResolvedValue(40);
    mockWeightsFindFirst.mockResolvedValue(null);

    const result = await executor.preflight(baseCtx);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/No active scoring_weights/);
  });

  it('hydrates weights + version from the active scoring_weights row', async () => {
    mockSignalCount.mockResolvedValue(40);
    mockWeightsFindFirst.mockResolvedValue(v1WeightsRow);

    const result = await executor.preflight(baseCtx);
    expect(result.ok).toBe(true);
    const state = result.hydrated as Record<string, unknown>;
    expect(state['weightVersion']).toBe(1);
    expect(state['weights']).toEqual({
      search_demand: 0.15,
      competition: 0.1,
      trend_velocity: 0.15,
      goal_relevance: 0.25,
      learning_value: 0.2,
      content_performance: 0.15,
    });
  });
});

describe('iks-scorer execute', () => {
  beforeEach(() => {
    mockSignalFindMany.mockReset();
    mockScoreUpsert.mockReset();
    mockScoreUpsert.mockResolvedValue({});
  });

  function buildExecuteCtx(): ExecuteContext {
    return {
      userId: '00000000-0000-0000-0000-000000000000',
      tier: 'admin',
      env: {},
      llm: {} as never,
      state: {
        sources: ['youtube_trending'],
        language: 'ko',
        weights: {
          search_demand: 0.15,
          competition: 0.1,
          trend_velocity: 0.15,
          goal_relevance: 0.25,
          learning_value: 0.2,
          content_performance: 0.15,
        },
        weightVersion: 1,
      },
    };
  }

  it('reads signals → scores → upserts each unique keyword', async () => {
    mockSignalFindMany.mockResolvedValue(
      buildSignals([
        { keyword: 'AI 코딩', norm_score: 1.0, raw_score: 100000 },
        { keyword: '배당 ETF', norm_score: 0.5, raw_score: 50000 },
      ])
    );

    const result = await executor.execute(buildExecuteCtx());

    expect(result.status).toBe('success');
    expect(result.data['signals_read']).toBe(2);
    expect(result.data['unique_keywords']).toBe(2);
    expect(result.data['keyword_scores_upserted']).toBe(2);
    expect(mockScoreUpsert).toHaveBeenCalledTimes(2);
  });

  it('de-duplicates by keyword (highest norm_score wins)', async () => {
    // Same keyword from "two sources" — only the higher score should be upserted
    mockSignalFindMany.mockResolvedValue(
      buildSignals([
        { keyword: 'AI 코딩', norm_score: 0.4, raw_score: 40000 },
        { keyword: 'AI 코딩', norm_score: 0.9, raw_score: 90000 },
      ])
    );

    const result = await executor.execute(buildExecuteCtx());
    expect(result.data['signals_read']).toBe(2);
    expect(result.data['unique_keywords']).toBe(1);
    expect(result.data['keyword_scores_upserted']).toBe(1);
    expect(mockScoreUpsert).toHaveBeenCalledTimes(1);

    // Verify the higher-norm signal was used
    const upsertCall = mockScoreUpsert.mock.calls[0]?.[0];
    expect(upsertCall.create.search_demand).toBe(0.9);
  });

  it('upserts using (keyword, language) composite key', async () => {
    mockSignalFindMany.mockResolvedValue(
      buildSignals([{ keyword: '테스트 키워드', norm_score: 0.7, raw_score: 70000 }])
    );
    await executor.execute(buildExecuteCtx());

    const upsertCall = mockScoreUpsert.mock.calls[0]?.[0];
    expect(upsertCall.where.keyword_language).toEqual({
      keyword: '테스트 키워드',
      language: 'ko',
    });
  });

  it('captures weight_version on every upsert', async () => {
    mockSignalFindMany.mockResolvedValue(
      buildSignals([{ keyword: 'k', norm_score: 0.5, raw_score: 1000 }])
    );
    await executor.execute(buildExecuteCtx());

    const upsertCall = mockScoreUpsert.mock.calls[0]?.[0];
    expect(upsertCall.create.weight_version).toBe(1);
    expect(upsertCall.update.weight_version).toBe(1);
  });

  it('returns failed when signals are empty at execute() time (race with TTL)', async () => {
    mockSignalFindMany.mockResolvedValue([]);
    const result = await executor.execute(buildExecuteCtx());
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/race with TTL/);
  });

  it('reports duration_ms and rows_written.keyword_scores in metrics', async () => {
    mockSignalFindMany.mockResolvedValue(
      buildSignals([{ keyword: 'k', norm_score: 0.5, raw_score: 1000 }])
    );
    const result = await executor.execute(buildExecuteCtx());
    expect(result.metrics).toBeDefined();
    expect(typeof result.metrics?.duration_ms).toBe('number');
    expect(result.metrics?.rows_written).toEqual({ keyword_scores: 1 });
  });

  it('writes goal_relevance=0.5 placeholder (Phase 2b will replace via Mac Mini Ollama)', async () => {
    mockSignalFindMany.mockResolvedValue(
      buildSignals([{ keyword: 'k', norm_score: 1, raw_score: 100 }])
    );
    await executor.execute(buildExecuteCtx());
    const upsertCall = mockScoreUpsert.mock.calls[0]?.[0];
    expect(upsertCall.create.goal_relevance).toBe(0.5);
  });
});
