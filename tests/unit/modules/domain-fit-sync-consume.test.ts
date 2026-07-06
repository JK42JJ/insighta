/**
 * domain-fit-shadow/sync-consume — R24+1 SYNC-path cache-consume.
 *
 * Pins:
 *   - flag OFF (syncConsumeEnabled:false) → zero cache calls, same array
 *     REFERENCE returned (byte-identical no-op).
 *   - flag ON + cache HIT with a 비적합 verdict → the cached candidate is
 *     DEMOTED (stable reorder), count preserved, ZERO classifyDomainFit calls
 *     (the sync path never scores synchronously).
 *   - flag ON + cache MISS → candidate untouched (multiplier 1, no reorder
 *     effect) AND the cache-warm scheduler is invoked with exactly the
 *     uncached candidates (never awaited by the caller).
 *   - DROP invariant: output length === input length always.
 */

const mockClassify = jest.fn();
jest.mock('@/modules/domain-fit-shadow/client', () => {
  const actual = jest.requireActual('@/modules/domain-fit-shadow/client');
  return {
    ...actual,
    classifyDomainFit: (...args: unknown[]) => mockClassify(...args),
  };
});

import {
  applyDomainFitSyncConsume,
  scheduleDomainFitSyncWarm,
  createNoopDomainFitSyncConsumeCache,
  type DomainFitSyncConsumeCache,
} from '@/modules/domain-fit-shadow/sync-consume';
import type { DomainFitServeCacheEntry } from '@/modules/domain-fit-shadow/serve-enforce';
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
const CFG_ON: DomainFitShadowConfig = { ...CFG_OFF, syncConsumeEnabled: true };

function makeFakeCache(): DomainFitSyncConsumeCache & {
  store: Map<string, DomainFitServeCacheEntry>;
  getManyMock: jest.Mock;
  setMock: jest.Mock;
} {
  const store = new Map<string, DomainFitServeCacheEntry>();
  const getManyMock = jest.fn(async (ids: string[]) => {
    const out = new Map<string, DomainFitServeCacheEntry>();
    for (const id of ids) {
      const entry = store.get(id);
      if (entry) out.set(id, entry);
    }
    return out;
  });
  const setMock = jest.fn(async (id: string, entry: DomainFitServeCacheEntry) => {
    store.set(id, entry);
  });
  return { store, getManyMock, setMock, getMany: getManyMock, set: setMock };
}

const cand = (id: string, title: string) => ({ youtubeVideoId: id, title });

beforeEach(() => {
  mockClassify.mockReset();
});

/** Drain any real setImmediate scheduled by the test that just ran (the
 *  cache-warm path is deliberately fire-and-forget) — without this, a
 *  pending warm classify call can fire during the NEXT test and pollute its
 *  mockClassify call-count assertions. */
afterEach(async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
});

describe('applyDomainFitSyncConsume — flag gating', () => {
  it('flag OFF: zero cache calls, SAME array reference returned (byte-identical no-op)', async () => {
    const cache = makeFakeCache();
    const input = [cand('v1', 'a'), cand('v2', 'b')];
    const result = await applyDomainFitSyncConsume(input, 'goal', CFG_OFF, cache);
    expect(result.reordered).toBe(input);
    expect(cache.getManyMock).not.toHaveBeenCalled();
    expect(cache.setMock).not.toHaveBeenCalled();
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('empty candidate list is a no-op even when enabled', async () => {
    const cache = makeFakeCache();
    const result = await applyDomainFitSyncConsume([], 'goal', CFG_ON, cache);
    expect(result.reordered).toEqual([]);
    expect(cache.getManyMock).not.toHaveBeenCalled();
  });
});

describe('applyDomainFitSyncConsume — cache HIT (no synchronous classify call)', () => {
  it('a cached 비적합 verdict demotes the candidate, count preserved, zero classify calls', async () => {
    const cache = makeFakeCache();
    await cache.set('v1', {
      fit: '비적합',
      lexicalConflict: false,
      multiplier: 0.25,
      model: 'mandala-gen:latest',
      scoredAt: new Date().toISOString(),
    });
    const input = [cand('v1', '무관 제목'), cand('v2', '영어 회화 제목')];
    const result = await applyDomainFitSyncConsume(input, '영어 회화', CFG_ON, cache);

    expect(result.reordered).toHaveLength(2); // count preserved
    expect(result.reordered.map((c) => c.youtubeVideoId)).toEqual(['v2', 'v1']); // demoted to tail
    expect(result.demoted).toBe(1);
    expect(result.cacheHits).toBe(1);
    expect(mockClassify).not.toHaveBeenCalled(); // sync path NEVER classifies inline
    expect(cache.getManyMock).toHaveBeenCalledTimes(1); // single batched read
    expect(cache.getManyMock).toHaveBeenCalledWith(['v1', 'v2']);
  });

  it('cache-only reorder does not schedule a warm for already-cached candidates', () => {
    // scheduleDomainFitSyncWarm is a no-op given an empty uncached list.
    const cache = makeFakeCache();
    scheduleDomainFitSyncWarm([], 'goal', CFG_ON, cache);
    expect(cache.setMock).not.toHaveBeenCalled();
  });
});

describe('applyDomainFitSyncConsume — cache MISS (untouched + async warm enqueued)', () => {
  it('uncached candidates keep multiplier 1 (untouched order) and are reported as enqueued', async () => {
    const cache = makeFakeCache(); // empty store — every id misses
    const input = [cand('v1', 'a'), cand('v2', 'b')];
    const result = await applyDomainFitSyncConsume(input, 'goal', CFG_ON, cache);

    expect(result.reordered).toHaveLength(2);
    expect(result.reordered.map((c) => c.youtubeVideoId)).toEqual(['v1', 'v2']); // untouched order
    expect(result.demoted).toBe(0);
    expect(result.enqueued).toBe(2);
    expect(mockClassify).not.toHaveBeenCalled(); // NOT scored synchronously
  });

  it('scheduleDomainFitSyncWarm is invoked with exactly the uncached candidates, never awaited by the caller', async () => {
    mockClassify.mockResolvedValue({ fit: '적합', ms: 5, ok: true });
    const cache = makeFakeCache();
    const input = [cand('v1', 'a')];
    const result = await applyDomainFitSyncConsume(input, 'goal', CFG_ON, cache);

    // The request-path promise resolves BEFORE the warm classify runs —
    // the real setImmediate has not fired yet, so cache.set has not been called.
    expect(result.enqueued).toBe(1);
    expect(cache.setMock).not.toHaveBeenCalled();
    expect(mockClassify).not.toHaveBeenCalled();

    // Let the scheduled real setImmediate + its internal await flush.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockClassify).toHaveBeenCalledTimes(1);
    expect(cache.setMock).toHaveBeenCalledTimes(1);
  });

  it('a classifier failure during warm is swallowed and never cached (fail-open)', async () => {
    mockClassify.mockResolvedValue({ fit: null, ms: 5000, ok: false, error: 'timeout' });
    const cache = makeFakeCache();
    await applyDomainFitSyncConsume([cand('v1', 'a')], 'goal', CFG_ON, cache);

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockClassify).toHaveBeenCalledTimes(1);
    expect(cache.setMock).not.toHaveBeenCalled(); // fail-open — never cached
  });
});

describe('applyDomainFitSyncConsume — DROP invariant + overflow cap', () => {
  it('candidates beyond maxCandidates are appended UNTOUCHED at the tail (never dropped)', async () => {
    const cache = makeFakeCache();
    const cfg = { ...CFG_ON, maxCandidates: 2 };
    const input = [cand('v1', 'a'), cand('v2', 'b'), cand('v3', 'c'), cand('v4', 'd')];
    const result = await applyDomainFitSyncConsume(input, 'goal', cfg, cache);
    expect(result.reordered).toHaveLength(4);
    expect(result.reordered.slice(2).map((c) => c.youtubeVideoId)).toEqual(['v3', 'v4']);
    expect(cache.getManyMock).toHaveBeenCalledWith(['v1', 'v2']); // overflow never queried
  });
});

describe('createNoopDomainFitSyncConsumeCache', () => {
  it('getMany always returns an empty map; set() is a no-op', async () => {
    const cache = createNoopDomainFitSyncConsumeCache();
    await expect(cache.getMany(['v1'])).resolves.toEqual(new Map());
    await expect(cache.set('v1', {} as DomainFitServeCacheEntry)).resolves.toBeUndefined();
  });
});
