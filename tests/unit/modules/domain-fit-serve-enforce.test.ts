/**
 * domain-fit-shadow/serve-enforce — R24 SERVE-edge ENFORCE (real reorder).
 *
 * Pins:
 *   - flag OFF (serveEnforceEnabled:false) → zero classify calls, zero cache
 *     calls, same array REFERENCE returned (byte-identical no-op).
 *   - empty candidate list → no-op even when enabled.
 *   - deboost multiplier: 적합 (no lexical conflict) → 1.0; 비적합 →
 *     DOMAIN_FIT_SERVE_ENFORCE_DEBOOST_MULTIPLIER (0.25); 적합 + lexical
 *     conflict → the lexical multiplier alone (0.2).
 *   - DROP invariant: output length === input length, ALWAYS (flag on/off,
 *     any mix of fit/not-fit/classifier-failure) — demote-only, never drop.
 *   - reorder: 비적합 candidates sink to the tail; ties preserve original
 *     recruit-rank order (stable sort).
 *   - cache HIT avoids a classifyDomainFit call entirely; a cache MISS calls
 *     the classifier once and writes the result back.
 *   - classifier failure (ok:false / fit:null) → fail-open (multiplier 1,
 *     never demoted) AND never cached.
 *   - candidates beyond maxCandidates are appended unscored at the tail
 *     (load cap, never dropped).
 *   - runDomainFitServeEnforce logs exactly one recordTrace call, step
 *     domain_fit_serve_enforce.<stage>, and the returned (reordered) list is
 *     never altered by a trace-logging failure.
 */

const mockClassify = jest.fn();
const mockRecordTrace = jest.fn();
const mockWithTraceContext = jest.fn();
const mockGetTraceContext = jest.fn();

jest.mock('@/modules/domain-fit-shadow/client', () => {
  const actual = jest.requireActual('@/modules/domain-fit-shadow/client');
  return {
    ...actual,
    classifyDomainFit: (...args: unknown[]) => mockClassify(...args),
  };
});
jest.mock('@/modules/discover-tracing', () => ({
  recordTrace: (...args: unknown[]) => mockRecordTrace(...args),
  getTraceContext: (...args: unknown[]) => mockGetTraceContext(...args),
  withTraceContext: (ctx: unknown, fn: () => Promise<unknown>) => mockWithTraceContext(ctx, fn),
}));

import {
  applyDomainFitServeEnforce,
  runDomainFitServeEnforce,
  createNoopDomainFitServeCache,
  DOMAIN_FIT_SERVE_ENFORCE_DEBOOST_MULTIPLIER,
  type DomainFitServeCache,
  type DomainFitServeCacheEntry,
} from '@/modules/domain-fit-shadow/serve-enforce';
import type { DomainFitShadowConfig } from '@/config/domain-fit-shadow';

const CFG_OFF: DomainFitShadowConfig = {
  enabled: false,
  ollamaUrl: 'http://100.91.173.17:11434',
  model: 'mandala-gen:latest',
  timeoutMs: 5000,
  concurrency: 4,
  maxCandidates: 40,
  scalarEnabled: false,
  writeShadowEnabled: false,
  writeEnforceEnabled: false,
  serveShadowEnabled: false,
  serveEnforceEnabled: false,
  syncConsumeEnabled: false,
};
const CFG_ON: DomainFitShadowConfig = { ...CFG_OFF, serveEnforceEnabled: true };

/** Simple Map-based fake — same contract as the prisma-backed adapter without any DB. */
function makeFakeCache(): DomainFitServeCache & { store: Map<string, DomainFitServeCacheEntry> } {
  const store = new Map<string, DomainFitServeCacheEntry>();
  return {
    store,
    get: async (id) => store.get(id) ?? null,
    set: async (id, entry) => {
      store.set(id, entry);
    },
  };
}

const cand = (id: string, title: string) => ({ youtubeVideoId: id, title });

beforeEach(() => {
  mockClassify.mockReset();
  mockRecordTrace.mockReset();
  mockWithTraceContext.mockReset();
  mockGetTraceContext.mockReset();
  mockGetTraceContext.mockReturnValue({ mandalaId: 'm1', userId: 'u1', runId: 'r1' });
  mockWithTraceContext.mockImplementation((_ctx: unknown, fn: () => Promise<unknown>) => fn());
});

describe('DOMAIN_FIT_SERVE_ENFORCE_DEBOOST_MULTIPLIER', () => {
  it('is 0.25 (named constant, within the 0.2-0.3 spec range)', () => {
    expect(DOMAIN_FIT_SERVE_ENFORCE_DEBOOST_MULTIPLIER).toBe(0.25);
  });
});

describe('applyDomainFitServeEnforce — flag gating', () => {
  it('flag OFF: zero classify/cache calls, SAME array reference returned (byte-identical no-op)', async () => {
    const cache = makeFakeCache();
    const input = [cand('v1', 'title a'), cand('v2', 'title b')];
    const result = await applyDomainFitServeEnforce(input, 'goal', CFG_OFF, cache);
    expect(result.reordered).toBe(input); // same reference, not just equal
    expect(mockClassify).not.toHaveBeenCalled();
    expect(result.scored).toBe(0);
    expect(result.cacheHits).toBe(0);
    expect(cache.store.size).toBe(0);
  });

  it('empty candidate list is a no-op even when enabled', async () => {
    const cache = makeFakeCache();
    const result = await applyDomainFitServeEnforce([], 'goal', CFG_ON, cache);
    expect(result.reordered).toEqual([]);
    expect(mockClassify).not.toHaveBeenCalled();
  });
});

describe('applyDomainFitServeEnforce — composite deboost multiplier', () => {
  it('적합 + no lexical conflict → multiplier 1.0 (no demotion)', async () => {
    mockClassify.mockResolvedValue({ fit: '적합', ms: 5, ok: true });
    const cache = makeFakeCache();
    const result = await applyDomainFitServeEnforce(
      [cand('v1', '영어 발음 교정 Day1')],
      '100일 영어 회화 완성하기',
      CFG_ON,
      cache
    );
    expect(result.demoted).toBe(0);
    expect(cache.store.get('v1')?.multiplier).toBe(1);
  });

  it('비적합 → multiplier DOMAIN_FIT_SERVE_ENFORCE_DEBOOST_MULTIPLIER (demoted)', async () => {
    mockClassify.mockResolvedValue({ fit: '비적합', ms: 5, ok: true });
    const cache = makeFakeCache();
    const result = await applyDomainFitServeEnforce(
      [cand('v1', '전혀 무관한 제목')],
      '영어 회화',
      CFG_ON,
      cache
    );
    expect(result.demoted).toBe(1);
    expect(cache.store.get('v1')?.multiplier).toBeCloseTo(
      DOMAIN_FIT_SERVE_ENFORCE_DEBOOST_MULTIPLIER
    );
  });

  it('적합 BUT a lexical qualifier conflict (R22 pattern) → multiplier = lexical multiplier alone (0.2)', async () => {
    mockClassify.mockResolvedValue({ fit: '적합', ms: 5, ok: true });
    const cache = makeFakeCache();
    const result = await applyDomainFitServeEnforce(
      [cand('v1', '실전 일본여행회화 3강 일본어')],
      '100일 영어 회화 완성하기',
      CFG_ON,
      cache
    );
    expect(result.demoted).toBe(1);
    expect(cache.store.get('v1')?.multiplier).toBeCloseTo(0.2);
    expect(cache.store.get('v1')?.lexicalConflict).toBe(true);
  });

  it('classifier failure (ok:false) → FAIL-OPEN multiplier 1, never cached', async () => {
    mockClassify.mockResolvedValue({ fit: null, ms: 5000, ok: false, error: 'timeout' });
    const cache = makeFakeCache();
    const result = await applyDomainFitServeEnforce(
      [cand('v1', '아무 제목')],
      '영어 회화',
      CFG_ON,
      cache
    );
    expect(result.classifierFailed).toBe(1);
    expect(result.demoted).toBe(0);
    expect(cache.store.has('v1')).toBe(false); // never cached — self-heals next call
  });
});

describe('applyDomainFitServeEnforce — DROP invariant (demote-only, never drop)', () => {
  it('output length === input length regardless of fit outcome', async () => {
    mockClassify
      .mockResolvedValueOnce({ fit: '적합', ms: 5, ok: true })
      .mockResolvedValueOnce({ fit: '비적합', ms: 5, ok: true })
      .mockResolvedValueOnce({ fit: null, ms: 5, ok: false });
    const cache = makeFakeCache();
    const input = [cand('v1', 'a'), cand('v2', 'b'), cand('v3', 'c')];
    const result = await applyDomainFitServeEnforce(input, 'goal', CFG_ON, cache);
    expect(result.reordered).toHaveLength(3);
    expect(result.reordered.map((c) => c.youtubeVideoId).sort()).toEqual(['v1', 'v2', 'v3']);
  });

  it('candidates beyond maxCandidates are appended UNSCORED at the tail (load cap, never dropped)', async () => {
    mockClassify.mockResolvedValue({ fit: '적합', ms: 5, ok: true });
    const cache = makeFakeCache();
    const cfg = { ...CFG_ON, maxCandidates: 2 };
    const input = [cand('v1', 'a'), cand('v2', 'b'), cand('v3', 'c'), cand('v4', 'd')];
    const result = await applyDomainFitServeEnforce(input, 'goal', cfg, cache);
    expect(result.reordered).toHaveLength(4); // never dropped
    expect(mockClassify).toHaveBeenCalledTimes(2); // only the capped head is scored
    // Overflow (v3, v4) preserved untouched at the tail, in original order.
    expect(result.reordered.slice(2).map((c) => c.youtubeVideoId)).toEqual(['v3', 'v4']);
  });
});

describe('applyDomainFitServeEnforce — reorder (demote to tail, stable)', () => {
  it('비적합 candidates sink below 적합 peers regardless of original recruit-rank order', async () => {
    mockClassify
      .mockResolvedValueOnce({ fit: '비적합', ms: 5, ok: true }) // v1 — recruited FIRST but not-fit
      .mockResolvedValueOnce({ fit: '적합', ms: 5, ok: true }); // v2 — recruited SECOND, fit
    const cache = makeFakeCache();
    const input = [cand('v1', '무관 제목'), cand('v2', '영어 회화 제목')];
    const result = await applyDomainFitServeEnforce(input, '영어 회화', CFG_ON, cache);
    expect(result.reordered.map((c) => c.youtubeVideoId)).toEqual(['v2', 'v1']);
  });

  it('ties (same multiplier) preserve original recruit-rank order (stable sort)', async () => {
    mockClassify.mockResolvedValue({ fit: '적합', ms: 5, ok: true });
    const cache = makeFakeCache();
    const input = [cand('v1', 'a'), cand('v2', 'b'), cand('v3', 'c')];
    const result = await applyDomainFitServeEnforce(input, 'goal', CFG_ON, cache);
    expect(result.reordered.map((c) => c.youtubeVideoId)).toEqual(['v1', 'v2', 'v3']);
  });
});

describe('applyDomainFitServeEnforce — cache hit avoids a repeat classifier call', () => {
  it('a cache HIT skips classifyDomainFit entirely and reuses the cached multiplier', async () => {
    const cache = makeFakeCache();
    await cache.set('v1', {
      fit: '비적합',
      lexicalConflict: false,
      multiplier: DOMAIN_FIT_SERVE_ENFORCE_DEBOOST_MULTIPLIER,
      model: 'mandala-gen:latest',
      scoredAt: new Date().toISOString(),
    });
    const result = await applyDomainFitServeEnforce([cand('v1', 'x')], 'goal', CFG_ON, cache);
    expect(mockClassify).not.toHaveBeenCalled();
    expect(result.cacheHits).toBe(1);
    expect(result.scored).toBe(0);
    expect(result.demoted).toBe(1);
  });

  it('a cache MISS calls the classifier once and writes the result back for next time', async () => {
    mockClassify.mockResolvedValue({ fit: '적합', ms: 5, ok: true });
    const cache = makeFakeCache();
    const result = await applyDomainFitServeEnforce([cand('v1', 'x')], 'goal', CFG_ON, cache);
    expect(mockClassify).toHaveBeenCalledTimes(1);
    expect(result.scored).toBe(1);
    expect(cache.store.has('v1')).toBe(true);
  });
});

describe('createNoopDomainFitServeCache', () => {
  it('every get() is a miss; set() is a no-op (safe default for callers without a persistent cache)', async () => {
    const cache = createNoopDomainFitServeCache();
    await expect(cache.get('v1')).resolves.toBeNull();
    await expect(cache.set('v1', {} as DomainFitServeCacheEntry)).resolves.toBeUndefined();
    await expect(cache.get('v1')).resolves.toBeNull(); // set() truly no-ops
  });
});

describe('runDomainFitServeEnforce — logging shape', () => {
  it('logs exactly one recordTrace call, step domain_fit_serve_enforce.<stage>', async () => {
    mockClassify.mockResolvedValue({ fit: '비적합', ms: 5, ok: true });
    const cache = makeFakeCache();
    const reordered = await runDomainFitServeEnforce(
      {
        stage: 'pool',
        centerGoal: '영어 회화',
        cellIndex: 2,
        candidates: [cand('v1', '무관')],
      },
      CFG_ON,
      cache
    );
    expect(reordered).toHaveLength(1);
    expect(mockRecordTrace).toHaveBeenCalledTimes(1);
    const call = mockRecordTrace.mock.calls[0]![0];
    expect(call.step).toBe('domain_fit_serve_enforce.pool');
    expect(call.request.cell_index).toBe(2);
    expect(call.response.demoted).toBe(1);
  });

  it('flag OFF: zero recordTrace calls (short-circuits before scoring)', async () => {
    const cache = makeFakeCache();
    const input = [cand('v1', 'a')];
    const reordered = await runDomainFitServeEnforce(
      { stage: 'live', centerGoal: 'goal', cellIndex: 0, candidates: input },
      CFG_OFF,
      cache
    );
    expect(reordered).toBe(input);
    expect(mockRecordTrace).not.toHaveBeenCalled();
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('creates a scoped trace context when none is bound (mirrors write-gate.ts)', async () => {
    mockGetTraceContext.mockReturnValue(null);
    mockClassify.mockResolvedValue({ fit: '적합', ms: 5, ok: true });
    const cache = makeFakeCache();
    await runDomainFitServeEnforce(
      {
        stage: 'pool',
        centerGoal: '영어 회화',
        cellIndex: 0,
        mandalaId: 'm-abc',
        userId: 'u-xyz',
        candidates: [cand('v1', '영어 발음')],
      },
      CFG_ON,
      cache
    );
    expect(mockWithTraceContext).toHaveBeenCalledTimes(1);
    expect(mockWithTraceContext.mock.calls[0]![0]).toEqual({ mandalaId: 'm-abc', userId: 'u-xyz' });
  });

  it('a trace-logging failure never alters the returned (reordered) list', async () => {
    mockClassify.mockResolvedValue({ fit: '적합', ms: 5, ok: true });
    mockRecordTrace.mockImplementation(() => {
      throw new Error('trace boom');
    });
    const cache = makeFakeCache();
    const reordered = await runDomainFitServeEnforce(
      {
        stage: 'pool',
        centerGoal: '영어 회화',
        cellIndex: 0,
        candidates: [cand('v1', '영어 발음')],
      },
      CFG_ON,
      cache
    );
    expect(reordered).toHaveLength(1);
  });
});
