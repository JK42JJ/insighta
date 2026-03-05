/**
 * useYouTubeSync Hook
 *
 * Manages YouTube playlist synchronization operations.
 * Provides CRUD operations for playlists and sync settings.
 */

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { YouTubePlaylist, SyncInterval, UserVideoStateWithVideo } from '@/types/youtube';

// Query Keys
export const youtubeSyncKeys = {
  playlists: ['youtube', 'playlists'] as const,
  playlist: (id: string) => ['youtube', 'playlist', id] as const,
  ideationVideos: ['youtube', 'ideation-videos'] as const,
  allVideoStates: ['youtube', 'all-video-states'] as const,
};

// Edge Function URL helper
function getEdgeFunctionUrl(action: string): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  return `${supabaseUrl}/functions/v1/youtube-sync?action=${action}`;
}

// Get auth headers (includes apikey for Kong API Gateway)
async function getAuthHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }
  const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
    apikey: apiKey,
  };
}

/**
 * Hook to list all user's playlists
 */
export function useYouTubePlaylists() {
  return useQuery({
    queryKey: youtubeSyncKeys.playlists,
    queryFn: async (): Promise<YouTubePlaylist[]> => {
      const headers = await getAuthHeaders();
      const response = await fetch(getEdgeFunctionUrl('list-playlists'), { headers });

      if (!response.ok) {
        throw new Error('Failed to get playlists');
      }

      const data = await response.json();
      return data.playlists;
    },
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook to add a new playlist
 */
export function useAddPlaylist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (playlistUrl: string): Promise<YouTubePlaylist> => {
      const headers = await getAuthHeaders();
      const response = await fetch(getEdgeFunctionUrl('add-playlist'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ playlistUrl }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add playlist');
      }

      const data = await response.json();
      return data.playlist;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: youtubeSyncKeys.playlists });
    },
  });
}

/**
 * Hook to sync a playlist
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
      const response = await fetch(getEdgeFunctionUrl('sync-playlist'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ playlistId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to sync playlist');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: youtubeSyncKeys.playlists });
      queryClient.invalidateQueries({ queryKey: youtubeSyncKeys.allVideoStates });
    },
  });
}

/**
 * Hook to delete a playlist
 */
export function useDeletePlaylist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (playlistId: string): Promise<void> => {
      const headers = await getAuthHeaders();
      const response = await fetch(getEdgeFunctionUrl('delete-playlist'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ playlistId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete playlist');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: youtubeSyncKeys.playlists });
    },
  });
}

/**
 * Hook to update sync settings
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
      const response = await fetch(getEdgeFunctionUrl('update-settings'), {
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
      queryClient.invalidateQueries({ queryKey: ['youtube', 'auth', 'status'] });
    },
  });
}

/**
 * Hook to get videos in ideation palette
 */
export function useIdeationVideos() {
  return useQuery({
    queryKey: youtubeSyncKeys.ideationVideos,
    queryFn: async (): Promise<UserVideoStateWithVideo[]> => {
      const headers = await getAuthHeaders();
      const response = await fetch(getEdgeFunctionUrl('get-ideation-videos'), { headers });

      if (!response.ok) {
        throw new Error('Failed to get ideation videos');
      }

      const data = await response.json();
      return data.videos;
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Hook to get ALL video states (ideation + mandala)
 * Returns all user_video_states regardless of is_in_ideation flag.
 * Frontend splits into ideation vs mandala cards.
 */
export function useAllVideoStates() {
  return useQuery({
    queryKey: youtubeSyncKeys.allVideoStates,
    queryFn: async (): Promise<UserVideoStateWithVideo[]> => {
      const headers = await getAuthHeaders();
      const response = await fetch(getEdgeFunctionUrl('get-all-video-states'), { headers });

      if (!response.ok) {
        throw new Error('Failed to get video states');
      }

      const data = await response.json();
      return data.videos;
    },
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook to update video state (for ideation palette)
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
      sort_order?: number;
    };
  };

  return useMutation({
    mutationFn: async ({ videoStateId, updates }: UpdateVideoStateVars): Promise<void> => {
      const headers = await getAuthHeaders();
      const response = await fetch(getEdgeFunctionUrl('update-video-state'), {
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
      await queryClient.cancelQueries({ queryKey: youtubeSyncKeys.allVideoStates });
      const previousAll = queryClient.getQueryData<UserVideoStateWithVideo[]>(
        youtubeSyncKeys.allVideoStates
      );

      // Update allVideoStates cache (single source of truth)
      if (previousAll) {
        queryClient.setQueryData<UserVideoStateWithVideo[]>(
          youtubeSyncKeys.allVideoStates,
          (prev) => prev?.map((item) => (item.id === videoStateId ? { ...item, ...updates } : item))
        );
      }

      return { previousAll };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousAll) {
        queryClient.setQueryData(youtubeSyncKeys.allVideoStates, context.previousAll);
      } else {
        queryClient.invalidateQueries({ queryKey: youtubeSyncKeys.allVideoStates });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: youtubeSyncKeys.allVideoStates });
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
      queryClient.invalidateQueries({ queryKey: youtubeSyncKeys.playlists });
      queryClient.invalidateQueries({ queryKey: youtubeSyncKeys.allVideoStates });
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
