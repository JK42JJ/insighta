/**
 * trend-collector — YouTube Data API v3 source
 *
 * Phase 1 scope: `videos.list` with `chart=mostPopular` (1 quota unit/call).
 * Phase 1.5+ may add `search.list` (Suggest, 100 units/call) — explicitly
 * NOT used here to keep daily quota safe (see Open Question Q3 in design doc).
 *
 * The fetch implementation is injected (`fetchImpl`) so the executor's tests
 * can mock the network without monkey-patching globalThis.fetch.
 */

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

export interface TrendingVideo {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  categoryId: string;
  publishedAt: string;
  /** parseInt(item.statistics.viewCount). 0 if statistics omitted. */
  viewCount: number;
  /** parseInt(item.statistics.likeCount). null if hidden. */
  likeCount: number | null;
}

export interface FetchTrendingOptions {
  apiKey: string;
  categoryId: string;
  regionCode: string;
  maxResults: number;
  /** Injectable fetch for testability. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface YouTubeVideoItem {
  id: string;
  snippet?: {
    title?: string;
    channelId?: string;
    channelTitle?: string;
    categoryId?: string;
    publishedAt?: string;
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
  };
}

interface YouTubeListResponse {
  items?: YouTubeVideoItem[];
  error?: { code: number; message: string };
}

export class YouTubeFetchError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly youtubeMessage?: string
  ) {
    super(message);
    this.name = 'YouTubeFetchError';
  }
}

/**
 * Fetch trending videos for a single category.
 *
 * Quota cost: 1 unit per call (videos.list with snippet+statistics parts).
 *
 * Returns an empty array if YouTube returns 0 items for the category in the
 * given region — this is a normal outcome (some niche categories empty).
 * Throws YouTubeFetchError on HTTP failure or malformed response.
 */
export async function fetchTrendingByCategory(
  opts: FetchTrendingOptions
): Promise<TrendingVideo[]> {
  const fetchFn = opts.fetchImpl ?? fetch;

  const url = new URL(`${YOUTUBE_API_BASE}/videos`);
  url.searchParams.set('part', 'snippet,statistics');
  url.searchParams.set('chart', 'mostPopular');
  url.searchParams.set('regionCode', opts.regionCode);
  url.searchParams.set('videoCategoryId', opts.categoryId);
  url.searchParams.set('maxResults', String(opts.maxResults));
  url.searchParams.set('key', opts.apiKey);

  const res = await fetchFn(url.toString());

  if (!res.ok) {
    let ytMessage: string | undefined;
    try {
      const body = (await res.json()) as YouTubeListResponse;
      ytMessage = body.error?.message;
    } catch {
      // body wasn't json — leave ytMessage undefined
    }
    throw new YouTubeFetchError(
      `YouTube API HTTP ${res.status} for category ${opts.categoryId}`,
      res.status,
      ytMessage
    );
  }

  const body = (await res.json()) as YouTubeListResponse;
  if (body.error) {
    throw new YouTubeFetchError(
      `YouTube API error for category ${opts.categoryId}`,
      200,
      body.error.message
    );
  }
  if (!body.items) return [];

  return body.items.map((item) => normalizeItem(item, opts.categoryId));
}

function normalizeItem(item: YouTubeVideoItem, fallbackCategory: string): TrendingVideo {
  const viewCountStr = item.statistics?.viewCount;
  const likeCountStr = item.statistics?.likeCount;
  return {
    videoId: item.id,
    title: item.snippet?.title ?? '(untitled)',
    channelId: item.snippet?.channelId ?? '',
    channelTitle: item.snippet?.channelTitle ?? '',
    categoryId: item.snippet?.categoryId ?? fallbackCategory,
    publishedAt: item.snippet?.publishedAt ?? new Date().toISOString(),
    viewCount: viewCountStr ? parseInt(viewCountStr, 10) || 0 : 0,
    likeCount: likeCountStr ? parseInt(likeCountStr, 10) || 0 : null,
  };
}
