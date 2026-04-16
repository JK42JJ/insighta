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

export interface SearchOpts {
  query: string;
  apiKey: string;
  maxResults?: number;
  relevanceLanguage?: string;
  regionCode?: string;
  /** ISO timestamp; results limited to videos published after. Optional. */
  publishedAfter?: string;
  fetchFn?: typeof fetch;
}

export async function searchVideos(opts: SearchOpts): Promise<YouTubeSearchItem[]> {
  if (!opts.apiKey) {
    throw new Error('searchVideos: server API key is required (v2 does not accept OAuth)');
  }
  const url = new URL(`${YOUTUBE_API_BASE}/search`);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('q', opts.query);
  url.searchParams.set('maxResults', String(opts.maxResults ?? SEARCH_MAX_RESULTS));
  url.searchParams.set('key', opts.apiKey);
  if (opts.relevanceLanguage) {
    url.searchParams.set('relevanceLanguage', opts.relevanceLanguage);
  }
  if (opts.regionCode) {
    url.searchParams.set('regionCode', opts.regionCode);
  }
  if (opts.publishedAfter) {
    url.searchParams.set('publishedAfter', opts.publishedAfter);
  }
  url.searchParams.set('safeSearch', 'moderate');

  const fetchFn = opts.fetchFn ?? fetch;
  const res = await fetchFn(url.toString());
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

export interface VideosBatchOpts {
  videoIds: string[];
  apiKey: string;
  fetchFn?: typeof fetch;
}

export async function videosBatch(opts: VideosBatchOpts): Promise<YouTubeVideoStatsItem[]> {
  if (opts.videoIds.length === 0) return [];
  if (!opts.apiKey) {
    throw new Error('videosBatch: server API key is required (v2 does not accept OAuth)');
  }
  const out: YouTubeVideoStatsItem[] = [];
  for (let i = 0; i < opts.videoIds.length; i += VIDEOS_LIST_MAX_IDS_PER_CALL) {
    const chunk = opts.videoIds.slice(i, i + VIDEOS_LIST_MAX_IDS_PER_CALL);
    out.push(...(await videosBatchSingle(chunk, opts.apiKey, opts.fetchFn)));
  }
  return out;
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
