/**
 * YouTube Data API v3 — User library queries
 *
 * Uses OAuth access token from youtube_sync_settings to fetch
 * user's subscriptions and playlists.
 */

import { getPrismaClient } from '../database';
import { MS_PER_HOUR } from '@/utils/time-constants';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const MAX_RESULTS = 50;

/**
 * In-memory cache for YouTube API responses.
 * Key: `${userId}:${endpoint}:${pageToken}`, Value: { data, expiry }
 *
 * Subscriptions and playlists change infrequently (user adds/removes channels
 * maybe once a week). 6-hour TTL protects YouTube quota (100 units/call for
 * subscriptions) while keeping data reasonably fresh.
 */
const CACHE_TTL_MS = 6 * MS_PER_HOUR; // 6 hours
const responseCache = new Map<string, { data: unknown; expiry: number }>();

function getCached<T>(key: string): T | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    responseCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: unknown): void {
  responseCache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
}

/** Clear cache for a user (call after YouTube reconnect/disconnect) */
export function clearYouTubeCache(userId: string): void {
  for (const key of responseCache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      responseCache.delete(key);
    }
  }
}

interface YouTubeSubscription {
  channelId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  publishedAt: string;
}

interface YouTubePlaylist {
  playlistId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  itemCount: number;
  publishedAt: string;
}

/**
 * Get user's YouTube access token from DB.
 * Returns null if not connected or token expired.
 */
async function getAccessToken(userId: string): Promise<string | null> {
  const prisma = getPrismaClient();
  const settings = await prisma.youtube_sync_settings.findUnique({
    where: { user_id: userId },
    select: {
      youtube_access_token: true,
      youtube_token_expires_at: true,
    },
  });

  if (!settings?.youtube_access_token) return null;

  if (
    settings.youtube_token_expires_at &&
    new Date(settings.youtube_token_expires_at) < new Date()
  ) {
    return null; // Token expired — frontend should trigger refresh via youtube-auth Edge Function
  }

  return settings.youtube_access_token;
}

/**
 * Fetch user's YouTube subscriptions (channels they subscribe to).
 * YouTube API: subscriptions.list — 1 quota unit per call.
 */
export async function getUserSubscriptions(
  userId: string,
  pageToken?: string
): Promise<{ items: YouTubeSubscription[]; nextPageToken?: string; totalResults: number }> {
  type SubResult = { items: YouTubeSubscription[]; nextPageToken?: string; totalResults: number };

  const cacheKey = `${userId}:subscriptions:${pageToken ?? ''}`;
  const cached = getCached<SubResult>(cacheKey);
  if (cached) return cached;

  const accessToken = await getAccessToken(userId);
  if (!accessToken) {
    throw new Error('YOUTUBE_NOT_CONNECTED');
  }

  const params = new URLSearchParams({
    part: 'snippet',
    mine: 'true',
    maxResults: String(MAX_RESULTS),
    order: 'alphabetical',
  });
  if (pageToken) params.set('pageToken', pageToken);

  const response = await fetch(`${YOUTUBE_API_BASE}/subscriptions?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`YOUTUBE_API_ERROR: ${response.status} ${JSON.stringify(error)}`);
  }

  const data = await response.json();

  const items: YouTubeSubscription[] = (data.items || []).map((item: any) => ({
    channelId: item.snippet?.resourceId?.channelId || '',
    title: item.snippet?.title || '',
    description: item.snippet?.description || '',
    thumbnailUrl: item.snippet?.thumbnails?.default?.url || '',
    publishedAt: item.snippet?.publishedAt || '',
  }));

  const result: SubResult = {
    items,
    nextPageToken: data.nextPageToken,
    totalResults: data.pageInfo?.totalResults || 0,
  };

  setCache(cacheKey, result);
  return result;
}

/**
 * Fetch user's own YouTube playlists.
 * YouTube API: playlists.list — 1 quota unit per call.
 */
export async function getUserPlaylists(
  userId: string,
  pageToken?: string
): Promise<{ items: YouTubePlaylist[]; nextPageToken?: string; totalResults: number }> {
  type PlResult = { items: YouTubePlaylist[]; nextPageToken?: string; totalResults: number };

  const cacheKey = `${userId}:playlists:${pageToken ?? ''}`;
  const cached = getCached<PlResult>(cacheKey);
  if (cached) return cached;

  const accessToken = await getAccessToken(userId);
  if (!accessToken) {
    throw new Error('YOUTUBE_NOT_CONNECTED');
  }

  const params = new URLSearchParams({
    part: 'snippet,contentDetails',
    mine: 'true',
    maxResults: String(MAX_RESULTS),
  });
  if (pageToken) params.set('pageToken', pageToken);

  const response = await fetch(`${YOUTUBE_API_BASE}/playlists?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`YOUTUBE_API_ERROR: ${response.status} ${JSON.stringify(error)}`);
  }

  const data = await response.json();

  const items: YouTubePlaylist[] = (data.items || []).map((item: any) => ({
    playlistId: item.id || '',
    title: item.snippet?.title || '',
    description: item.snippet?.description || '',
    thumbnailUrl: item.snippet?.thumbnails?.default?.url || '',
    itemCount: item.contentDetails?.itemCount || 0,
    publishedAt: item.snippet?.publishedAt || '',
  }));

  const result: PlResult = {
    items,
    nextPageToken: data.nextPageToken,
    totalResults: data.pageInfo?.totalResults || 0,
  };

  setCache(cacheKey, result);
  return result;
}
