/**
 * React Query Hooks for TubeArchive API
 *
 * Provides type-safe data fetching hooks for all API endpoints.
 * Uses TanStack Query for caching, refetching, and state management.
 */

import { useQuery, useMutation, useQueryClient, UseQueryOptions } from '@tanstack/react-query';
import { apiClient, type Playlist, type Video, type Note, type User, type SyncStatus } from '@/lib/api-client';

// ========================================
// Query Keys
// ========================================

export const queryKeys = {
  // Auth
  currentUser: ['currentUser'] as const,

  // Playlists
  playlists: ['playlists'] as const,
  playlist: (id: string) => ['playlist', id] as const,
  playlistVideos: (id: string) => ['playlist', id, 'videos'] as const,

  // Videos
  videos: (playlistId?: string) => ['videos', playlistId] as const,
  video: (id: string) => ['video', id] as const,

  // Notes
  notes: (videoId: string) => ['notes', videoId] as const,

  // Sync
  syncStatus: (playlistId: string) => ['syncStatus', playlistId] as const,

  // Analytics
  analytics: ['analytics'] as const,
  watchHistory: ['watchHistory'] as const,
};

// ========================================
// Auth Hooks
// ========================================

export function useCurrentUser(options?: Omit<UseQueryOptions<User, Error>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: () => apiClient.getCurrentUser(),
    enabled: apiClient.isAuthenticated(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    ...options,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      apiClient.login(email, password),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.currentUser, data.user);
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists });
    },
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: ({ email, password, name }: { email: string; password: string; name?: string }) =>
      apiClient.register(email, password, name),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.logout(),
    onSuccess: () => {
      queryClient.clear();
    },
  });
}

// ========================================
// Playlist Hooks
// ========================================

export function usePlaylists(options?: Omit<UseQueryOptions<Playlist[], Error>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.playlists,
    queryFn: () => apiClient.getPlaylists(),
    staleTime: 2 * 60 * 1000, // 2 minutes
    ...options,
  });
}

export function usePlaylist(id: string, options?: Omit<UseQueryOptions<Playlist, Error>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.playlist(id),
    queryFn: () => apiClient.getPlaylist(id),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
    ...options,
  });
}

export function useImportPlaylist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (url: string) => apiClient.importPlaylist(url),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists });
    },
  });
}

export function useDeletePlaylist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.deletePlaylist(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists });
    },
  });
}

// ========================================
// Video Hooks
// ========================================

export function useVideos(playlistId?: string, options?: Omit<UseQueryOptions<Video[], Error>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.videos(playlistId),
    queryFn: () => apiClient.getVideos(playlistId),
    staleTime: 2 * 60 * 1000,
    ...options,
  });
}

export function usePlaylistVideos(playlistId: string, options?: Omit<UseQueryOptions<Video[], Error>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.playlistVideos(playlistId),
    queryFn: () => apiClient.getPlaylistVideos(playlistId),
    enabled: !!playlistId,
    staleTime: 2 * 60 * 1000,
    ...options,
  });
}

export function useVideo(id: string, options?: Omit<UseQueryOptions<Video, Error>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.video(id),
    queryFn: () => apiClient.getVideo(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

// ========================================
// Notes Hooks
// ========================================

export function useNotes(videoId: string, options?: Omit<UseQueryOptions<Note[], Error>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.notes(videoId),
    queryFn: () => apiClient.getNotes(videoId),
    enabled: !!videoId,
    staleTime: 30 * 1000, // 30 seconds - notes change more frequently
    ...options,
  });
}

export function useCreateNote(videoId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ content, timestamp }: { content: string; timestamp?: number }) =>
      apiClient.createNote(videoId, content, timestamp),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notes(videoId) });
    },
  });
}

export function useUpdateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, content }: { noteId: string; content: string }) =>
      apiClient.updateNote(noteId, content),
    onSuccess: () => {
      // Invalidate all notes queries since we don't know the videoId
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
  });
}

export function useDeleteNote(videoId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (noteId: string) => apiClient.deleteNote(noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notes(videoId) });
    },
  });
}

// ========================================
// Sync Hooks
// ========================================

export function useSyncStatus(playlistId: string, options?: Omit<UseQueryOptions<SyncStatus, Error>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.syncStatus(playlistId),
    queryFn: () => apiClient.getSyncStatus(playlistId),
    enabled: !!playlistId,
    staleTime: 10 * 1000, // 10 seconds - sync status changes frequently
    refetchInterval: (data) => {
      // Refetch more frequently if sync is in progress
      if (data?.status === 'in_progress') {
        return 2000; // 2 seconds
      }
      return false;
    },
    ...options,
  });
}

export function useSyncPlaylist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (playlistId: string) => apiClient.syncPlaylist(playlistId),
    onSuccess: (_, playlistId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.syncStatus(playlistId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.playlist(playlistId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.playlistVideos(playlistId) });
    },
  });
}

export function useSyncAllPlaylists() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.syncAllPlaylists(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists });
    },
  });
}

// ========================================
// Analytics Hooks
// ========================================

export function useAnalytics(options?: Omit<UseQueryOptions<Record<string, unknown>, Error>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.analytics,
    queryFn: () => apiClient.getAnalytics(),
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

export function useWatchHistory(options?: Omit<UseQueryOptions<Record<string, unknown>[], Error>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.watchHistory,
    queryFn: () => apiClient.getWatchHistory(),
    staleTime: 2 * 60 * 1000,
    ...options,
  });
}

// ========================================
// Health Check Hook
// ========================================

export function useHealthCheck() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiClient.healthCheck(),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000, // Check every minute
  });
}
