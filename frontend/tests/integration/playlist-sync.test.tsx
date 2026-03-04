/**
 * Playlist Sync Integration Tests
 *
 * Tests for playlist synchronization workflows including:
 * - Add playlist → list update
 * - Sync playlist → progress → stats update
 * - Delete playlist → confirmation → removal
 * - Batch sync all playlists
 * - Error recovery (network failure, quota exceeded)
 * - Query invalidation cascade verification
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { render, screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';

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
  useSyncAllPlaylists,
  useDeletePlaylist,
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
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
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
    youtubePlaylistId: 'PLxxxxxx1',
    title: 'Learning TypeScript',
    description: 'TypeScript tutorials',
    thumbnailUrl: 'https://i.ytimg.com/vi/xxx/default.jpg',
    videoCount: 25,
    lastSyncedAt: '2024-01-15T10:00:00Z',
    syncStatus: 'synced',
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'playlist-2',
    youtubePlaylistId: 'PLxxxxxx2',
    title: 'React Patterns',
    description: 'Advanced React patterns',
    thumbnailUrl: 'https://i.ytimg.com/vi/yyy/default.jpg',
    videoCount: 42,
    lastSyncedAt: '2024-01-14T15:30:00Z',
    syncStatus: 'synced',
    createdAt: '2024-01-02T00:00:00Z',
  },
];

const mockNewPlaylist = {
  id: 'playlist-3',
  youtubePlaylistId: 'PLxxxxxx3',
  title: 'Node.js Best Practices',
  description: 'Node.js tutorials and best practices',
  thumbnailUrl: 'https://i.ytimg.com/vi/zzz/default.jpg',
  videoCount: 18,
  lastSyncedAt: null,
  syncStatus: 'pending',
  createdAt: '2024-01-16T00:00:00Z',
};

// Mock sync result matching actual hook return type
const mockSyncResult = {
  success: true,
  itemsAdded: 2,
  itemsRemoved: 0,
  totalItems: 27,
  quotaUsed: 3,
};

// Updated playlist after sync for list refresh
const mockSyncedPlaylist = {
  ...mockPlaylists[0],
  videoCount: 27,
  lastSyncedAt: new Date().toISOString(),
  syncStatus: 'synced',
};

// ============================================
// Test Components
// ============================================

function PlaylistManager() {
  const {
    data: playlists,
    isLoading,
    error,
    refetch,
  } = useYouTubePlaylists();
  const addPlaylist = useAddPlaylist();
  const syncPlaylist = useSyncPlaylist();
  const syncAll = useSyncAllPlaylists();
  const deletePlaylist = useDeletePlaylist();
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleAdd = async () => {
    try {
      await addPlaylist.mutateAsync(playlistUrl);
      setPlaylistUrl('');
    } catch {
      // Error handled by mutation
    }
  };

  const handleSync = async (id: string) => {
    try {
      await syncPlaylist.mutateAsync(id);
    } catch {
      // Error handled by mutation
    }
  };

  const handleSyncAll = async () => {
    try {
      await syncAll.mutateAsync();
    } catch {
      // Error handled by mutation
    }
  };

  const handleDelete = async (id: string) => {
    if (deleteConfirmId === id) {
      try {
        await deletePlaylist.mutateAsync(id);
        setDeleteConfirmId(null);
      } catch {
        // Error handled by mutation
      }
    } else {
      setDeleteConfirmId(id);
    }
  };

  if (isLoading) return <div data-testid="loading">Loading playlists...</div>;
  if (error) return <div data-testid="error">{error.message}</div>;

  return (
    <div>
      <div data-testid="add-playlist-form">
        <input
          type="text"
          value={playlistUrl}
          onChange={(e) => setPlaylistUrl(e.target.value)}
          placeholder="Enter playlist URL"
          data-testid="playlist-url-input"
        />
        <button
          onClick={handleAdd}
          disabled={addPlaylist.isPending || !playlistUrl}
          data-testid="add-playlist-btn"
        >
          {addPlaylist.isPending ? 'Adding...' : 'Add Playlist'}
        </button>
        {addPlaylist.isError && (
          <span data-testid="add-error">{addPlaylist.error.message}</span>
        )}
      </div>

      <button
        onClick={handleSyncAll}
        disabled={syncAll.isPending}
        data-testid="sync-all-btn"
      >
        {syncAll.isPending ? 'Syncing All...' : 'Sync All'}
      </button>
      {(syncAll.isError || (syncAll.data && syncAll.data.failed > 0)) && (
        <span data-testid="sync-all-error">
          {syncAll.isError
            ? syncAll.error.message
            : `${syncAll.data?.failed} playlists failed to sync`}
        </span>
      )}

      <div data-testid="playlist-count">
        {playlists?.length ?? 0} playlists
      </div>

      <ul data-testid="playlist-list">
        {playlists?.map((playlist) => (
          <li key={playlist.id} data-testid={`playlist-${playlist.id}`}>
            <span data-testid={`title-${playlist.id}`}>{playlist.title}</span>
            <span data-testid={`video-count-${playlist.id}`}>
              {playlist.videoCount} videos
            </span>
            <span data-testid={`sync-status-${playlist.id}`}>
              {playlist.syncStatus}
            </span>
            <button
              onClick={() => handleSync(playlist.id)}
              disabled={syncPlaylist.isPending}
              data-testid={`sync-btn-${playlist.id}`}
            >
              {syncPlaylist.isPending && syncPlaylist.variables === playlist.id
                ? 'Syncing...'
                : 'Sync'}
            </button>
            <button
              onClick={() => handleDelete(playlist.id)}
              disabled={deletePlaylist.isPending}
              data-testid={`delete-btn-${playlist.id}`}
            >
              {deleteConfirmId === playlist.id ? 'Confirm Delete' : 'Delete'}
            </button>
          </li>
        ))}
      </ul>

      {syncPlaylist.isSuccess && syncPlaylist.data && (
        <div data-testid="sync-result">
          Synced: +{syncPlaylist.data.itemsAdded} added,{' '}
          {syncPlaylist.data.itemsRemoved} removed
        </div>
      )}
    </div>
  );
}

// ============================================
// Test Suite
// ============================================

describe('Playlist Sync Integration', () => {
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
  // Playlist List Display
  // ============================================

  describe('playlist list display', () => {
    it('should display list of playlists', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ playlists: mockPlaylists }),
      });

      render(<PlaylistManager />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('playlist-count')).toHaveTextContent('2 playlists');
      });

      expect(screen.getByTestId('title-playlist-1')).toHaveTextContent('Learning TypeScript');
      expect(screen.getByTestId('title-playlist-2')).toHaveTextContent('React Patterns');
    });

    it('should show loading state while fetching', async () => {
      (global.fetch as Mock).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({
          ok: true,
          json: () => Promise.resolve({ playlists: mockPlaylists }),
        }), 100))
      );

      render(<PlaylistManager />, { wrapper: createWrapper() });

      expect(screen.getByTestId('loading')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });
    });

    it('should show error state on fetch failure', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      render(<PlaylistManager />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('error')).toBeInTheDocument();
      });
    });
  });

  // ============================================
  // Add Playlist
  // ============================================

  describe('add playlist → list update', () => {
    it('should add playlist and update list', async () => {
      const user = userEvent.setup();
      const queryClient = createTestQueryClient();

      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlists: mockPlaylists }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlist: mockNewPlaylist }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlists: [...mockPlaylists, mockNewPlaylist] }),
        });

      render(<PlaylistManager />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('playlist-count')).toHaveTextContent('2 playlists');
      });

      const input = screen.getByTestId('playlist-url-input');
      await user.type(input, 'https://www.youtube.com/playlist?list=PLxxxxxx3');

      await user.click(screen.getByTestId('add-playlist-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('playlist-count')).toHaveTextContent('3 playlists');
      });

      expect(screen.getByTestId('title-playlist-3')).toHaveTextContent('Node.js Best Practices');
    });

    it('should show adding state during add', async () => {
      const user = userEvent.setup();
      let resolveAdd: (value: unknown) => void;

      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlists: mockPlaylists }),
        })
        .mockImplementationOnce(
          () => new Promise((resolve) => {
            resolveAdd = resolve;
          })
        );

      render(<PlaylistManager />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('add-playlist-btn')).toBeDisabled();
      });

      const input = screen.getByTestId('playlist-url-input');
      await user.type(input, 'https://www.youtube.com/playlist?list=PLxxxxxx3');

      await waitFor(() => {
        expect(screen.getByTestId('add-playlist-btn')).toBeEnabled();
      });

      await user.click(screen.getByTestId('add-playlist-btn'));

      // Check adding state immediately
      await waitFor(() => {
        expect(screen.getByTestId('add-playlist-btn')).toHaveTextContent('Adding...');
      });

      // Resolve the add request
      resolveAdd!({
        ok: true,
        json: () => Promise.resolve({ playlist: mockNewPlaylist }),
      });
    });

    it('should show error on add failure', async () => {
      const user = userEvent.setup();

      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlists: mockPlaylists }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: 'Invalid playlist URL' }),
        });

      render(<PlaylistManager />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('add-playlist-btn')).toBeInTheDocument();
      });

      const input = screen.getByTestId('playlist-url-input');
      await user.type(input, 'invalid-url');

      await user.click(screen.getByTestId('add-playlist-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('add-error')).toBeInTheDocument();
      });
    });

    it('should disable add button when input is empty', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ playlists: mockPlaylists }),
      });

      render(<PlaylistManager />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('add-playlist-btn')).toBeDisabled();
      });
    });
  });

  // ============================================
  // Sync Playlist
  // ============================================

  describe('sync playlist → progress → stats update', () => {
    it('should sync playlist and show updated stats', async () => {
      const user = userEvent.setup();
      const queryClient = createTestQueryClient();

      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlists: mockPlaylists }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSyncResult),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            playlists: [mockSyncedPlaylist, mockPlaylists[1]],
          }),
        });

      render(<PlaylistManager />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('sync-btn-playlist-1')).toBeEnabled();
      });

      await user.click(screen.getByTestId('sync-btn-playlist-1'));

      await waitFor(() => {
        expect(screen.getByTestId('sync-result')).toHaveTextContent('+2 added');
      });
    });

    it('should show syncing state during sync', async () => {
      const user = userEvent.setup();

      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlists: mockPlaylists }),
        })
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({
            ok: true,
            json: () => Promise.resolve(mockSyncResult),
          }), 100))
        );

      render(<PlaylistManager />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('sync-btn-playlist-1')).toBeEnabled();
      });

      await user.click(screen.getByTestId('sync-btn-playlist-1'));

      expect(screen.getByTestId('sync-btn-playlist-1')).toHaveTextContent('Syncing...');
    });

    it('should update video count after sync', async () => {
      const user = userEvent.setup();
      const queryClient = createTestQueryClient();

      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlists: mockPlaylists }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSyncResult),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            playlists: [mockSyncedPlaylist, mockPlaylists[1]],
          }),
        });

      render(<PlaylistManager />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('video-count-playlist-1')).toHaveTextContent('25 videos');
      });

      await user.click(screen.getByTestId('sync-btn-playlist-1'));

      await waitFor(() => {
        expect(screen.getByTestId('video-count-playlist-1')).toHaveTextContent('27 videos');
      });
    });
  });

  // ============================================
  // Sync All Playlists
  // ============================================

  describe('batch sync all playlists', () => {
    it('should sync all playlists', async () => {
      const user = userEvent.setup();
      const queryClient = createTestQueryClient();

      // Use mockImplementation with URL routing since sync operations trigger multiple refetches
      (global.fetch as Mock).mockImplementation((url: string, options?: RequestInit) => {
        const urlStr = url.toString();

        if (urlStr.includes('action=list-playlists')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ playlists: mockPlaylists }),
          });
        }

        if (urlStr.includes('action=sync-playlist')) {
          // Add delay to allow capturing the loading state
          return new Promise((resolve) => setTimeout(() => resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              itemsAdded: 2,
              itemsRemoved: 0,
              totalItems: 27,
              quotaUsed: 5,
            }),
          }), 50));
        }

        if (urlStr.includes('action=get-ideation-videos')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ videos: [] }),
          });
        }

        // Default fallback
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      });

      render(<PlaylistManager />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('sync-all-btn')).toBeEnabled();
      });

      await user.click(screen.getByTestId('sync-all-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('sync-all-btn')).toHaveTextContent('Syncing All...');
      });

      await waitFor(() => {
        expect(screen.getByTestId('sync-all-btn')).toHaveTextContent('Sync All');
      });
    });

    it('should show error when sync all fails', async () => {
      const user = userEvent.setup();

      // Use URL-based routing since sync operations trigger multiple refetches
      (global.fetch as Mock).mockImplementation((url: string) => {
        const urlStr = url.toString();

        if (urlStr.includes('action=list-playlists')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ playlists: mockPlaylists }),
          });
        }

        if (urlStr.includes('action=sync-playlist')) {
          // All syncs fail
          return new Promise((resolve) => setTimeout(() => resolve({
            ok: false,
            status: 500,
            json: () => Promise.resolve({ error: 'Sync failed' }),
          }), 50));
        }

        if (urlStr.includes('action=get-ideation-videos')) {
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

      render(<PlaylistManager />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('sync-all-btn')).toBeEnabled();
      });

      await user.click(screen.getByTestId('sync-all-btn'));

      await waitFor(() => {
        const errorEl = screen.getByTestId('sync-all-error');
        expect(errorEl).toBeInTheDocument();
        expect(errorEl).toHaveTextContent('2 playlists failed to sync');
      });
    });
  });

  // ============================================
  // Delete Playlist
  // ============================================

  describe('delete playlist → confirmation → removal', () => {
    it('should require confirmation before deleting', async () => {
      const user = userEvent.setup();

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ playlists: mockPlaylists }),
      });

      render(<PlaylistManager />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('delete-btn-playlist-1')).toBeEnabled();
      });

      // First click shows confirmation
      await user.click(screen.getByTestId('delete-btn-playlist-1'));

      expect(screen.getByTestId('delete-btn-playlist-1')).toHaveTextContent('Confirm Delete');
    });

    it('should delete playlist after confirmation', async () => {
      const user = userEvent.setup();
      const queryClient = createTestQueryClient();

      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlists: mockPlaylists }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlists: [mockPlaylists[1]] }),
        });

      render(<PlaylistManager />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('playlist-count')).toHaveTextContent('2 playlists');
      });

      // First click for confirmation
      await user.click(screen.getByTestId('delete-btn-playlist-1'));
      // Second click to confirm
      await user.click(screen.getByTestId('delete-btn-playlist-1'));

      await waitFor(() => {
        expect(screen.getByTestId('playlist-count')).toHaveTextContent('1 playlists');
      });

      expect(screen.queryByTestId('playlist-playlist-1')).not.toBeInTheDocument();
    });
  });

  // ============================================
  // Error Recovery
  // ============================================

  describe('error recovery', () => {
    it('should handle network failure and allow retry', async () => {
      const user = userEvent.setup();

      (global.fetch as Mock)
        // Initial playlist list
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlists: mockPlaylists }),
        })
        // First sync fails with network error
        .mockRejectedValueOnce(new Error('Network error'))
        // Retry sync succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSyncResult),
        })
        // Refetch playlists after successful sync
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlists: mockPlaylists }),
        })
        // Refetch ideation videos after successful sync
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ videos: [] }),
        });

      render(<PlaylistManager />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('sync-btn-playlist-1')).toBeEnabled();
      });

      // First sync fails
      await user.click(screen.getByTestId('sync-btn-playlist-1'));

      await waitFor(() => {
        expect(screen.getByTestId('sync-btn-playlist-1')).toBeEnabled();
      });

      // Retry succeeds
      await user.click(screen.getByTestId('sync-btn-playlist-1'));

      await waitFor(() => {
        expect(screen.getByTestId('sync-result')).toBeInTheDocument();
      });
    });

    it('should handle quota exceeded error', async () => {
      const user = userEvent.setup();

      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlists: mockPlaylists }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: () => Promise.resolve({ error: 'Quota exceeded' }),
        });

      render(<PlaylistManager />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('sync-btn-playlist-1')).toBeEnabled();
      });

      await user.click(screen.getByTestId('sync-btn-playlist-1'));

      // Button should be enabled for retry after error
      await waitFor(() => {
        expect(screen.getByTestId('sync-btn-playlist-1')).toBeEnabled();
        expect(screen.getByTestId('sync-btn-playlist-1')).toHaveTextContent('Sync');
      });
    });
  });

  // ============================================
  // Query Invalidation
  // ============================================

  describe('query invalidation cascade', () => {
    it('should invalidate playlists after add', async () => {
      const user = userEvent.setup();
      const queryClient = createTestQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlists: mockPlaylists }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlist: mockNewPlaylist }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlists: [...mockPlaylists, mockNewPlaylist] }),
        });

      render(<PlaylistManager />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('add-playlist-btn')).toBeInTheDocument();
      });

      const input = screen.getByTestId('playlist-url-input');
      await user.type(input, 'https://www.youtube.com/playlist?list=PLxxxxxx3');

      await user.click(screen.getByTestId('add-playlist-btn'));

      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: youtubeSyncKeys.playlists });
      });
    });

    it('should invalidate playlists after sync', async () => {
      const user = userEvent.setup();
      const queryClient = createTestQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlists: mockPlaylists }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSyncResult),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlists: mockPlaylists }),
        });

      render(<PlaylistManager />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('sync-btn-playlist-1')).toBeEnabled();
      });

      await user.click(screen.getByTestId('sync-btn-playlist-1'));

      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: youtubeSyncKeys.playlists });
      });
    });

    it('should invalidate playlists after delete', async () => {
      const user = userEvent.setup();
      const queryClient = createTestQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlists: mockPlaylists }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ playlists: [mockPlaylists[1]] }),
        });

      render(<PlaylistManager />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('delete-btn-playlist-1')).toBeEnabled();
      });

      await user.click(screen.getByTestId('delete-btn-playlist-1'));
      await user.click(screen.getByTestId('delete-btn-playlist-1'));

      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: youtubeSyncKeys.playlists });
      });
    });
  });
});
