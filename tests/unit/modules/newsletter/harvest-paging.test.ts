/**
 * Layer 2 took one page per query and threw the rest away.
 *
 * Measured against the live API on 2026-09-16: "coding agent" inside the
 * 7-day window returns a full 50 on each of five pages, 250 distinct ids, no
 * repeat, and still offers a sixth. The 09-02 run took 40 calls and came back
 * with 725 videos because it stopped at the first page of each. The Korean
 * queries are the opposite case -- 0 to 6 results and no page token -- so the
 * loop has to end on the token, not on the count.
 *
 * These tests fail if paging is removed, if it ignores the cap, or if it keeps
 * calling a query that has no more pages.
 */

import { harvestSearch, type FetchLike } from '@/modules/newsletter/harvest';
import type { TopicDefinition } from '@/modules/newsletter/topics/ai-tech';

const BASE: TopicDefinition = {
  categoryKey: 'ai-tech',
  videoCategoryIds: [28],
  publishedWithinDays: 7,
  order: 'date',
  queries: { ko: [], en: ['coding agent'] },
  exclude: [],
};

/** A page of `n` items, with a token unless this is the last page. */
function page(n: number, idPrefix: string, next?: string): Record<string, unknown> {
  return {
    items: Array.from({ length: n }, (_, i) => ({
      id: { videoId: `${idPrefix}${i}` },
      snippet: {
        title: `t${idPrefix}${i}`,
        channelId: 'c1',
        channelTitle: 'ch',
        publishedAt: '2026-09-15T00:00:00Z',
      },
    })),
    ...(next ? { nextPageToken: next } : {}),
  };
}

/** Records the pageToken of every call so the test can assert the cursor moved. */
function fetcher(pages: Array<Record<string, unknown>>): {
  impl: FetchLike;
  tokens: Array<string | null>;
} {
  const tokens: Array<string | null> = [];
  let i = 0;
  const impl = (async (url: string) => {
    tokens.push(new URL(url).searchParams.get('pageToken'));
    const body = pages[Math.min(i, pages.length - 1)] ?? { items: [] };
    i += 1;
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }) as unknown as FetchLike;
  return { impl, tokens };
}

describe('harvestSearch paging', () => {
  it('follows the page token up to the cap and keeps every result', async () => {
    const { impl, tokens } = fetcher([
      page(50, 'a', 'T2'),
      page(50, 'b', 'T3'),
      page(50, 'c', 'T4'),
      page(50, 'd'),
    ]);
    const r = await harvestSearch({ ...BASE, maxPagesPerQuery: 5 }, new Date(), ['k'], impl);

    expect(r.calls).toBe(4);
    expect(r.videos).toHaveLength(200);
    expect(new Set(r.videos.map((v) => v.videoId)).size).toBe(200);
    // First call carries no cursor; each later one carries the previous token.
    expect(tokens).toEqual([null, 'T2', 'T3', 'T4']);
    expect(r.units).toBe(400);
  });

  it('stops at the cap even when more pages are offered', async () => {
    const { impl } = fetcher([page(50, 'a', 'T'), page(50, 'b', 'T'), page(50, 'c', 'T')]);
    const r = await harvestSearch({ ...BASE, maxPagesPerQuery: 2 }, new Date(), ['k'], impl);

    expect(r.calls).toBe(2);
    expect(r.videos).toHaveLength(100);
  });

  it('spends one call on a query that has no second page', async () => {
    // The Korean case. Paging must cost nothing where there is nothing to page.
    const { impl } = fetcher([page(3, 'ko')]);
    const r = await harvestSearch({ ...BASE, maxPagesPerQuery: 5 }, new Date(), ['k'], impl);

    expect(r.calls).toBe(1);
    expect(r.units).toBe(100);
    expect(r.videos).toHaveLength(3);
  });

  it('defaults to the old single-page behaviour when the topic sets no cap', async () => {
    const { impl } = fetcher([page(50, 'a', 'T2'), page(50, 'b', 'T3')]);
    const r = await harvestSearch(BASE, new Date(), ['k'], impl);

    expect(r.calls).toBe(1);
    expect(r.videos).toHaveLength(50);
  });

  it('abandons the cursor when a page fails and does not spin on it', async () => {
    let n = 0;
    const impl = (async () => {
      n += 1;
      if (n === 2) throw new Error('quotaExceeded');
      return {
        ok: true,
        status: 200,
        json: async () => page(50, 'a', 'T2'),
      } as unknown as Response;
    }) as unknown as FetchLike;

    const r = await harvestSearch({ ...BASE, maxPagesPerQuery: 5 }, new Date(), ['k1', 'k2'], impl);

    expect(r.calls).toBe(2);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain('coding agent');
  });

  it('spreads calls across every key instead of draining the first', async () => {
    // The keys are separate Google projects with separate daily quotas.
    // Rotating only on failure put all 57 calls of the 2026-09-16 run on key
    // one and left it exhausted while seven others sat unused.
    const keys: string[] = [];
    const impl = (async (url: string) => {
      keys.push(new URL(url).searchParams.get('key') ?? '');
      return {
        ok: true,
        status: 200,
        json: async () => page(50, 'a', 'T'),
      } as unknown as Response;
    }) as unknown as FetchLike;

    await harvestSearch({ ...BASE, maxPagesPerQuery: 4 }, new Date(), ['k1', 'k2', 'k3'], impl);

    expect(keys).toEqual(['k1', 'k2', 'k3', 'k1']);
    expect(new Set(keys).size).toBe(3);
  });
});
