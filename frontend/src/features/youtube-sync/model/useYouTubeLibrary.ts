/**
 * Hook for fetching user's YouTube library (subscriptions & playlists)
 * via the new /api/v1/youtube/* endpoints.
 * Uses useInfiniteQuery for automatic pagination support.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';

export interface YouTubeSubscriptionItem {
  channelId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  publishedAt: string;
}

export interface YouTubePlaylistItem {
  playlistId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  itemCount: number;
  publishedAt: string;
}

const STALE_TIME_MS = 1000 * 60 * 30; // 30 min cache

export function useYouTubeSubscriptions(enabled = true) {
  return useInfiniteQuery({
    queryKey: ['youtube', 'subscriptions'],
    queryFn: async ({ pageParam }) => {
      return apiClient.getYouTubeSubscriptions(pageParam);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.pagination?.nextPageToken ?? undefined,
    enabled,
    staleTime: STALE_TIME_MS,
    retry: false,
  });
}

export function useYouTubePlaylists(enabled = true) {
  return useInfiniteQuery({
    queryKey: ['youtube', 'playlists-library'],
    queryFn: async ({ pageParam }) => {
      return apiClient.getYouTubePlaylists(pageParam);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.pagination?.nextPageToken ?? undefined,
    enabled,
    staleTime: STALE_TIME_MS,
    retry: false,
  });
}
