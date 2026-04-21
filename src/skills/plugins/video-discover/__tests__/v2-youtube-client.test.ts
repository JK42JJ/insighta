/**
 * v2 youtube-client — unit tests
 *
 * Mocks fetch. Verifies (a) server API key always goes in `key=` query param,
 * (b) OAuth Bearer header is NEVER sent, (c) duration parser + filters.
 */

import {
  searchVideos,
  videosBatch,
  parseIsoDuration,
  isShortsByDuration,
  titleIndicatesShorts,
  titleHitsBlocklist,
  resolveSearchApiKeys,
} from '../v2/youtube-client';

describe('searchVideos — auth contract', () => {
  test('throws if apiKey missing (no OAuth fallback)', async () => {
    await expect(
      searchVideos({
        query: 'x',
        apiKey: '',
        fetchFn: (() => {
          throw new Error('should not be called');
        }) as unknown as typeof fetch,
      })
    ).rejects.toThrow(/server API key is required/);
  });

  test('puts apiKey in query string and never sends Bearer header', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> | undefined;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = (init?.headers as Record<string, string>) ?? undefined;
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      } as Response;
    }) as unknown as typeof fetch;
    await searchVideos({
      query: 'learning korean',
      apiKey: 'TEST_KEY',
      relevanceLanguage: 'ko',
      regionCode: 'KR',
      fetchFn,
    });
    expect(capturedUrl).toContain('key=TEST_KEY');
    expect(capturedUrl).toContain('q=learning+korean');
    expect(capturedUrl).toContain('relevanceLanguage=ko');
    // No Authorization header — v2 must never use OAuth
    const authHeader = capturedHeaders?.['Authorization'] ?? capturedHeaders?.['authorization'];
    expect(authHeader).toBeUndefined();
  });
});

describe('videosBatch — auth + chunking', () => {
  test('chunks ids in 50-id calls', async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ items: [] }) } as Response;
    }) as unknown as typeof fetch;
    const ids = Array.from({ length: 75 }, (_, i) => `id${i}`);
    await videosBatch({ videoIds: ids, apiKey: 'K', fetchFn });
    expect(calls.length).toBe(2); // 50 + 25
    for (const c of calls) {
      expect(c).toContain('key=K');
    }
  });

  test('returns empty without network when ids empty', async () => {
    let called = 0;
    const fetchFn = (async () => {
      called++;
      return {} as Response;
    }) as unknown as typeof fetch;
    const out = await videosBatch({ videoIds: [], apiKey: 'K', fetchFn });
    expect(called).toBe(0);
    expect(out).toEqual([]);
  });
});

describe('parseIsoDuration', () => {
  test.each([
    ['PT1M', 60],
    ['PT1H', 3600],
    ['PT1H2M3S', 3723],
    ['PT45S', 45],
  ])('%s → %d', (iso, sec) => {
    expect(parseIsoDuration(iso)).toBe(sec);
  });

  test('null on garbage', () => {
    expect(parseIsoDuration(null)).toBeNull();
    expect(parseIsoDuration('')).toBeNull();
    expect(parseIsoDuration('garbage')).toBeNull();
    expect(parseIsoDuration('PT')).toBeNull();
  });
});

describe('filters', () => {
  test('isShortsByDuration — duration-based (180s threshold per 2024 YouTube policy)', () => {
    expect(isShortsByDuration(30)).toBe(true);
    expect(isShortsByDuration(60)).toBe(true);
    // Prod bug 2026-04-17: 110s video "한의대수석으로 만들어준 공부법
    // #공부" slipped past the old 60s gate because YouTube widened Shorts
    // from 60s to 180s in October 2024. Now caught.
    expect(isShortsByDuration(110)).toBe(true);
    expect(isShortsByDuration(180)).toBe(true);
    expect(isShortsByDuration(181)).toBe(false);
    expect(isShortsByDuration(600)).toBe(false);
  });

  test('isShortsByDuration — null defensively treated as shorts', () => {
    // Prod bug 2026-04-16: `videos.list` sometimes returns an item
    // without contentDetails.duration, so `parseIsoDuration` yields
    // null. Previously this returned false (= "not shorts") and let
    // a shorts video surface in a habit-building mandala. The safe
    // answer when we cannot confirm long-form is to drop.
    expect(isShortsByDuration(null)).toBe(true);
  });

  test('titleIndicatesShorts — hashtag markers only', () => {
    expect(titleIndicatesShorts('더 이상 구입하지 않는 물건 3가지 #shorts')).toBe(true);
    expect(titleIndicatesShorts('Study routine #Shorts #미니멀라이프')).toBe(true);
    expect(titleIndicatesShorts('【shorts】 1분 스트레칭')).toBe(true);
    expect(titleIndicatesShorts('「shorts」 tips')).toBe(true);
  });

  test('titleIndicatesShorts — does NOT match the plain word "short"', () => {
    // Avoid false-positives on normal titles that happen to contain
    // "short" as a word (e.g. "short book review"). Only true shorts
    // hashtags/brackets count.
    expect(titleIndicatesShorts('A short book review')).toBe(false);
    expect(titleIndicatesShorts('short film director interview')).toBe(false);
    expect(titleIndicatesShorts('')).toBe(false);
  });

  test('titleHitsBlocklist case-insensitive', () => {
    expect(titleHitsBlocklist('Best VLog of 2024')).toBe(true);
    expect(titleHitsBlocklist('드라마 클립')).toBe(true);
    expect(titleHitsBlocklist('Korean grammar lesson')).toBe(false);
  });
});

describe('resolveSearchApiKeys — env ordering', () => {
  test('returns primary/secondary/tertiary in order', () => {
    expect(
      resolveSearchApiKeys({
        YOUTUBE_API_KEY_SEARCH: 'k1',
        YOUTUBE_API_KEY_SEARCH_2: 'k2',
        YOUTUBE_API_KEY_SEARCH_3: 'k3',
      })
    ).toEqual(['k1', 'k2', 'k3']);
  });

  test('skips empty/whitespace keys', () => {
    expect(
      resolveSearchApiKeys({
        YOUTUBE_API_KEY_SEARCH: 'k1',
        YOUTUBE_API_KEY_SEARCH_2: '   ',
        YOUTUBE_API_KEY_SEARCH_3: 'k3',
      })
    ).toEqual(['k1', 'k3']);
  });

  test('falls back to legacy YOUTUBE_API_KEY when no SEARCH_ keys', () => {
    expect(resolveSearchApiKeys({ YOUTUBE_API_KEY: 'legacy' })).toEqual(['legacy']);
  });

  test('returns empty array when nothing is configured', () => {
    expect(resolveSearchApiKeys({})).toEqual([]);
  });
});

describe('searchVideos — key rotation on 403 quota', () => {
  test('falls over to next key when primary returns 403 quotaExceeded', async () => {
    let call = 0;
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(url);
      call++;
      if (call === 1) {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            error: { code: 403, message: 'Daily Limit Exceeded. quotaExceeded.' },
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [{ id: { videoId: 'v1' }, snippet: { title: 't' } }] }),
      } as Response;
    }) as unknown as typeof fetch;

    const items = await searchVideos({
      query: 'korean',
      apiKey: ['KEY1', 'KEY2'],
      fetchFn,
    });
    expect(items.length).toBe(1);
    expect(urls[0]).toContain('key=KEY1');
    expect(urls[1]).toContain('key=KEY2');
  });

  test('does NOT rotate on non-quota 403 (e.g., referer blocked)', async () => {
    let call = 0;
    const fetchFn = (async () => {
      call++;
      return {
        ok: false,
        status: 403,
        json: async () => ({
          error: { code: 403, message: 'Requests from referer <empty> are blocked.' },
        }),
      } as Response;
    }) as unknown as typeof fetch;

    await expect(searchVideos({ query: 'x', apiKey: ['KEY1', 'KEY2'], fetchFn })).rejects.toThrow(
      /referer/
    );
    // Only one call — did not rotate
    expect(call).toBe(1);
  });

  test('throws if all keys quota-exhausted', async () => {
    const fetchFn = (async () => {
      return {
        ok: false,
        status: 403,
        json: async () => ({
          error: { code: 403, message: 'quotaExceeded' },
        }),
      } as Response;
    }) as unknown as typeof fetch;

    await expect(searchVideos({ query: 'x', apiKey: ['A', 'B', 'C'], fetchFn })).rejects.toThrow(
      /quota/
    );
  });
});

describe('searchVideos — timeout (Phase 1 slice 1)', () => {
  test('aborts when fetch exceeds timeoutMs → throws "search.list timeout"', async () => {
    // Slow fetch that respects AbortSignal — simulates a genuine
    // network tail. When the controller aborts, reject with the
    // DOMException-shaped error that `fetch` surfaces in real code.
    const fetchFn = ((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (signal) {
          const onAbort = () => {
            const err = new Error('The operation was aborted.');
            (err as Error & { name: string }).name = 'AbortError';
            reject(err);
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        }
        // Never resolves on its own — only abort finishes this promise.
      });
    }) as unknown as typeof fetch;

    const start = Date.now();
    await expect(searchVideos({ query: 'x', apiKey: 'K', fetchFn, timeoutMs: 50 })).rejects.toThrow(
      /search\.list timeout after 50ms/
    );
    const elapsed = Date.now() - start;
    // Generous upper bound — CI runners can jitter. Main assertion is
    // "didn't hang forever".
    expect(elapsed).toBeLessThan(2000);
  });

  test('omitting timeoutMs → legacy behavior (no AbortController created)', async () => {
    let sawSignal = false;
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      if (init?.signal) sawSignal = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      } as Response;
    }) as unknown as typeof fetch;
    await searchVideos({ query: 'x', apiKey: 'K', fetchFn });
    expect(sawSignal).toBe(false);
  });

  test('timeoutMs=0 → treated as no-timeout (falsy branch)', async () => {
    let sawSignal = false;
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      if (init?.signal) sawSignal = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      } as Response;
    }) as unknown as typeof fetch;
    await searchVideos({ query: 'x', apiKey: 'K', fetchFn, timeoutMs: 0 });
    expect(sawSignal).toBe(false);
  });

  test('fast fetch before timeout → resolves normally, no timeout error', async () => {
    const fetchFn = (async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [{ id: { videoId: 'abc' } }] }),
      } as Response;
    }) as unknown as typeof fetch;
    const items = await searchVideos({
      query: 'x',
      apiKey: 'K',
      fetchFn,
      timeoutMs: 5000,
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.id?.videoId).toBe('abc');
  });
});
