/**
 * Source 3 (20% slot) — YouTube Data API v3 `videos.list?chart=mostPopular`.
 *
 * Same API used by Insighta's existing v3 collector. Returns full metadata
 * directly (no separate enrichment needed). Cheap: 1 quota unit per call,
 * up to 50 results per region, optional categoryId for vertical slicing.
 *
 * For CP438 we pull KR + US mostPopular without categoryId (trending
 * across all categories) — the orchestrator's quality gate filters out
 * shorts / ads / off-topic later.
 */

import { fetchVideoMetadata, parseIsoDuration } from './youtube-metadata';
import type { SourceResult, VideoMeta } from './types';

interface MostPopularOptions {
  apiKey: string;
  /** Max results per region (≤50). */
  maxResultsPerRegion: number;
  regions: ('KR' | 'US')[];
}

interface MostPopularItem {
  id: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: { high?: { url?: string }; medium?: { url?: string } };
    defaultAudioLanguage?: string;
    defaultLanguage?: string;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string };
}

const API_BASE = 'https://www.googleapis.com/youtube/v3/videos';

async function fetchRegion(
  region: 'KR' | 'US',
  opts: MostPopularOptions,
): Promise<VideoMeta[]> {
  const url = `${API_BASE}?part=snippet,contentDetails,statistics&chart=mostPopular&regionCode=${region}&maxResults=${opts.maxResultsPerRegion}&key=${opts.apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`mostPopular ${region} ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { items?: MostPopularItem[] };
  return (json.items ?? []).map((item) => ({
    youtube_video_id: item.id,
    title: item.snippet?.title,
    channel_title: item.snippet?.channelTitle ?? null,
    duration_seconds: parseIsoDuration(item.contentDetails?.duration),
    view_count: item.statistics?.viewCount ? parseInt(item.statistics.viewCount, 10) : null,
    like_count: item.statistics?.likeCount ? parseInt(item.statistics.likeCount, 10) : null,
    thumbnail_url:
      item.snippet?.thumbnails?.high?.url ??
      item.snippet?.thumbnails?.medium?.url ??
      null,
    published_at: item.snippet?.publishedAt ?? null,
    default_language:
      item.snippet?.defaultAudioLanguage ?? item.snippet?.defaultLanguage ?? null,
  }));
}

export async function collectMostPopular(
  opts: MostPopularOptions,
): Promise<SourceResult> {
  const all: VideoMeta[] = [];
  const errors: string[] = [];
  const perRegion: Record<string, number> = {};
  for (const region of opts.regions) {
    try {
      const rows = await fetchRegion(region, opts);
      all.push(...rows);
      perRegion[region] = rows.length;
    } catch (e) {
      errors.push(`${region}: ${(e as Error).message}`);
      perRegion[region] = 0;
    }
  }
  // Dedupe by ID — KR/US trending overlap can occur for global hits.
  const seen = new Set<string>();
  const dedup = all.filter((v) => {
    if (seen.has(v.youtube_video_id)) return false;
    seen.add(v.youtube_video_id);
    return true;
  });
  return {
    source: 'youtube_mostpopular',
    videos: dedup,
    videoIdsOnly: [],
    diagnostics: {
      per_region: perRegion,
      dedup_count: dedup.length,
      errors,
    },
  };
}

// Re-export for orchestrator.
export { fetchVideoMetadata };
