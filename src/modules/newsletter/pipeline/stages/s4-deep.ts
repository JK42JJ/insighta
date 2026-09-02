/**
 * S4 — the first-party record for the shortlist.
 *
 * The design called this "transcript to summary". That is not buildable today
 * and saying otherwise would be the same move issue 1 made: the transcript
 * pipeline runs on the Mac Mini through yt-dlp and, by design, never persists
 * the text — `videos.transcript_fetched_at` is a timestamp, not a document.
 * So this stage does the part that is real and refuses the part that is not.
 *
 * What it does: re-reads the shortlist from `videos.list` at the moment of
 * publication and stores the answer. Title, channel, exact view count,
 * description, tags, duration — the fields a page prints and a gate checks.
 *
 * Why re-read something the harvest already fetched: the harvest ran days
 * before publication, view counts move, and videos are deleted or made
 * private. Issue 1 printed counts that came from a draft rather than from a
 * response, and no reader could tell. A pick that no longer resolves is
 * dropped here rather than shipped as a dead link.
 */

import { logger } from '@/utils/logger';
import { resolveVideosApiKeys } from '@/skills/plugins/video-discover/v2/youtube-client';
import type { CorpusRow } from '../corpus';
import type { Stage, StageContext, StageResult } from '../stage';

const log = logger.child({ module: 'newsletter/s4' });
const API = 'https://www.googleapis.com/youtube/v3';

/** videos.list takes 50 ids per call and costs one unit however many. */
const PAGE = 50;

interface VideoItem {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    channelId?: string;
    publishedAt?: string;
    tags?: string[];
    defaultAudioLanguage?: string;
  };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
}

export const s4Deep: Stage = {
  id: 'S4_deep',
  what: 'read the shortlist back from videos.list at publication time',
  kind: 'machine',

  async run(input: CorpusRow[], ctx: StageContext): Promise<StageResult> {
    if (input.length === 0) return { survivors: [], drops: [], detail: { enriched: 0 } };

    const keys = resolveVideosApiKeys(process.env);
    const key = keys[0];
    if (!key) throw new Error('S4: no YouTube API key configured');
    const fetchFn = ctx.fetchImpl ?? fetch;

    const found = new Map<string, VideoItem>();
    let units = 0;

    for (let i = 0; i < input.length; i += PAGE) {
      const ids = input.slice(i, i + PAGE).map((v) => v.videoId);
      const url =
        `${API}/videos?part=snippet,statistics,contentDetails` + `&id=${ids.join(',')}&key=${key}`;
      const res = await fetchFn(url);
      units += 1;
      if (!res.ok) {
        throw new Error(`S4: videos.list HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const body = (await res.json()) as { items?: VideoItem[] };
      for (const item of body.items ?? []) found.set(item.id, item);
    }

    const survivors: Array<{ videoId: string; enrichment: Record<string, unknown> }> = [];
    const drops: Array<{ videoId: string; reason: string }> = [];

    for (const v of input) {
      const item = found.get(v.videoId);
      if (!item) {
        // The id was live during the harvest and is not now.
        drops.push({ videoId: v.videoId, reason: 'no_longer_available' });
        continue;
      }
      const views = item.statistics?.viewCount;
      survivors.push({
        videoId: v.videoId,
        enrichment: {
          readAt: new Date().toISOString(),
          source: 'youtube.videos.list',
          title: item.snippet?.title ?? v.title,
          channelTitle: item.snippet?.channelTitle ?? v.channelTitle,
          channelId: item.snippet?.channelId ?? v.channelId,
          publishedAt: item.snippet?.publishedAt ?? v.publishedAt.toISOString(),
          description: (item.snippet?.description ?? '').slice(0, 4000),
          tags: item.snippet?.tags ?? [],
          audioLanguage: item.snippet?.defaultAudioLanguage ?? null,
          viewCount: views == null ? null : Number(views),
          likeCount: item.statistics?.likeCount == null ? null : Number(item.statistics.likeCount),
          duration: item.contentDetails?.duration ?? null,
          url: `https://www.youtube.com/watch?v=${v.videoId}`,
        },
      });
    }

    log.info('S4 complete', { asked: input.length, resolved: survivors.length, units });
    return {
      survivors,
      drops,
      quotaUnits: units,
      detail: { calls: units, resolved: survivors.length },
    };
  },
};
