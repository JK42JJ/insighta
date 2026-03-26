/**
 * Hook for fetching user's YouTube library (subscriptions & playlists)
 * via the new /api/v1/youtube/* endpoints.
 */

import { useQuery } from '@tanstack/react-query';
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

export function useYouTubeSubscriptions(enabled = true) {
  return useQuery({
    queryKey: ['youtube', 'subscriptions'],
    queryFn: async () => {
      const result = await apiClient.getYouTubeSubscriptions();
      return result.data;
    },
    enabled,
    staleTime: 1000 * 60 * 30, // 30 min cache
    retry: false,
  });
}

export function useYouTubePlaylists(enabled = true) {
  return useQuery({
    queryKey: ['youtube', 'playlists-library'],
    queryFn: async () => {
      const result = await apiClient.getYouTubePlaylists();
      return result.data;
    },
    enabled,
    staleTime: 1000 * 60 * 30,
    retry: false,
  });
}
