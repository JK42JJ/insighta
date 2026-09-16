/**
 * Answer "does this video exist, and is it the one the page says it is" from
 * YouTube rather than from the draft that claims it.
 *
 * The gates take a resolver rather than calling the API themselves, so they
 * stay testable without quota. This is the one real implementation; before it
 * existed the verify script carried a private copy and the server had none,
 * which is why the publish route could not run the resolution gate at all.
 *
 * `videos.list` is one unit for fifty ids, so a whole issue's picks cost one.
 */

import { resolveVideosApiKeys } from '@/skills/plugins/video-discover/v2/youtube-client';
import type { ResolvedVideo, VideoResolver } from './publish-gates';

/** videos.list accepts fifty ids per call. */
const BATCH = 50;

interface VideosListResponse {
  items?: Array<{
    id: string;
    snippet?: { title?: string; channelTitle?: string };
    statistics?: { viewCount?: string };
  }>;
}

/**
 * A resolver, or null when no key is configured.
 *
 * Null rather than a throwing resolver: the caller has to decide what an
 * unrunnable gate means, and for a publish that decision is "refuse", not
 * "crash". A gate that cannot run is not a gate that passed.
 */
export function createVideoResolver(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl: typeof fetch = fetch
): VideoResolver | null {
  const key = resolveVideosApiKeys(env)[0];
  if (!key) return null;

  return async (ids: string[]): Promise<Map<string, ResolvedVideo>> => {
    const out = new Map<string, ResolvedVideo>();
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      const url =
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics` +
        `&id=${chunk.join(',')}&key=${key}`;
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`videos.list HTTP ${res.status}`);
      const body = (await res.json()) as VideosListResponse;
      for (const item of body.items ?? []) {
        out.set(item.id, {
          videoId: item.id,
          title: item.snippet?.title ?? '',
          channelTitle: item.snippet?.channelTitle ?? '',
          viewCount: item.statistics?.viewCount ? Number(item.statistics.viewCount) : null,
        });
      }
    }
    return out;
  };
}
