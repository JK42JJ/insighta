/**
 * Topic shaping for the weekly fresh leg.
 *
 * A curation subscription is one word. v5 was built for a mandala — a centre
 * plus sub-goals that each mean something different — so the shipped code
 * manufactured four labels by appending 최신/강의/사례 to the topic. Handed four
 * labels that barely differ, the query generator invents the difference, and on
 * prod "파이썬" came back as self-help channels.
 *
 * What matters here is not that shaping happens, but that it can never make
 * things worse than the labels it replaces. Every failure mode has to land back
 * on the suffix labels, because an empty or half-shaped week is a worse outcome
 * than the one we are trying to improve on.
 */

const genCalls: Array<{ goal: string }> = [];
let genImpl: () => Promise<unknown> = async () => {
  throw new Error('not configured');
};

jest.mock('../../src/modules/mandala/generator', () => ({
  generateMandalaWithQueries: (input: { goal: string }) => {
    genCalls.push({ goal: input.goal });
    return genImpl();
  },
}));

// The real config parses process.env at import time and there is no env setup
// file, so it is stubbed. Importing this module drags in the logger, prisma and
// discover-tracing, each reading a different branch at import time — hence the
// Proxy: unknown branches answer with an empty object so those reads see
// `undefined` (falsy) instead of throwing, and this stub does not have to
// enumerate a config tree it has no opinion about.
const shapingStub = { enabled: true };
jest.mock('../../src/config/index', () => {
  const known: Record<string, unknown> = {
    curationTopicShaping: shapingStub,
    paths: { logs: '/tmp' },
    app: { isProduction: false },
  };
  return {
    config: new Proxy(known, {
      get: (target, key: string) => (key in target ? target[key] : {}),
    }),
  };
});

import { shapeTopic, curationSubGoals } from '../../src/modules/curation/weekly-fresh';

function setShaping(enabled: boolean) {
  shapingStub.enabled = enabled;
}

const TOPIC = '파이썬';
const SUFFIX_LABELS = curationSubGoals(TOPIC);

function generated(subGoals: string[], queries: string[] | null, degraded = false) {
  return {
    structure: { sub_goals: subGoals },
    cellQueries: queries?.map((query, cellIndex) => ({ cellIndex, query })),
    meta: {
      degraded,
      latencyMs: 1,
      totalCells: subGoals.length,
      cellQueryCount: queries?.length ?? 0,
    },
  };
}

beforeEach(() => {
  genCalls.length = 0;
  setShaping(true);
});

describe('shapeTopic', () => {
  it('leaves the shipped behaviour byte-identical when the flag is off', async () => {
    setShaping(false);
    genImpl = async () => generated(['a', 'b'], ['qa', 'qb']);

    const shaped = await shapeTopic(TOPIC);

    expect(shaped.subGoals).toEqual(SUFFIX_LABELS);
    expect(shaped.precomputedQueries).toBeUndefined();
    expect(shaped.shaped).toBe(false);
    // The flag has to gate the CALL, not just the result: an off flag that
    // still pays for generation is not a rollback.
    expect(genCalls).toHaveLength(0);
  });

  it('hands v5 the real sub-goals and their queries when generation is clean', async () => {
    const subGoals = [
      '파이썬 문법 기초',
      '파이썬 자료구조',
      '파이썬 웹 개발',
      '파이썬 데이터 분석',
    ];
    const queries = [
      '파이썬 문법 강의',
      '파이썬 자료구조 설명',
      '파이썬 장고 튜토리얼',
      '파이썬 판다스',
    ];
    genImpl = async () => generated(subGoals, queries);

    const shaped = await shapeTopic(TOPIC);

    expect(shaped.subGoals).toEqual(subGoals);
    expect(shaped.precomputedQueries).toEqual(
      queries.map((query, cellIndex) => ({ cellIndex, query }))
    );
    expect(shaped.shaped).toBe(true);
    expect(genCalls).toEqual([{ goal: TOPIC }]);
  });

  it('falls back to the suffix labels when generation throws', async () => {
    genImpl = async () => {
      throw new Error('provider down');
    };

    const shaped = await shapeTopic(TOPIC);

    expect(shaped.subGoals).toEqual(SUFFIX_LABELS);
    expect(shaped.shaped).toBe(false);
  });

  it('keeps the sub-goals but drops partial queries rather than mixing generators', async () => {
    // Half the cells carrying our queries and half falling through to v5's own
    // generator is the collision this change exists to remove, so a short query
    // set is discarded even though the sub-goals themselves are fine.
    const subGoals = ['파이썬 문법 기초', '파이썬 자료구조', '파이썬 웹 개발'];
    genImpl = async () => generated(subGoals, ['only-one']);

    const shaped = await shapeTopic(TOPIC);

    expect(shaped.subGoals).toEqual(subGoals);
    expect(shaped.precomputedQueries).toBeUndefined();
    expect(shaped.shaped).toBe(true);
  });

  it('discards queries the generator itself reported as degraded', async () => {
    const subGoals = ['파이썬 문법 기초', '파이썬 자료구조'];
    genImpl = async () => generated(subGoals, ['q1', 'q2'], true);

    const shaped = await shapeTopic(TOPIC);

    expect(shaped.precomputedQueries).toBeUndefined();
  });

  it('falls back when the structure comes back too thin to be a spread', async () => {
    genImpl = async () => generated(['파이썬'], ['q1']);

    const shaped = await shapeTopic(TOPIC);

    expect(shaped.subGoals).toEqual(SUFFIX_LABELS);
    expect(shaped.shaped).toBe(false);
  });
});
