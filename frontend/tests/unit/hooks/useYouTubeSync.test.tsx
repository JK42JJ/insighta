/**
 * useYouTubeSync Hook Tests
 *
 * Tests for YouTube playlist sync hooks including CRUD operations,
 * query invalidation, error handling, and batch sync operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';

// Mock Supabase client
const mockGetSession = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
    },
  },
}));

// Import after mocking
import {
  useYouTubePlaylists,
  useAddPlaylist,
  useSyncPlaylist,
  useDeletePlaylist,
  useUpdateSyncSettings,
  useIdeationVideos,
  useUpdateVideoState,
  useSyncAllPlaylists,
  useYouTubeSync,
  youtubeSyncKeys,
} from '@/hooks/useYouTubeSync';

// ============================================
// Test Utilities
// ============================================

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function createWrapper(queryClient = createTestQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

// ============================================
// Mock Data
// ============================================

const mockSession = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expires_in: 3600,
  user: { id: 'test-user-id' },
};

const mockPlaylists = [
  {
    id: 'playlist-1',
    user_id: 'test-user-id',
    youtube_playlist_id: 'PLtest123',
    youtube_playlist_url: 'https://youtube.com/playlist?list=PLtest123',
    title: 'React Tutorials',
    description: 'A collection of React tutorials',
    thumbnail_url: 'https://i.ytimg.com/vi/abc123/default.jpg',
    channel_title: 'React Academy',
    item_count: 25,
    last_synced_at: '2024-06-15T14:30:00Z',
    sync_status: 'completed' as const,
    sync_error: null,
    created_at: '2024-02-01T00:00:00Z',
    updated_at: '2024-06-15T14:30:00Z',
  },
  {
    id: 'playlist-2',
    user_id: 'test-user-id',
    youtube_playlist_id: 'PLtest456',
    youtube_playlist_url: 'https://youtube.com/playlist?list=PLtest456',
    title: 'TypeScript Deep Dive',
    description: 'Advanced TypeScript concepts',
    thumbnail_url: 'https://i.ytimg.com/vi/def456/default.jpg',
    channel_title: 'TypeScript Pro',
    item_count: 18,
    last_synced_at: '2024-06-14T10:00:00Z',
    sync_status: 'completed' as const,
    sync_error: null,
    created_at: '2024-03-01T00:00:00Z',
    updated_at: '2024-06-14T10:00:00Z',
  },
];

const mockSyncResult = {
  success: true,
  itemsAdded: 5,
  itemsRemoved: 2,
  totalItems: 28,
  quotaUsed: 15,
};

const mockIdeationVideos = [
  {
    id: 'state-1',
    user_id: 'test-user-id',
    video_id: 'video-1',
    is_watched: true,
    watch_position_seconds: 1847,
    is_in_ideation: true,
    user_note: 'Great explanation of useState',
    cell_index: 0,
    level_id: 'root',
    sort_order: 0,
    added_to_ideation_at: '2024-03-01T00:00:00Z',
    created_at: '2024-03-01T00:00:00Z',
    updated_at: '2024-06-01T00:00:00Z',
  },
];

// ============================================
// Setup
// ============================================

describe('YouTube Sync Hooks', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetSession.mockResolvedValue({
      data: { session: mockSession },
      error: null,
    });

    originalFetch = global.fetch;
    global.fetch = vi.fn();

    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-api-key');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  // ============================================
  // useYouTubePlaylists Tests
  // ============================================

  describe('useYouTubePlaylists', () => {
    it('should fetch playlists successfully', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ playlists: mockPlaylists }),
      });

      const { result } = renderHook(() => useYouTubePlaylists(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockPlaylists);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('action=list-playlists'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockSession.access_token}`,
          }),
        })
      );
    });

    it('should handle fetch error', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => useYouTubePlaylists(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe('Failed to get playlists');
    });

    it('should throw error when not authenticated', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: null },
        error: null,
      });

      const { result } = renderHook(() => useYouTubePlaylists(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe('Not authenticated');
    });

    it('should return empty array when no playlists', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ playlists: [] }),
      });

      const { result } = renderHook(() => useYouTubePlaylists(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual([]);
    });
  });

  // ============================================
  // useAddPlaylist Tests
  // ============================================

  describe('useAddPlaylist', () => {
    it('should add playlist successfully', async () => {
      const newPlaylist = {
        id: 'new-playlist-id',
        youtube_playlist_id: 'PLnew123',
        title: 'New Playlist',
      };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ playlist: newPlaylist }),
      });

      const queryClient = createTestQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useAddPlaylist(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync('https://youtube.com/playlist?list=PLnew123');
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('action=add-playlist'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ playlistUrl: 'https://youtube.com/playlist?list=PLnew123' }),
        })
      );
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: youtubeSyncKeys.playlists });
    });

    it('should handle add playlist error', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Invalid playlist URL' }),
      });

      const { result } = renderHook(() => useAddPlaylist(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await expect(result.current.mutateAsync('invalid-url')).rejects.toThrow('Invalid playlist URL');
      });
    });

    it('should handle add playlist network error', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      });

      const { result } = renderHook(() => useAddPlaylist(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await expect(result.current.mutateAsync('https://youtube.com/playlist?list=PLtest')).rejects.toThrow(
          'Failed to add playlist'
        );
      });
    });
  });

  // ============================================
  // useSyncPlaylist Tests
  // ============================================

  describe('useSyncPlaylist', () => {
    it('should sync playlist successfully', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSyncResult),
      });

      const queryClient = createTestQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useSyncPlaylist(), {
        wrapper: createWrapper(queryClient),
      });

      let syncResult;
      await act(async () => {
        syncResult = await result.current.mutateAsync('playlist-1');
      });

      expect(syncResult).toEqual(mockSyncResult);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('action=sync-playlist'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ playlistId: 'playlist-1' }),
        })
      );
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: youtubeSyncKeys.playlists });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: youtubeSyncKeys.ideationVideos });
    });

    it('should handle sync error', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Quota exceeded' }),
      });

      const { result } = renderHook(() => useSyncPlaylist(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await expect(result.current.mutateAsync('playlist-1')).rejects.toThrow('Quota exceeded');
      });
    });

    it('should use fallback error message when error.error is undefined', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      });

      const { result } = renderHook(() => useSyncPlaylist(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await expect(result.current.mutateAsync('playlist-1')).rejects.toThrow('Failed to sync playlist');
      });
    });
  });

  // ============================================
  // useDeletePlaylist Tests
  // ============================================

  describe('useDeletePlaylist', () => {
    it('should delete playlist successfully', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const queryClient = createTestQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useDeletePlaylist(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync('playlist-1');
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('action=delete-playlist'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ playlistId: 'playlist-1' }),
        })
      );
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: youtubeSyncKeys.playlists });
    });

    it('should handle delete error', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Playlist not found' }),
      });

      const { result } = renderHook(() => useDeletePlaylist(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await expect(result.current.mutateAsync('invalid-playlist')).rejects.toThrow('Playlist not found');
      });
    });

    it('should use fallback error message when error.error is undefined', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      });

      const { result } = renderHook(() => useDeletePlaylist(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await expect(result.current.mutateAsync('playlist-1')).rejects.toThrow('Failed to delete playlist');
      });
    });
  });

  // ============================================
  // useUpdateSyncSettings Tests
  // ============================================

  describe('useUpdateSyncSettings', () => {
    it('should update sync settings successfully', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const queryClient = createTestQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useUpdateSyncSettings(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          syncInterval: '6h',
          autoSyncEnabled: true,
        });
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('action=update-settings'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ syncInterval: '6h', autoSyncEnabled: true }),
        })
      );
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['youtube', 'auth', 'status'] });
    });

    it('should update only sync interval', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const { result } = renderHook(() => useUpdateSyncSettings(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({ syncInterval: '24h' });
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ syncInterval: '24h', autoSyncEnabled: undefined }),
        })
      );
    });

    it('should handle update settings error', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Invalid interval' }),
      });

      const { result } = renderHook(() => useUpdateSyncSettings(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await expect(result.current.mutateAsync({ syncInterval: '1h' })).rejects.toThrow('Invalid interval');
      });
    });

    it('should use fallback error message when error.error is undefined', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      });

      const { result } = renderHook(() => useUpdateSyncSettings(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await expect(result.current.mutateAsync({ syncInterval: '1h' })).rejects.toThrow('Failed to update settings');
      });
    });
  });

  // ============================================
  // useIdeationVideos Tests
  // ============================================

  describe('useIdeationVideos', () => {
    it('should fetch ideation videos successfully', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ videos: mockIdeationVideos }),
      });

      const { result } = renderHook(() => useIdeationVideos(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockIdeationVideos);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('action=get-ideation-videos'),
        expect.any(Object)
      );
    });

    it('should handle ideation videos error', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => useIdeationVideos(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe('Failed to get ideation videos');
    });

    it('should return empty array when no videos', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ videos: [] }),
      });

      const { result } = renderHook(() => useIdeationVideos(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual([]);
    });
  });

  // ============================================
  // useUpdateVideoState Tests
  // ============================================

  describe('useUpdateVideoState', () => {
    it('should update video state successfully', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const queryClient = createTestQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useUpdateVideoState(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          videoStateId: 'state-1',
          updates: {
            is_watched: true,
            user_note: 'Updated note',
          },
        });
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('action=update-video-state'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            videoStateId: 'state-1',
            updates: {
              is_watched: true,
              user_note: 'Updated note',
            },
          }),
        })
      );
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: youtubeSyncKeys.ideationVideos });
    });

    it('should update cell_index and sort_order', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const { result } = renderHook(() => useUpdateVideoState(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          videoStateId: 'state-1',
          updates: {
            cell_index: 5,
            level_id: 'level-2',
            sort_order: 3,
          },
        });
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('cell_index'),
        })
      );
    });

    it('should handle update video state error', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Video state not found' }),
      });

      const { result } = renderHook(() => useUpdateVideoState(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await expect(
          result.current.mutateAsync({
            videoStateId: 'invalid-state',
            updates: { is_watched: true },
          })
        ).rejects.toThrow('Video state not found');
      });
    });

    it('should use fallback error message when error.error is undefined', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      });

      const { result } = renderHook(() => useUpdateVideoState(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await expect(
          result.current.mutateAsync({
            videoStateId: 'state-1',
            updates: { is_watched: true },
          })
        ).rejects.toThrow('Failed to update video state');
      });
    });
  });

  // ============================================
  // useSyncAllPlaylists Tests
  // ============================================

  describe('useSyncAllPlaylists', () => {
    it('should sync all playlists successfully', async () => {
      // Use only 2 playlists for this test
      const twoPlaylists = mockPlaylists.slice(0, 2);

      // Use smart mock that handles requests based on URL pattern
      (global.fetch as Mock).mockImplementation((url: string) => {
        if (url.includes('action=list-playlists')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ playlists: twoPlaylists }),
          });
        }
        if (url.includes('action=sync-playlist')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockSyncResult),
          });
        }
        if (url.includes('action=get-ideation-videos')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ videos: [] }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      });

      const queryClient = createTestQueryClient();

      const { result } = renderHook(() => useSyncAllPlaylists(), {
        wrapper: createWrapper(queryClient),
      });

      // Wait for the playlists query to complete
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      // Small delay to ensure playlists are available
      await new Promise((resolve) => setTimeout(resolve, 100));

      let syncResult;
      await act(async () => {
        syncResult = await result.current.mutateAsync();
      });

      expect(syncResult).toEqual({
        synced: 2,
        failed: 0,
        errors: [],
      });
    });

    it('should handle partial failures', async () => {
      // Use only 2 playlists for this test
      const twoPlaylists = mockPlaylists.slice(0, 2);

      // Track sync call count to fail the second one
      let syncCallCount = 0;

      // Use smart mock with failure on second sync
      (global.fetch as Mock).mockImplementation((url: string) => {
        if (url.includes('action=list-playlists')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ playlists: twoPlaylists }),
          });
        }
        if (url.includes('action=sync-playlist')) {
          syncCallCount++;
          if (syncCallCount === 1) {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve(mockSyncResult),
            });
          }
          // Fail the second sync
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ error: 'Quota exceeded' }),
          });
        }
        if (url.includes('action=get-ideation-videos')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ videos: [] }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      });

      const queryClient = createTestQueryClient();

      const { result } = renderHook(() => useSyncAllPlaylists(), {
        wrapper: createWrapper(queryClient),
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      let syncResult;
      await act(async () => {
        syncResult = await result.current.mutateAsync();
      });

      expect(syncResult.synced).toBe(1);
      expect(syncResult.failed).toBe(1);
      expect(syncResult.errors).toHaveLength(1);
      expect(syncResult.errors[0]).toContain('TypeScript Deep Dive');
    });

    it('should return empty result when no playlists', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ playlists: [] }),
      });

      const queryClient = createTestQueryClient();

      const { result } = renderHook(() => useSyncAllPlaylists(), {
        wrapper: createWrapper(queryClient),
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      let syncResult;
      await act(async () => {
        syncResult = await result.current.mutateAsync();
      });

      expect(syncResult).toEqual({
        synced: 0,
        failed: 0,
        errors: [],
      });
    });

    it('should handle non-Error objects in catch block', async () => {
      // Use only 1 playlist for this test
      const onePlaylist = [mockPlaylists[0]];

      // Use smart mock that throws a non-Error value for sync
      (global.fetch as Mock).mockImplementation((url: string) => {
        if (url.includes('action=list-playlists')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ playlists: onePlaylist }),
          });
        }
        if (url.includes('action=sync-playlist')) {
          // Throw a non-Error value to trigger 'Unknown error' branch
          return Promise.reject('string error instead of Error object');
        }
        if (url.includes('action=get-ideation-videos')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ videos: [] }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      });

      const queryClient = createTestQueryClient();

      const { result } = renderHook(() => useSyncAllPlaylists(), {
        wrapper: createWrapper(queryClient),
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      let syncResult;
      await act(async () => {
        syncResult = await result.current.mutateAsync();
      });

      expect(syncResult.synced).toBe(0);
      expect(syncResult.failed).toBe(1);
      expect(syncResult.errors).toHaveLength(1);
      expect(syncResult.errors[0]).toContain('React Tutorials');
      expect(syncResult.errors[0]).toContain('Unknown error');
    });
  });

  // ============================================
  // useYouTubeSync Combined Hook Tests
  // ============================================

  describe('useYouTubeSync', () => {
    it('should return playlists data', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ playlists: mockPlaylists }),
      });

      const { result } = renderHook(() => useYouTubeSync(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.playlists).toEqual(mockPlaylists);
    });

    it('should return empty array when no playlists', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ playlists: [] }),
      });

      const { result } = renderHook(() => useYouTubeSync(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.playlists).toEqual([]);
    });

    it('should expose loading states', async () => {
      (global.fetch as Mock).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: () => Promise.resolve({ playlists: mockPlaylists }),
                }),
              100
            )
          )
      );

      const { result } = renderHook(() => useYouTubeSync(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.isAdding).toBe(false);
      expect(result.current.isSyncing).toBe(false);
      expect(result.current.isDeleting).toBe(false);
      expect(result.current.isSyncingAll).toBe(false);

      await waitFor(() => expect(result.current.isLoading).toBe(false));
    });

    it('should expose action functions', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ playlists: mockPlaylists }),
      });

      const { result } = renderHook(() => useYouTubeSync(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(typeof result.current.addPlaylist).toBe('function');
      expect(typeof result.current.syncPlaylist).toBe('function');
      expect(typeof result.current.deletePlaylist).toBe('function');
      expect(typeof result.current.updateSettings).toBe('function');
      expect(typeof result.current.syncAll).toBe('function');
      expect(typeof result.current.refetch).toBe('function');
    });

    it('should expose error state', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => useYouTubeSync(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.error).toBeTruthy());

      expect(result.current.error?.message).toBe('Failed to get playlists');
    });
  });

  // ============================================
  // Query Key Tests
  // ============================================

  describe('Query Keys', () => {
    it('should export correct query keys', () => {
      expect(youtubeSyncKeys.playlists).toEqual(['youtube', 'playlists']);
      expect(youtubeSyncKeys.playlist('test-id')).toEqual(['youtube', 'playlist', 'test-id']);
      expect(youtubeSyncKeys.ideationVideos).toEqual(['youtube', 'ideation-videos']);
    });
  });
});
