/**
 * video-discover v2 — minimal YouTube client
 *
 * Server-API-key only (NO OAuth). Two operations:
 *   - search.list (q, maxResults, type=video, optional language/region)
 *   - videos.list (id list, statistics + contentDetails)
 *
 * Helpers are intentionally separate from v1's executor.ts to keep v2
 * isolated. v1 stays untouched (rollback path).
 */

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

export const VIDEOS_LIST_MAX_IDS_PER_CALL = 50;
export const SEARCH_MAX_RESULTS = 50;

export interface YouTubeSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    channelId?: string;
    publishedAt?: string;
    thumbnails?: { high?: { url?: string } };
  };
}

interface YouTubeSearchResponse {
  items?: YouTubeSearchItem[];
  error?: { code: number; message: string };
}

export interface YouTubeVideoStatsItem {
  id?: string;
  statistics?: {
    viewCount?: string;
    likeCount?: string;
  };
  contentDetails?: { duration?: string };
}

interface YouTubeVideosResponse {
  items?: YouTubeVideoStatsItem[];
  error?: { code: number; message: string };
}

/**
 * Full metadata response shape (CP437) — videos.list with
 * parts=snippet,contentDetails,statistics,topicDetails.
 *
 * Spec note (2026-04-29 user directive): we collect commentCount (numeric
 * quality signal) but never call commentThreads.list / comments.list.
 * Comment text / pinned comments are out of scope; transcript path
 * (rich-summary v2) is the canonical text source.
 */
export interface YouTubeVideoFullMetadata {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    channelId?: string;
    publishedAt?: string;
    thumbnails?: {
      high?: { url?: string };
      standard?: { url?: string };
      default?: { url?: string };
    };
    tags?: string[];
    defaultLanguage?: string;
    defaultAudioLanguage?: string;
  };
  contentDetails?: {
    duration?: string;
    caption?: string;
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
  topicDetails?: {
    topicCategories?: string[];
  };
}

interface YouTubeVideosFullResponse {
  items?: YouTubeVideoFullMetadata[];
  error?: { code: number; message: string };
}

export interface SearchOpts {
  query: string;
  /**
   * One or more API keys. When multiple are provided, any 403 error containing
   * "quota" / "exceeded" triggers failover to the next key. Legacy single-key
   * callers may pass a string; rotation is then a no-op for that call.
   */
  apiKey: string | string[];
  maxResults?: number;
  relevanceLanguage?: string;
  regionCode?: string;
  /** ISO timestamp; results limited to videos published after. Optional. */
  publishedAfter?: string;
  fetchFn?: typeof fetch;
  /**
   * Per-call timeout in milliseconds. When set, the underlying fetch is
   * aborted once the timeout elapses and an Error with message starting
   * with "search.list timeout" is thrown. Callers using
   * `Promise.allSettled` treat this as a partial-result signal (empty
   * items for the timed-out query) rather than a pipeline failure.
   * Unset / 0 → no timeout (legacy behavior).
   */
  timeoutMs?: number;
  /** YouTube search order. Default (undefined) = 'relevance'. */
  order?: 'relevance' | 'viewCount' | 'date';
}

const MAX_SEARCH_KEY_SLOTS = 10;

/**
 * Resolve API keys from env, preserving insertion order:
 *   YOUTUBE_API_KEY_SEARCH    (slot 1)
 *   YOUTUBE_API_KEY_SEARCH_2  (slot 2)
 *   …
 *   YOUTUBE_API_KEY_SEARCH_N  (up to MAX_SEARCH_KEY_SLOTS)
 * Falls back to YOUTUBE_API_KEY when no SEARCH_ keys are present (legacy).
 */
export function resolveSearchApiKeys(env: Readonly<Record<string, string | undefined>>): string[] {
  const keys: string[] = [];
  const primary = env['YOUTUBE_API_KEY_SEARCH']?.trim();
  if (primary) keys.push(primary);
  for (let i = 2; i <= MAX_SEARCH_KEY_SLOTS; i++) {
    const k = env[`YOUTUBE_API_KEY_SEARCH_${i}`]?.trim();
    if (k) keys.push(k);
  }
  if (keys.length === 0) {
    const legacy = env['YOUTUBE_API_KEY']?.trim();
    if (legacy) keys.push(legacy);
  }
  return keys;
}

/** Heuristic: is this error a YouTube quota/quotaExceeded signal worth rotating on? */
function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg.includes('search.list HTTP 403')) return false;
  return msg.includes('quota') || msg.includes('exceeded') || msg.includes('quotaExceeded');
}

async function searchVideosOne(
  apiKey: string,
  opts: Omit<SearchOpts, 'apiKey'>
): Promise<YouTubeSearchItem[]> {
  const url = new URL(`${YOUTUBE_API_BASE}/search`);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('q', opts.query);
  url.searchParams.set('maxResults', String(opts.maxResults ?? SEARCH_MAX_RESULTS));
  url.searchParams.set('key', apiKey);
  if (opts.relevanceLanguage) {
    url.searchParams.set('relevanceLanguage', opts.relevanceLanguage);
  }
  if (opts.regionCode) {
    url.searchParams.set('regionCode', opts.regionCode);
  }
  if (opts.publishedAfter) {
    url.searchParams.set('publishedAfter', opts.publishedAfter);
  }
  if (opts.order && opts.order !== 'relevance') {
    url.searchParams.set('order', opts.order);
  }
  url.searchParams.set('safeSearch', 'moderate');

  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs;
  const controller = typeof timeoutMs === 'number' && timeoutMs > 0 ? new AbortController() : null;
  const timer =
    controller && typeof timeoutMs === 'number' && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
  let res: Response;
  try {
    res = await fetchFn(url.toString(), controller ? { signal: controller.signal } : {});
  } catch (err) {
    if (
      controller?.signal.aborted ||
      (err instanceof Error && (err.name === 'AbortError' || /aborted|abort/i.test(err.message)))
    ) {
      throw new Error(`search.list timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!res.ok) {
    let msg = '';
    try {
      const body = (await res.json()) as YouTubeSearchResponse;
      msg = body.error?.message ?? '';
    } catch {
      // ignore
    }
    throw new Error(`search.list HTTP ${res.status}${msg ? ` — ${msg}` : ''}`);
  }
  const body = (await res.json()) as YouTubeSearchResponse;
  if (body.error) throw new Error(`search.list error: ${body.error.message}`);
  return body.items ?? [];
}

export async function searchVideos(opts: SearchOpts): Promise<YouTubeSearchItem[]> {
  const keys = Array.isArray(opts.apiKey) ? opts.apiKey : [opts.apiKey];
  if (keys.length === 0 || keys.every((k) => !k)) {
    throw new Error('searchVideos: server API key is required (v2 does not accept OAuth)');
  }
  let lastErr: unknown = null;
  for (const key of keys) {
    if (!key) continue;
    try {
      return await searchVideosOne(key, opts);
    } catch (err) {
      lastErr = err;
      if (!isQuotaError(err)) {
        throw err; // non-quota errors are terminal
      }
      // quota: try next key
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface VideosBatchOpts {
  videoIds: string[];
  /** Single key or ordered failover list (see SearchOpts.apiKey). */
  apiKey: string | string[];
  fetchFn?: typeof fetch;
}

function isVideosBatchQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg.includes('videos.list HTTP 403')) return false;
  return msg.includes('quota') || msg.includes('exceeded') || msg.includes('quotaExceeded');
}

export async function videosBatch(opts: VideosBatchOpts): Promise<YouTubeVideoStatsItem[]> {
  if (opts.videoIds.length === 0) return [];
  const keys = Array.isArray(opts.apiKey) ? opts.apiKey : [opts.apiKey];
  if (keys.length === 0 || keys.every((k) => !k)) {
    throw new Error('videosBatch: server API key is required (v2 does not accept OAuth)');
  }
  const chunks: string[][] = [];
  for (let i = 0; i < opts.videoIds.length; i += VIDEOS_LIST_MAX_IDS_PER_CALL) {
    chunks.push(opts.videoIds.slice(i, i + VIDEOS_LIST_MAX_IDS_PER_CALL));
  }
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      let lastErr: unknown = null;
      for (const key of keys) {
        if (!key) continue;
        try {
          return await videosBatchSingle(chunk, key, opts.fetchFn);
        } catch (err) {
          lastErr = err;
          if (!isVideosBatchQuotaError(err)) throw err;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    })
  );
  return results.flat();
}

async function videosBatchSingle(
  videoIds: string[],
  apiKey: string,
  fetchFn?: typeof fetch
): Promise<YouTubeVideoStatsItem[]> {
  const url = new URL(`${YOUTUBE_API_BASE}/videos`);
  url.searchParams.set('part', 'statistics,contentDetails');
  url.searchParams.set('id', videoIds.join(','));
  url.searchParams.set('key', apiKey);

  const f = fetchFn ?? fetch;
  const res = await f(url.toString());
  if (!res.ok) {
    let msg = '';
    try {
      const body = (await res.json()) as YouTubeVideosResponse;
      msg = body.error?.message ?? '';
    } catch {
      // ignore
    }
    throw new Error(`videos.list HTTP ${res.status}${msg ? ` — ${msg}` : ''}`);
  }
  const body = (await res.json()) as YouTubeVideosResponse;
  if (body.error) throw new Error(`videos.list error: ${body.error.message}`);
  return body.items ?? [];
}

// ============================================================================
// Full-metadata batch (CP437) — backfill cron uses this
// ============================================================================

export interface VideosBatchFullOpts {
  videoIds: string[];
  apiKey: string | string[];
  fetchFn?: typeof fetch;
}

export async function videosBatchFullMetadata(
  opts: VideosBatchFullOpts
): Promise<YouTubeVideoFullMetadata[]> {
  if (opts.videoIds.length === 0) return [];
  const keys = Array.isArray(opts.apiKey) ? opts.apiKey : [opts.apiKey];
  if (keys.length === 0 || keys.every((k) => !k)) {
    throw new Error('videosBatchFullMetadata: server API key is required');
  }
  const chunks: string[][] = [];
  for (let i = 0; i < opts.videoIds.length; i += VIDEOS_LIST_MAX_IDS_PER_CALL) {
    chunks.push(opts.videoIds.slice(i, i + VIDEOS_LIST_MAX_IDS_PER_CALL));
  }
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      let lastErr: unknown = null;
      for (const key of keys) {
        if (!key) continue;
        try {
          return await videosBatchFullSingle(chunk, key, opts.fetchFn);
        } catch (err) {
          lastErr = err;
          if (!isVideosBatchQuotaError(err)) throw err;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    })
  );
  return results.flat();
}

async function videosBatchFullSingle(
  videoIds: string[],
  apiKey: string,
  fetchFn?: typeof fetch
): Promise<YouTubeVideoFullMetadata[]> {
  const url = new URL(`${YOUTUBE_API_BASE}/videos`);
  // 4 parts. videos.list quota = 1 unit per call regardless of part count.
  // We deliberately do NOT request `commentThreads` here — comment text
  // is out of scope per the 2026-04-29 user directive.
  url.searchParams.set('part', 'snippet,contentDetails,statistics,topicDetails');
  url.searchParams.set('id', videoIds.join(','));
  url.searchParams.set('key', apiKey);

  const f = fetchFn ?? fetch;
  const res = await f(url.toString());
  if (!res.ok) {
    let msg = '';
    try {
      const body = (await res.json()) as YouTubeVideosFullResponse;
      msg = body.error?.message ?? '';
    } catch {
      // ignore
    }
    throw new Error(`videos.list HTTP ${res.status}${msg ? ` — ${msg}` : ''}`);
  }
  const body = (await res.json()) as YouTubeVideosFullResponse;
  if (body.error) throw new Error(`videos.list error: ${body.error.message}`);
  return body.items ?? [];
}

/**
 * Convert a YouTube `topicDetails.topicCategories` URL (Wikipedia) to a
 * lowercase slug. Examples:
 *   https://en.wikipedia.org/wiki/Health   → 'health'
 *   https://en.wikipedia.org/wiki/Lifestyle_(sociology) → 'lifestyle'
 *   https://en.wikipedia.org/wiki/Mind     → 'mind'
 *
 * Strips trailing `_(disambig)` parens, replaces underscores with empty
 * (so multi-word topics collapse), lowercases.
 */
export function topicCategoryUrlToSlug(url: string): string {
  const m = url.match(/\/wiki\/([^?#]+)/);
  if (!m) return '';
  const raw = decodeURIComponent(m[1] ?? '').trim();
  // Drop trailing parenthetical disambiguation: "Lifestyle_(sociology)" → "Lifestyle"
  const noDisamb = raw.replace(/_\([^)]*\)$/u, '');
  return noDisamb.replace(/_/g, '').toLowerCase();
}

/**
 * Parse ISO 8601 duration (PT1H2M3S) → seconds. Null on failure.
 */
export function parseIsoDuration(iso?: string | null): number | null {
  if (!iso) return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const h = parseInt(m[1] ?? '0', 10);
  const mi = parseInt(m[2] ?? '0', 10);
  const s = parseInt(m[3] ?? '0', 10);
  if (Number.isNaN(h) || Number.isNaN(mi) || Number.isNaN(s)) return null;
  if (h === 0 && mi === 0 && s === 0 && iso === 'PT') return null;
  return h * 3600 + mi * 60 + s;
}

/**
 * Title blocklist (subset of v1's; conservative). Drop drama/vlog/reaction
 * formats that pollute learning recommendations.
 */
export const V2_TITLE_BLOCKLIST: ReadonlyArray<string> = [
  '드라마',
  '리액션',
  '브이로그',
  'vlog',
  'reaction',
  'sponsored',
  'ad',
  '광고',
];

/**
 * Shorts are excluded from AI recommendations — users can add them
 * manually, but the discovery pipeline recommends long-form only.
 *
 * Threshold is 180 seconds (YouTube extended Shorts from 60s to 180s
 * in October 2024). Prod 2026-04-17: a 110-second shorts titled
 * "한의대수석으로 만들어준 공부법 #공부 #공부잘하는방법" surfaced in
 * a "효율적인 학습법 탐색" mandala — duration passed the old 60s gate
 * even though the video is clearly a short. The hashtag pattern also
 * missed it because the title tagged `#공부` rather than `#shorts`.
 *
 * Null duration is treated as shorts (defensive drop). Videos.list
 * occasionally omits `contentDetails.duration` for shorts specifically,
 * so null → drop prevents that hole.
 */
export function isShortsByDuration(durationSec: number | null): boolean {
  return durationSec === null || durationSec <= 180;
}

/**
 * Secondary shorts signal based on title markers. Catches cases where
 * duration is present and > 60s (unusual edit) but the title still
 * carries #shorts-style tags. Scoped to literal hashtags / brackets
 * so normal titles containing the word "short" (e.g. "short book
 * review") are not affected.
 */
export function titleIndicatesShorts(title: string): boolean {
  if (!title) return false;
  return /#shorts\b|【\s*shorts?\s*】|「\s*shorts?\s*」/i.test(title);
}

export function titleHitsBlocklist(title: string): boolean {
  const lower = title.toLowerCase();
  for (const t of V2_TITLE_BLOCKLIST) {
    if (lower.includes(t.toLowerCase())) return true;
  }
  return false;
}
