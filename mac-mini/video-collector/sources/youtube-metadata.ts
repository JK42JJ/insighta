/**
 * YouTube Data API v3 helper — bulk video metadata fetch.
 *
 *   videos.list?part=snippet,contentDetails,statistics&id=ID1,ID2,...
 *
 * 1 quota unit per call, 50 IDs per call. Costs ~3.5 quota for 175-video
 * batch. Cheaper than yt-dlp per-video probe and avoids WebShare proxy
 * cost for the metadata path. (yt-dlp via WebShare is reserved for raw
 * trending feed scrape and search — paths the API does not expose.)
 */

import type { VideoMeta } from './types';

const API_BASE = 'https://www.googleapis.com/youtube/v3/videos';
const BATCH_SIZE = 50;

interface YouTubeVideoListItem {
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

/** Parse ISO 8601 duration (PT1H2M3S) → seconds. */
export function parseIsoDuration(d: string | undefined): number | null {
  if (!d) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d);
  if (!m) return null;
  const h = parseInt(m[1] ?? '0', 10);
  const min = parseInt(m[2] ?? '0', 10);
  const s = parseInt(m[3] ?? '0', 10);
  return h * 3600 + min * 60 + s;
}

/**
 * Fetch metadata for the given video IDs. Returns one VideoMeta per id
 * present in the API response (videos that are deleted/private will be
 * silently dropped — that's the desired behavior for a collector).
 */
export async function fetchVideoMetadata(
  ids: readonly string[],
  apiKey: string,
): Promise<VideoMeta[]> {
  if (ids.length === 0) return [];
  const out: VideoMeta[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const url = `${API_BASE}?part=snippet,contentDetails,statistics&id=${chunk.join(',')}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`videos.list ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { items?: YouTubeVideoListItem[] };
    for (const item of json.items ?? []) {
      out.push({
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
      });
    }
  }
  return out;
}
