/**
 * Source 1 (40% slot, CP438 — replaces deprecated yt-dlp `/feed/trending`).
 *
 * YouTube Data API `chart=mostPopular` per `videoCategoryId` × region. Same
 * API as Source 3 but iterated across category IDs to surface variety
 * beyond the generic mostPopular list. Categories chosen to span the 9
 * Insighta domains:
 *
 *   10 Music         | 17 Sports        | 20 Gaming
 *   22 People&Blogs  | 23 Comedy        | 24 Entertainment
 *   25 News          | 26 Howto&Style   | 27 Education
 *   28 Sci-Tech
 *
 * 10 categories × 2 regions × 50 results = 1000 raw, ~400-600 unique
 * after cross-region/category dedupe. Some categories return 400 in a
 * given region (e.g., 17 Sports often unavailable in some markets) —
 * handled silently and reported in diagnostics.
 *
 * Quota: 1 unit per call → 20 quota per run (vs daily 10 000 cap).
 */

import { pConcurrencyMap } from './concurrency';
import { parseIsoDuration } from './youtube-metadata';
import type { SourceResult, VideoMeta } from './types';

interface CategoryMostPopularOptions {
  apiKey: string;
  regions: ('KR' | 'US')[];
  /** YouTube category IDs to iterate (default = INSIGHTA_DOMAIN_CATEGORIES). */
  categoryIds?: readonly string[];
  /** Max results per (category, region) call, capped at 50 by the API. */
  maxResultsPerCall: number;
  /** Parallel category × region calls (default 5). */
  concurrency: number;
}

const API_BASE = 'https://www.googleapis.com/youtube/v3/videos';

const INSIGHTA_DOMAIN_CATEGORIES = [
  '10', '17', '20', '22', '23', '24', '25', '26', '27', '28',
] as const;

interface MostPopularItem {
  id: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: { high?: { url?: string }; medium?: { url?: string } };
    defaultAudioLanguage?: string;
    defaultLanguage?: string;
    categoryId?: string;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string };
}

interface CallTask {
  region: 'KR' | 'US';
  categoryId: string;
}

async function fetchCategoryRegion(
  task: CallTask,
  opts: CategoryMostPopularOptions,
): Promise<{ task: CallTask; videos: VideoMeta[]; error: string | null }> {
  const url = `${API_BASE}?part=snippet,contentDetails,statistics&chart=mostPopular&regionCode=${task.region}&videoCategoryId=${task.categoryId}&maxResults=${opts.maxResultsPerCall}&key=${opts.apiKey}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    return { task, videos: [], error: (e as Error).message };
  }
  if (!res.ok) {
    const body = await res.text();
    return { task, videos: [], error: `${res.status}: ${body.slice(0, 150)}` };
  }
  const json = (await res.json()) as { items?: MostPopularItem[] };
  const videos = (json.items ?? []).map<VideoMeta>((item) => ({
    youtube_video_id: item.id,
    title: item.snippet?.title,
    channel_title: item.snippet?.channelTitle ?? null,
    duration_seconds: parseIsoDuration(item.contentDetails?.duration),
    view_count: item.statistics?.viewCount ? parseInt(item.statistics.viewCount, 10) : null,
    like_count: item.statistics?.likeCount ? parseInt(item.statistics.likeCount, 10) : null,
    thumbnail_url:
      item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url ?? null,
    published_at: item.snippet?.publishedAt ?? null,
    default_language:
      item.snippet?.defaultAudioLanguage ?? item.snippet?.defaultLanguage ?? null,
  }));
  return { task, videos, error: null };
}

export async function collectCategoryMostPopular(
  opts: CategoryMostPopularOptions,
): Promise<SourceResult> {
  const categoryIds = opts.categoryIds ?? INSIGHTA_DOMAIN_CATEGORIES;
  const tasks: CallTask[] = [];
  for (const cat of categoryIds) {
    for (const region of opts.regions) tasks.push({ region, categoryId: cat });
  }

  const results = await pConcurrencyMap(tasks, opts.concurrency, (t) =>
    fetchCategoryRegion(t, opts),
  );

  const seen = new Set<string>();
  const merged: VideoMeta[] = [];
  const perCategory: Record<string, number> = {};
  const errors: string[] = [];
  let regionsKR = 0;
  let regionsUS = 0;

  for (const r of results) {
    const key = `${r.task.region}:${r.task.categoryId}`;
    perCategory[key] = r.videos.length;
    if (r.error) errors.push(`${key}: ${r.error}`);
    if (r.task.region === 'KR') regionsKR += r.videos.length;
    if (r.task.region === 'US') regionsUS += r.videos.length;
    for (const v of r.videos) {
      if (seen.has(v.youtube_video_id)) continue;
      seen.add(v.youtube_video_id);
      merged.push(v);
    }
  }

  return {
    source: 'category_mostpopular',
    videos: merged,
    videoIdsOnly: [],
    diagnostics: {
      tasks_total: tasks.length,
      categories: categoryIds.length,
      regions: opts.regions,
      raw_kr: regionsKR,
      raw_us: regionsUS,
      dedup_count: merged.length,
      errors: errors.length > 0 ? errors.slice(0, 5) : [],
      per_call_counts: perCategory,
    },
  };
}
