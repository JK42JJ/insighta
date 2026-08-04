/**
 * The build-level fit gate.
 *
 * Reported on 2026-08-04, on a subscription whose topic was "파이썬": guitar
 * chord practice, a makeup certification course, Spanish conversation, a
 * general-trivia audiobook. Sixteen of seventeen items came from the pool
 * ladder, which had no topic judgement of any kind — the gate lived inside the
 * fresh leg, so anything arriving by another route skipped it.
 *
 * What is pinned here is that the judge now sees every pick regardless of which
 * leg produced it, that an unjudged pick is dropped rather than admitted, and
 * that what survives is ordered by one scale instead of two.
 */
export {};

jest.mock('../../src/config/index', () => {
  const known: Record<string, unknown> = {
    paths: { logs: '/tmp' },
    app: { isProduction: false },
  };
  return {
    config: new Proxy(known, {
      get: (target, key: string) => (key in target ? target[key] : {}),
    }),
  };
});

const scores = new Map<string, { ok: boolean; relevancePct: number }>();
jest.mock('../../src/modules/relevance/compute-card-relevance', () => ({
  computeCardRelevance: (a: { videoId: string }) =>
    Promise.resolve(scores.get(a.videoId) ?? { ok: true, relevancePct: 100 }),
}));

const titles = new Map<string, string>();
jest.mock('../../src/modules/curation/pool-titles', () => ({
  getPoolTitles: () => Promise.resolve(titles),
}));

import { __testing } from '../../src/modules/queue/handlers/curation-build';
import { CURATION_RELEVANCE_FLOOR } from '../../src/modules/curation/config';

const gate = __testing.gateByFit;
const prisma = {} as never;
const pick = (videoId: string, relevancePct = 46) => ({ videoId, relevancePct });

beforeEach(() => {
  scores.clear();
  titles.clear();
});

describe('every leg is judged, not just the fresh one', () => {
  it('drops a pick the judge scores below the floor', async () => {
    titles.set('guitar', '기타코드 체인지가 어렵다면 이렇게 연습해 보세요');
    scores.set('guitar', { ok: true, relevancePct: CURATION_RELEVANCE_FLOOR - 1 });

    const out = await gate(prisma, '파이썬', [pick('guitar')]);

    expect(out).toEqual([]);
  });

  it('keeps a pick at or above the floor', async () => {
    titles.set('py', '파이썬 함수 def 문법 총정리');
    scores.set('py', { ok: true, relevancePct: CURATION_RELEVANCE_FLOOR });

    const out = await gate(prisma, '파이썬', [pick('py')]);

    expect(out.map((p) => p.videoId)).toEqual(['py']);
  });

  it('judges a pool pick even though it arrived with a cosine score', async () => {
    // The ladder wrote cosine x 100 into relevancePct; a high one must not
    // buy admission on its own.
    titles.set('spanish', '여행 스페인어회화 01강 - 기내에서');
    scores.set('spanish', { ok: true, relevancePct: 12 });

    const out = await gate(prisma, '파이썬', [pick('spanish', 99)]);

    expect(out).toEqual([]);
  });
});

describe('fail-closed', () => {
  it('drops a pick the judge could not score', async () => {
    titles.set('unknown', '무언가');
    scores.set('unknown', { ok: false, relevancePct: 0 });

    const out = await gate(prisma, '파이썬', [pick('unknown')]);

    expect(out).toEqual([]);
  });

  it('drops a pick with no pool row, which could not render anyway', async () => {
    const out = await gate(prisma, '파이썬', [pick('ghost')]);

    expect(out).toEqual([]);
  });

  it('returns an empty week rather than admitting anything unjudged', async () => {
    for (const id of ['a', 'b', 'c']) {
      titles.set(id, id);
      scores.set(id, { ok: false, relevancePct: 0 });
    }

    const out = await gate(prisma, '파이썬', ['a', 'b', 'c'].map((i) => pick(i)));

    expect(out).toEqual([]);
  });
});

describe('one scale', () => {
  it('stores the judge score, not whatever the leg carried in', async () => {
    titles.set('py', '파이썬 자료구조');
    scores.set('py', { ok: true, relevancePct: 87 });

    const out = await gate(prisma, '파이썬', [pick('py', 35)]);

    expect(out[0]?.relevancePct).toBe(87);
  });

  it('orders the week by that one scale', async () => {
    for (const [id, s] of [
      ['low', 55],
      ['high', 95],
      ['mid', 70],
    ] as Array<[string, number]>) {
      titles.set(id, id);
      scores.set(id, { ok: true, relevancePct: s });
    }

    const out = await gate(prisma, '파이썬', ['low', 'high', 'mid'].map((i) => pick(i)));

    expect(out.map((p) => p.videoId)).toEqual(['high', 'mid', 'low']);
  });
});

describe('nothing to do', () => {
  it('passes an empty pick list straight through', async () => {
    expect(await gate(prisma, '파이썬', [])).toEqual([]);
  });
});
