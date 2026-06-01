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

import { MS_PER_DAY } from '@/utils/time-constants';

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
  /**
   * External abort signal (e.g. a shared deadline across many probes). When it
   * fires, this probe aborts and fails open (probe_error → not-short). Lets a
   * caller bound TOTAL wall-clock regardless of how many probes run.
   */
  signal?: AbortSignal;
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
  // Link an external shared deadline: when it fires, abort this probe too.
  const ext = opts.signal;
  const onExt = (): void => controller.abort();
  if (ext) {
    if (ext.aborted) controller.abort();
    else ext.addEventListener('abort', onExt, { once: true });
  }
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
    // Timeout / network error / external-deadline abort — fail open.
    return { isShort: false, signal: SHORT_SIGNAL.PROBE_ERROR };
  } finally {
    clearTimeout(timer);
    if (ext) ext.removeEventListener('abort', onExt);
  }
}

// ── In-process result cache (CP491 step "v5-live gate") ──────────────────────
// Live add-cards/wizard videos are NOT in video_pool, so there is no DB column
// to cache against. A per-process Map dedupes repeat videos within a container's
// lifetime (restart = cold; acceptable). No Redis/schema/new write-path. If
// cross-container dedupe is later needed (rate-limit pressure), promote to Redis.
const CACHE_TTL_MS = MS_PER_DAY; // Short status doesn't change
const CACHE_MAX = 10_000; // soft cap; clear wholesale if exceeded
const _cache = new Map<string, { isShort: boolean; signal: ShortSignal; at: number }>();

/**
 * Memoized {@link isShort}. duration>=180 short-circuits (no HTTP, no cache).
 * probe_error results are NOT cached (left to retry). Honors opts.signal.
 */
export async function isShortCached(
  videoId: string,
  durationSec?: number | null,
  opts: IsShortOpts = {}
): Promise<ShortResult> {
  if (durationSec != null && durationSec >= SHORT_MAX_DURATION_SEC) {
    return { isShort: false, signal: SHORT_SIGNAL.DURATION_GE_180 };
  }
  const hit = _cache.get(videoId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { isShort: hit.isShort, signal: hit.signal };
  }
  const result = await isShort(videoId, durationSec, opts);
  if (result.signal !== SHORT_SIGNAL.PROBE_ERROR) {
    if (_cache.size >= CACHE_MAX) _cache.clear();
    _cache.set(videoId, { isShort: result.isShort, signal: result.signal, at: Date.now() });
  }
  return result;
}

/** Test helper — reset the in-process cache. */
export function resetShortCacheForTest(): void {
  _cache.clear();
}

/** Columns to merge into a video_pool create when gating Shorts (CP491). */
export interface ShortGateFields {
  is_short?: boolean;
  short_signal?: ShortSignal;
  short_probed_at?: Date;
  is_active?: boolean;
}

/**
 * Shared promote gate (CP491, step 4). Returns the video_pool columns to spread
 * into a `.create({ data })` so a Short is inserted DEMOTED (is_active=false,
 * preserved for audit/undo, excluded from search/pick) and a normal video is
 * tagged is_short=false. On probe_error: fail-open — returns {} (no tag,
 * is_active default true), leaving the row for the backfill to re-probe.
 * One implementation for all 4 promote paths — no per-path drift.
 */
export async function shortGateFields(
  videoId: string,
  durationSec?: number | null,
  opts: IsShortOpts = {}
): Promise<ShortGateFields> {
  const { isShort: short, signal } = await isShortCached(videoId, durationSec, opts);
  if (signal === SHORT_SIGNAL.PROBE_ERROR) return {};
  return {
    is_short: short,
    short_signal: signal,
    short_probed_at: new Date(),
    ...(short ? { is_active: false } : {}),
  };
}
