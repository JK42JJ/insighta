/**
 * Collector keyword loading — domain scope, judge filter, column-over-metadata.
 *
 * Three things are pinned, each of which was a real gap:
 *
 *   The domain tag now comes from the `domain` COLUMN the P3 backfill filled,
 *   not from `metadata.seed_domain`. Those were two vocabularies — the column
 *   speaks CurationDomain ('policy'), the metadata speaks Korean buckets
 *   ('기술/개발') — so pool tags and weekly editions could not be joined.
 *
 *   Rows are restricted to judge_state='ok'. The judge rejects personal names,
 *   product models and vlog formats at collection time, and 27% unfit plus
 *   3.8% unsafe were being searched on anyway.
 *
 *   A run can be scoped to one edition, so the pilot measures one domain
 *   without spending quota on the other eight.
 */
export {};

// The real config parses process.env at import time and there is no env setup
// file. The module under test drags in the logger, which reads a different
// branch at import — hence the Proxy: unknown branches answer with an empty
// object instead of throwing, so this stub need not enumerate the config tree.
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

const queries: Array<Record<string, unknown>> = [];
let reply: Array<Record<string, unknown>> = [];

const db = {
  trend_signals: {
    findMany: (arg: Record<string, unknown>) => {
      queries.push(arg);
      return Promise.resolve(reply);
    },
  },
};

import { loadTrendKeywords } from '../../src/skills/plugins/batch-video-collector/sources/trend-source';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (limit: number, opts?: Record<string, unknown>) =>
  loadTrendKeywords(db as any, limit, opts as any);

/** The `where` clause the loader sent on the most recent call. */
function lastWhere(): Record<string, unknown> {
  return (queries[0]?.['where'] ?? {}) as Record<string, unknown>;
}

function row(over: Record<string, unknown> = {}) {
  return {
    keyword: 'kw',
    language: 'ko',
    norm_score: 1,
    source: 'youtube_suggest',
    metadata: {},
    domain: 'policy',
    ...over,
  };
}

beforeEach(() => {
  queries.length = 0;
  reply = [];
});

describe('domain scope', () => {
  it('asks for one domain when scoped', async () => {
    await load(10, { domain: 'policy' });
    expect(lastWhere()['domain']).toBe('policy');
  });

  it('leaves the query unscoped when no domain is given — shipped behaviour', async () => {
    await load(10);
    expect(lastWhere()['domain']).toBeUndefined();
  });
});

describe('judge filter', () => {
  it('only asks for keywords the judge passed', async () => {
    await load(10);
    expect(lastWhere()['judge_state']).toBe('ok');
  });

  it('applies the judge filter with or without a domain scope', async () => {
    await load(10, { domain: 'ai_ml' });
    expect(lastWhere()['judge_state']).toBe('ok');
  });
});

describe('domain comes from the column, not the metadata', () => {
  it('prefers the backfilled column', async () => {
    reply = [row({ domain: 'policy', metadata: { seed_domain: '기술/개발' } })];
    const out = await load(10);
    expect(out[0]?.domain).toBe('policy');
  });

  it('falls back to seed_domain when the column is null', async () => {
    reply = [row({ domain: null, metadata: { seed_domain: '기술/개발' } })];
    const out = await load(10);
    expect(out[0]?.domain).toBe('기술/개발');
  });

  it('falls back to general when neither is present', async () => {
    reply = [row({ domain: null, metadata: {} })];
    const out = await load(10);
    expect(out[0]?.domain).toBe('general');
  });
});

describe('existing behaviour is untouched', () => {
  it('dedupes by keyword and language, highest score first', async () => {
    reply = [
      row({ keyword: 'AI', norm_score: 0.9 }),
      row({ keyword: 'ai', norm_score: 0.4 }),
      row({ keyword: 'ai', language: 'en', norm_score: 0.3 }),
    ];
    const out = await load(10);
    expect(out).toHaveLength(2);
    expect(out[0]?.score).toBe(0.9);
  });

  it('slices by offset for rotation', async () => {
    reply = ['a', 'b', 'c', 'd'].map((k) => row({ keyword: k }));
    const out = await load(2, { offset: 2 });
    expect(out.map((k) => k.keyword)).toEqual(['c', 'd']);
  });
});
