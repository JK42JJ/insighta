/**
 * Unit tests for Google CSE client.
 *
 * Uses jest mock for global fetch — no real HTTP calls.
 */

import { createGoogleCseClient } from '@/modules/google-cse/client';
import type { GoogleCseConfig } from '@/modules/google-cse/config';

const enabledConfig: GoogleCseConfig = {
  apiKey: 'test-api-key',
  cx: 'test-cx-id',
  enabled: true,
};

const disabledConfig: GoogleCseConfig = {
  apiKey: '',
  cx: '',
  enabled: false,
};

/** Minimal CSE API response matching real shape. */
function makeCseResponse(
  items: Array<{ title: string; link: string; snippet: string; displayLink: string }>,
  totalResults = 100
) {
  return {
    searchInformation: { totalResults: String(totalResults) },
    items,
  };
}

describe('createGoogleCseClient', () => {
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('when config.enabled is false', () => {
    it('returns empty result without calling fetch', async () => {
      const client = createGoogleCseClient(disabledConfig);
      const result = await client.searchWeb('any query');

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.items).toHaveLength(0);
      expect(result.totalResults).toBe(0);
      expect(result.error).toBe('google-cse not configured');
    });
  });

  describe('when config.enabled is true', () => {
    it('calls CSE API with correct URL params and maps items', async () => {
      const fakeItems = [
        {
          title: 'Test Title',
          link: 'https://example.com',
          snippet: 'A snippet',
          displayLink: 'example.com',
        },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeCseResponse(fakeItems, 42),
      } as Response);

      const client = createGoogleCseClient(enabledConfig);
      const result = await client.searchWeb('KBO draft', { num: 5 });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = new URL(mockFetch.mock.calls[0]![0] as string);
      expect(calledUrl.searchParams.get('key')).toBe('test-api-key');
      expect(calledUrl.searchParams.get('cx')).toBe('test-cx-id');
      expect(calledUrl.searchParams.get('q')).toBe('KBO draft');
      expect(calledUrl.searchParams.get('num')).toBe('5');

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.title).toBe('Test Title');
      expect(result.items[0]!.link).toBe('https://example.com');
      expect(result.totalResults).toBe(42);
      expect(result.error).toBeUndefined();
    });

    it('caps num at 10 (CSE hard limit)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeCseResponse([]),
      } as Response);

      const client = createGoogleCseClient(enabledConfig);
      await client.searchWeb('test', { num: 50 });

      const calledUrl = new URL(mockFetch.mock.calls[0]![0] as string);
      expect(calledUrl.searchParams.get('num')).toBe('10');
    });

    it('returns graceful error on HTTP 400 without retrying', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      } as Response);

      const client = createGoogleCseClient(enabledConfig);
      const result = await client.searchWeb('test');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.items).toHaveLength(0);
      expect(result.error).toBe('CSE API HTTP 400');
    });

    it('retries once on HTTP 500 then returns error', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'server error',
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'server error',
        } as Response);

      const client = createGoogleCseClient(enabledConfig);
      const result = await client.searchWeb('test');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.error).toBe('CSE API HTTP 500');
    });

    it('returns graceful error when fetch throws (network error)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network failure'));
      mockFetch.mockRejectedValueOnce(new Error('network failure'));

      const client = createGoogleCseClient(enabledConfig);
      const result = await client.searchWeb('test');

      expect(result.items).toHaveLength(0);
      expect(result.error).toBe('network failure');
    });

    it('handles missing items array gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ searchInformation: { totalResults: '0' } }),
      } as Response);

      const client = createGoogleCseClient(enabledConfig);
      const result = await client.searchWeb('obscure query with no results');

      expect(result.items).toHaveLength(0);
      expect(result.totalResults).toBe(0);
      expect(result.error).toBeUndefined();
    });
  });
});
