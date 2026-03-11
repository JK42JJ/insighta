/**
 * useYouTubeSync Hook
 *
 * Manages YouTube playlist synchronization operations.
 * Uses Backend API (not Edge Functions) for all playlist CRUD.
 * Edge Functions are still used for video state operations.
 */

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { getAuthHeaders, getEdgeFunctionUrl } from '@/lib/supabase-auth';
import type { YouTubePlaylist, SyncInterval, UserVideoStateWithVideo } from '@/types/youtube';
import { queryKeys } from '@/lib/queryKeys';

// Re-export for backward compatibility
export const youtubeSyncKeys = queryKeys.youtube;

// Shorthand for youtube-sync Edge Function URLs (still used for video states)
function ytSyncUrl(action: string): string {
  return getEdgeFunctionUrl('youtube-sync', action);
}

/** Map Backend API camelCase playlist to snake_case YouTubePlaylist */
function mapPlaylistResponse(p: any): YouTubePlaylist {
  return {
    id: p.id,
    user_id: '',
    youtube_playlist_id: p.youtubeId,
    youtube_playlist_url: `https://www.youtube.com/playlist?list=${p.youtubeId}`,
    title: p.title,
    description: p.description ?? null,
    thumbnail_url: p.thumbnailUrl ?? null,
    channel_title: p.channelTitle ?? null,
    item_count: p.itemCount ?? 0,
    last_synced_at: p.lastSyncedAt ?? null,
    sync_status: p.syncStatus ?? 'PENDING',
    sync_error: null,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  } as YouTubePlaylist;
}

/**
 * Hook to list all user's playlists via Backend API
 */
export function useYouTubePlaylists() {
  return useQuery({
    queryKey: queryKeys.youtube.playlists,
    queryFn: async (): Promise<YouTubePlaylist[]> => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/v1/playlists', { headers });

      if (!response.ok) {
        throw new Error('Failed to get playlists');
      }

      const data = await response.json();
      return (data.playlists ?? []).map(mapPlaylistResponse);
    },
  });
}

/**
 * Hook to add a new playlist via Backend API (uses YouTube API Key, no OAuth required)
 */
export function useAddPlaylist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (playlistUrl: string): Promise<YouTubePlaylist> => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/v1/playlists/import', {
        method: 'POST',
        headers,
        body: JSON.stringify({ playlistUrl }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to add playlist');
      }

      const data = await response.json();
      return mapPlaylistResponse(data.playlist);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.youtube.playlists });
    },
  });
}

/**
 * Hook to sync a playlist via Backend API
 */
export function useSyncPlaylist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      playlistId: string
    ): Promise<{
      success: boolean;
      itemsAdded: number;
      itemsRemoved: number;
      totalItems: number;
      quotaUsed: number;
    }> => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/v1/playlists/${playlistId}/sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to sync playlist');
      }

      const data = await response.json();
      const r = data.result;
      return {
        success: r.status === 'COMPLETED',
        itemsAdded: r.itemsAdded ?? 0,
        itemsRemoved: r.itemsRemoved ?? 0,
        totalItems: (r.itemsAdded ?? 0) + (r.itemsRemoved ?? 0),
        quotaUsed: r.quotaUsed ?? 0,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.youtube.playlists });
      queryClient.invalidateQueries({ queryKey: ['youtube', 'all-video-states'] });
    },
  });
}

/**
 * Hook to delete a playlist via Backend API
 */
export function useDeletePlaylist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (playlistId: string): Promise<void> => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/v1/playlists/${playlistId}`, {
        method: 'DELETE',
        headers,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to delete playlist');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.youtube.playlists });
    },
  });
}

/**
 * Hook to update sync settings (still via Edge Function — no Backend API equivalent yet)
 */
export function useUpdateSyncSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      syncInterval,
      autoSyncEnabled,
    }: {
      syncInterval?: SyncInterval;
      autoSyncEnabled?: boolean;
    }): Promise<void> => {
      const headers = await getAuthHeaders();
      const response = await fetch(ytSyncUrl('update-settings'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ syncInterval, autoSyncEnabled }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update settings');
      }
    },
    onSuccess: () => {
      // Invalidate auth status to refresh sync settings
      queryClient.invalidateQueries({ queryKey: queryKeys.youtube.authStatus });
    },
  });
}

/**
 * Hook to get videos in ideation palette (Edge Function)
 */
export function useIdeationVideos() {
  return useQuery({
    queryKey: queryKeys.youtube.ideationVideos,
    queryFn: async (): Promise<UserVideoStateWithVideo[]> => {
      const headers = await getAuthHeaders();
      const response = await fetch(ytSyncUrl('get-ideation-videos'), { headers });

      if (!response.ok) {
        throw new Error('Failed to get ideation videos');
      }

      const data = await response.json();
      return data.videos;
    },
  });
}

/**
 * Hook to get ALL video states (ideation + mandala) (Edge Function)
 * When mandalaId is provided, filters to only that mandala's cards.
 */
export function useAllVideoStates(mandalaId?: string) {
  return useQuery({
    queryKey: queryKeys.youtube.allVideoStates(mandalaId),
    queryFn: async (): Promise<UserVideoStateWithVideo[]> => {
      const headers = await getAuthHeaders();
      let url = ytSyncUrl('get-all-video-states');
      if (mandalaId) {
        url += `&mandala_id=${encodeURIComponent(mandalaId)}`;
      }
      const response = await fetch(url, { headers });

      if (!response.ok) {
        throw new Error('Failed to get video states');
      }

      const data = await response.json();
      return data.videos;
    },
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook to update video state (for ideation palette) (Edge Function)
 */
export function useUpdateVideoState() {
  const queryClient = useQueryClient();

  type UpdateVideoStateVars = {
    videoStateId: string;
    updates: {
      is_in_ideation?: boolean;
      user_note?: string;
      watch_position_seconds?: number;
      is_watched?: boolean;
      cell_index?: number;
      level_id?: string;
      mandala_id?: string;
      sort_order?: number;
    };
  };

  const allVideoStatesPrefix = ['youtube', 'all-video-states'];

  return useMutation({
    mutationFn: async ({ videoStateId, updates }: UpdateVideoStateVars): Promise<void> => {
      const headers = await getAuthHeaders();
      const response = await fetch(ytSyncUrl('update-video-state'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ videoStateId, updates }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update video state');
      }
    },
    onMutate: async ({ videoStateId, updates }: UpdateVideoStateVars) => {
      await queryClient.cancelQueries({ queryKey: allVideoStatesPrefix });

      // Snapshot all matching caches for rollback
      const previousCaches = new Map<readonly unknown[], UserVideoStateWithVideo[] | undefined>();
      queryClient
        .getQueriesData<UserVideoStateWithVideo[]>({ queryKey: allVideoStatesPrefix })
        .forEach(([key, data]) => {
          previousCaches.set(key, data);
          if (data) {
            queryClient.setQueryData<UserVideoStateWithVideo[]>(
              key,
              data.map((item) => (item.id === videoStateId ? { ...item, ...updates } : item))
            );
          }
        });

      return { previousCaches };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousCaches) {
        context.previousCaches.forEach((data, key) => {
          if (data) queryClient.setQueryData(key, data);
        });
      }
      queryClient.invalidateQueries({ queryKey: allVideoStatesPrefix });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: allVideoStatesPrefix });
    },
  });
}

/**
 * Hook to sync all playlists
 */
export function useSyncAllPlaylists() {
  const queryClient = useQueryClient();
  const { data: playlists } = useYouTubePlaylists();
  const syncPlaylist = useSyncPlaylist();

  return useMutation({
    mutationFn: async (): Promise<{
      synced: number;
      failed: number;
      errors: string[];
    }> => {
      if (!playlists || playlists.length === 0) {
        return { synced: 0, failed: 0, errors: [] };
      }

      let synced = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const playlist of playlists) {
        try {
          await syncPlaylist.mutateAsync(playlist.id);
          synced++;
        } catch (error) {
          failed++;
          errors.push(
            `${playlist.title}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      return { synced, failed, errors };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.youtube.playlists });
      queryClient.invalidateQueries({ queryKey: ['youtube', 'all-video-states'] });
    },
  });
}

/**
 * Combined hook for common YouTube sync operations
 */
export function useYouTubeSync() {
  const playlists = useYouTubePlaylists();
  const addPlaylist = useAddPlaylist();
  const syncPlaylist = useSyncPlaylist();
  const deletePlaylist = useDeletePlaylist();
  const updateSettings = useUpdateSyncSettings();
  const syncAll = useSyncAllPlaylists();

  return {
    // Data
    playlists: playlists.data ?? [],

    // Loading states
    isLoading: playlists.isLoading,
    isAdding: addPlaylist.isPending,
    isSyncing: syncPlaylist.isPending,
    isDeleting: deletePlaylist.isPending,
    isSyncingAll: syncAll.isPending,

    // Error states
    error: playlists.error || addPlaylist.error || syncPlaylist.error || deletePlaylist.error,

    // Actions
    addPlaylist: addPlaylist.mutateAsync,
    syncPlaylist: syncPlaylist.mutateAsync,
    deletePlaylist: deletePlaylist.mutateAsync,
    updateSettings: updateSettings.mutateAsync,
    syncAll: syncAll.mutateAsync,
    refetch: playlists.refetch,
  };
}
