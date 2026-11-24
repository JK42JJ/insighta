/**
 * Channel-level features: pure calculators + fetch wrappers with injected
 * fetchFn and quota-unit accounting. Unit cost is 1 per list call.
 */
import { CHANNEL_RECENT_UPLOADS_N, YT_API_BASE } from '@/config/measurement-record';
import { SHORT_MAX_DURATION_SEC } from '@/modules/video-pool/is-short';
import { MS_PER_DAY } from '@/utils/time-constants';
import { parseIsoDurationSec, safeRatio } from './features';
import type { ChannelFeatures, FetchFn, UnitsUsed } from './types';

const MEDIAN_DIVISOR = 2;
/** videos.list accepts at most this many ids per call. */
const VIDEOS_LIST_MAX_IDS = 50;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / MEDIAN_DIVISOR);
  if (s.length % MEDIAN_DIVISOR === 1) return s[mid] as number;
  return ((s[mid - 1] as number) + (s[mid] as number)) / MEDIAN_DIVISOR;
}

/** Median gap in days between consecutive uploads; null with < 2 uploads. */
export function uploadCadenceDays(publishedAtIso: readonly string[]): number | null {
  const ts = publishedAtIso.map((p) => Date.parse(p)).filter((t) => !Number.isNaN(t));
  if (ts.length < 2) return null;
  ts.sort((a, b) => b - a);
  const gaps: number[] = [];
  for (let i = 0; i < ts.length - 1; i += 1) {
    gaps.push(((ts[i] as number) - (ts[i + 1] as number)) / MS_PER_DAY);
  }
  return median(gaps);
}

/** Share of uploads with duration <= threshold; null when none have a duration. */
export function shortsRatio(
  durationsSec: ReadonlyArray<number | null>,
  thresholdSec: number = SHORT_MAX_DURATION_SEC
): number | null {
  const known = durationsSec.filter((d): d is number => d != null);
  if (known.length === 0) return null;
  return known.filter((d) => d <= thresholdSec).length / known.length;
}

/** This video's views / median views of the channel's recent uploads. */
export function viewsMultiple(
  videoViews: number | null,
  recentViews: readonly number[]
): number | null {
  return safeRatio(videoViews, median(recentViews));
}

export interface ChannelStatsInput {
  subscriberCount: number | null;
  hiddenSubscriberCount?: boolean;
  channelPublishedAt: string | null;
  videoCount: number | null;
  recentPublishedAt: readonly string[];
  recentDurationsSec: ReadonlyArray<number | null>;
  recentViews: readonly number[];
  videoViews: number | null;
}

export function computeChannelFeatures(
  input: ChannelStatsInput,
  now: Date = new Date()
): ChannelFeatures {
  const created = input.channelPublishedAt ? Date.parse(input.channelPublishedAt) : NaN;
  return {
    subscriber_count: input.hiddenSubscriberCount ? null : input.subscriberCount,
    channel_age_days: Number.isNaN(created)
      ? null
      : Math.max(0, Math.floor((now.getTime() - created) / MS_PER_DAY)),
    channel_video_count: input.videoCount,
    upload_cadence_days: uploadCadenceDays(input.recentPublishedAt),
    shorts_ratio_last50: shortsRatio(input.recentDurationsSec),
    shorts_threshold_sec: SHORT_MAX_DURATION_SEC,
    views_multiple_vs_channel_median: viewsMultiple(input.videoViews, input.recentViews),
  };
}

// ---------------------------------------------------------------- fetchers

export interface ChannelInfo {
  uploadsPlaylistId: string | null;
  subscriberCount: number | null;
  hiddenSubscriberCount: boolean;
  channelPublishedAt: string | null;
  videoCount: number | null;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function getJson<T>(fetchFn: FetchFn, url: string): Promise<T | null> {
  try {
    const res = await fetchFn(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** channels.list part=contentDetails,statistics,snippet (1 unit). */
export async function fetchChannelInfo(
  channelId: string,
  apiKey: string,
  fetchFn: FetchFn,
  units: UnitsUsed
): Promise<ChannelInfo | null> {
  const url =
    `${YT_API_BASE}/channels?part=contentDetails,statistics,snippet` +
    `&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(apiKey)}`;
  units.channels += 1;
  const body = await getJson<{
    items?: Array<{
      snippet?: { publishedAt?: string };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
      statistics?: {
        subscriberCount?: string;
        hiddenSubscriberCount?: boolean;
        videoCount?: string;
      };
    }>;
  }>(fetchFn, url);
  const item = body?.items?.[0];
  if (!item) return null;
  return {
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? null,
    subscriberCount: numOrNull(item.statistics?.subscriberCount),
    hiddenSubscriberCount: item.statistics?.hiddenSubscriberCount === true,
    channelPublishedAt: item.snippet?.publishedAt ?? null,
    videoCount: numOrNull(item.statistics?.videoCount),
  };
}

/** playlistItems.list part=contentDetails maxResults=50 (1 unit). */
export async function fetchRecentUploadIds(
  uploadsPlaylistId: string,
  apiKey: string,
  fetchFn: FetchFn,
  units: UnitsUsed
): Promise<string[]> {
  const url =
    `${YT_API_BASE}/playlistItems?part=contentDetails` +
    `&maxResults=${Math.min(CHANNEL_RECENT_UPLOADS_N, VIDEOS_LIST_MAX_IDS)}` +
    `&playlistId=${encodeURIComponent(uploadsPlaylistId)}&key=${encodeURIComponent(apiKey)}`;
  units.playlistItems += 1;
  const body = await getJson<{ items?: Array<{ contentDetails?: { videoId?: string } }> }>(
    fetchFn,
    url
  );
  return (body?.items ?? [])
    .map((i) => i.contentDetails?.videoId)
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
}

export interface RecentUploadStats {
  publishedAt: string[];
  durationsSec: Array<number | null>;
  views: number[];
}

/** videos.list part=contentDetails,statistics (+snippet publishedAt) for ids (1 unit). */
export async function fetchRecentUploadStats(
  videoIds: readonly string[],
  apiKey: string,
  fetchFn: FetchFn,
  units: UnitsUsed
): Promise<RecentUploadStats> {
  const out: RecentUploadStats = { publishedAt: [], durationsSec: [], views: [] };
  if (videoIds.length === 0) return out;
  const ids = videoIds.slice(0, VIDEOS_LIST_MAX_IDS).map(encodeURIComponent).join(',');
  const url =
    `${YT_API_BASE}/videos?part=snippet,contentDetails,statistics` +
    `&id=${ids}&key=${encodeURIComponent(apiKey)}`;
  units.videos += 1;
  const body = await getJson<{
    items?: Array<{
      snippet?: { publishedAt?: string };
      contentDetails?: { duration?: string };
      statistics?: { viewCount?: string };
    }>;
  }>(fetchFn, url);
  for (const it of body?.items ?? []) {
    if (it.snippet?.publishedAt) out.publishedAt.push(it.snippet.publishedAt);
    out.durationsSec.push(parseIsoDurationSec(it.contentDetails?.duration));
    const v = numOrNull(it.statistics?.viewCount);
    if (v != null) out.views.push(v);
  }
  return out;
}

export interface ChannelFeaturesResult {
  features: ChannelFeatures | null;
  units: UnitsUsed;
}

/** Full channel fetch + compute. 3 calls max (1 unit each). */
export async function channelFeaturesForVideo(
  channelId: string,
  videoViews: number | null,
  apiKey: string,
  fetchFn: FetchFn,
  now: Date = new Date()
): Promise<ChannelFeaturesResult> {
  const units: UnitsUsed = { channels: 0, playlistItems: 0, videos: 0 };
  const info = await fetchChannelInfo(channelId, apiKey, fetchFn, units);
  if (!info) return { features: null, units };
  const ids = info.uploadsPlaylistId
    ? await fetchRecentUploadIds(info.uploadsPlaylistId, apiKey, fetchFn, units)
    : [];
  const recent = await fetchRecentUploadStats(ids, apiKey, fetchFn, units);
  return {
    features: computeChannelFeatures(
      {
        subscriberCount: info.subscriberCount,
        hiddenSubscriberCount: info.hiddenSubscriberCount,
        channelPublishedAt: info.channelPublishedAt,
        videoCount: info.videoCount,
        recentPublishedAt: recent.publishedAt,
        recentDurationsSec: recent.durationsSec,
        recentViews: recent.views,
        videoViews,
      },
      now
    ),
    units,
  };
}
