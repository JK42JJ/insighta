/**
 * Shared YouTube Shorts detector (CP491, step 2/5).
 *
 * Single source of truth for "is this video a Short?" — called by the async
 * probe module (step 3) and every video_pool promote gate (step 4). One
 * implementation, N callers: no per-path drift, no missed gate.
 *
 * Method: `GET https://www.youtube.com/shorts/<id>` with manual redirect.
 *   - 200            → it IS a Short (the /shorts/ page serves it).
 *   - 3xx → /watch   → NOT a Short (YouTube redirects regular videos).
 *   This is YouTube's own authoritative classification (validated on 54
 *   samples, 100% clean separation). No thumbnail/pixel/vision needed.
 *
 * Optimization: a Short cannot exceed YouTube's 180s cap, so when a known
 * duration >= 180s is supplied we return false WITHOUT an HTTP probe.
 *
 * Fail-open: probe errors (timeout/network/unexpected status) return
 * { isShort: false, signal: 'probe_error' } so a flaky probe never blocks a
 * legitimate video. The caller leaves such rows unprobed for a later retry;
 * a Short that slips through is corrected by demotion, not lost.
 *
 * The returned `signal` strings ARE the values written to
 * `video_pool.short_signal` (varchar 30) — keep this vocabulary single-source.
 */

/** Vocabulary shared with `video_pool.short_signal`. Do not diverge. */
export const SHORT_SIGNAL = {
  URL_REDIRECT: 'shorts_url_redirect',
  DURATION_GE_180: 'duration_ge_180',
  PROBE_ERROR: 'probe_error',
} as const;

export type ShortSignal = (typeof SHORT_SIGNAL)[keyof typeof SHORT_SIGNAL];

export interface ShortResult {
  isShort: boolean;
  signal: ShortSignal;
}

/** Shorts cannot exceed this (YouTube cap). >= this → definitely not a Short. */
export const SHORT_MAX_DURATION_SEC = 180;

const DEFAULT_TIMEOUT_MS = 8000;
const SHORTS_URL = (videoId: string): string =>
  `https://www.youtube.com/shorts/${encodeURIComponent(videoId)}`;

export interface IsShortOpts {
  /** Inject fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Per-probe timeout. Default 8s. */
  timeoutMs?: number;
}

/**
 * Probe whether `videoId` is a YouTube Short. Pure (no DB). `durationSec`,
 * when known and >= 180, short-circuits to false with no HTTP call.
 */
export async function isShort(
  videoId: string,
  durationSec?: number | null,
  opts: IsShortOpts = {}
): Promise<ShortResult> {
  if (durationSec != null && durationSec >= SHORT_MAX_DURATION_SEC) {
    return { isShort: false, signal: SHORT_SIGNAL.DURATION_GE_180 };
  }

  const fetchFn = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchFn(SHORTS_URL(videoId), {
      method: 'GET',
      redirect: 'manual', // 3xx (regular video) must NOT auto-follow to /watch
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InsightaBot/1.0)' },
    });
    if (res.status === 200) {
      return { isShort: true, signal: SHORT_SIGNAL.URL_REDIRECT };
    }
    if (res.status >= 300 && res.status < 400) {
      // Redirect to /watch — a regular video, not a Short.
      return { isShort: false, signal: SHORT_SIGNAL.URL_REDIRECT };
    }
    // Unexpected status (404/5xx/etc) — fail open, leave for retry.
    return { isShort: false, signal: SHORT_SIGNAL.PROBE_ERROR };
  } catch {
    // Timeout / network error — fail open.
    return { isShort: false, signal: SHORT_SIGNAL.PROBE_ERROR };
  } finally {
    clearTimeout(timer);
  }
}
