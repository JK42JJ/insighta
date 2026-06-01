/**
 * isShort() — CP491 step 2. Shorts detector, fetch mocked (no external calls).
 */
import { isShort, SHORT_SIGNAL } from '@/modules/video-pool/is-short';

function mockFetch(status: number): typeof fetch {
  return (async () => ({ status }) as Response) as unknown as typeof fetch;
}

describe('isShort', () => {
  test('200 from /shorts/ → Short', async () => {
    const r = await isShort('vid200', undefined, { fetchImpl: mockFetch(200) });
    expect(r).toEqual({ isShort: true, signal: SHORT_SIGNAL.URL_REDIRECT });
  });

  test('303 (redirect to /watch) → not a Short', async () => {
    const r = await isShort('vid303', undefined, { fetchImpl: mockFetch(303) });
    expect(r).toEqual({ isShort: false, signal: SHORT_SIGNAL.URL_REDIRECT });
  });

  test('fetch throws (timeout/network) → fail-open, probe_error', async () => {
    const throwing = (async () => {
      throw new Error('aborted');
    }) as unknown as typeof fetch;
    const r = await isShort('vidErr', undefined, { fetchImpl: throwing });
    expect(r).toEqual({ isShort: false, signal: SHORT_SIGNAL.PROBE_ERROR });
  });

  test('durationSec >= 180 → no HTTP, duration_ge_180', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return { status: 200 } as Response;
    }) as unknown as typeof fetch;
    const r = await isShort('vidLong', 300, { fetchImpl: spy });
    expect(called).toBe(false);
    expect(r).toEqual({ isShort: false, signal: SHORT_SIGNAL.DURATION_GE_180 });
  });

  test('unexpected status (404) → fail-open, probe_error', async () => {
    const r = await isShort('vid404', undefined, { fetchImpl: mockFetch(404) });
    expect(r).toEqual({ isShort: false, signal: SHORT_SIGNAL.PROBE_ERROR });
  });
});
