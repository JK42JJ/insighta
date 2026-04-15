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
  titleHitsBlocklist,
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
  test('isShortsByDuration', () => {
    expect(isShortsByDuration(30)).toBe(true);
    expect(isShortsByDuration(60)).toBe(true);
    expect(isShortsByDuration(61)).toBe(false);
    expect(isShortsByDuration(null)).toBe(false);
  });

  test('titleHitsBlocklist case-insensitive', () => {
    expect(titleHitsBlocklist('Best VLog of 2024')).toBe(true);
    expect(titleHitsBlocklist('드라마 클립')).toBe(true);
    expect(titleHitsBlocklist('Korean grammar lesson')).toBe(false);
  });
});
