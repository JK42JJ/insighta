/**
 * useYouTubeAuth Hook Tests
 *
 * Tests for YouTube OAuth authentication hooks including popup flow,
 * timeout handling, postMessage handling, and token refresh.
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
      refreshSession: () => Promise.resolve({ data: { session: null }, error: null }),
    },
  },
}));

// Import after mocking
import {
  useYouTubeAuthStatus,
  useYouTubeConnect,
  useYouTubeDisconnect,
  useYouTubeRefreshToken,
  useYouTubeAuth,
  youtubeAuthKeys,
} from '@/hooks/useYouTubeAuth';

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

const mockAuthStatus = {
  isConnected: true,
  isExpired: false,
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  syncInterval: 'daily',
  autoSyncEnabled: true,
};

const mockDisconnectedStatus = {
  isConnected: false,
  isExpired: null,
  expiresAt: null,
  syncInterval: 'manual',
  autoSyncEnabled: false,
};

// ============================================
// Setup
// ============================================

describe('YouTube Auth Hooks', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock session
    mockGetSession.mockResolvedValue({
      data: { session: mockSession },
      error: null,
    });

    // Store originals
    originalFetch = global.fetch;

    // Mock fetch
    global.fetch = vi.fn();

    // Set environment variables
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-api-key');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  // ============================================
  // useYouTubeAuthStatus Tests
  // ============================================

  describe('useYouTubeAuthStatus', () => {
    it('should fetch auth status successfully', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAuthStatus),
      });

      const { result } = renderHook(() => useYouTubeAuthStatus(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockAuthStatus);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('action=status'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockSession.access_token}`,
            apikey: 'test-api-key',
          }),
        })
      );
    });

    it('should handle fetch error', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => useYouTubeAuthStatus(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeDefined();
    });

    it('should throw error when not authenticated', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: null },
        error: null,
      });

      const { result } = renderHook(() => useYouTubeAuthStatus(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe('Not authenticated');
    });

    it('should return disconnected status', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDisconnectedStatus),
      });

      const { result } = renderHook(() => useYouTubeAuthStatus(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.isConnected).toBe(false);
    });
  });

  // ============================================
  // useYouTubeConnect Tests
  // ============================================

  describe('useYouTubeConnect', () => {
    let mockPopup: { closed: boolean; close: Mock };

    beforeEach(() => {
      mockPopup = { closed: false, close: vi.fn() };
      vi.spyOn(window, 'open').mockReturnValue(mockPopup as unknown as Window);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should open OAuth popup with correct URL', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ authUrl: 'https://accounts.google.com/oauth' }),
      });

      // Simulate popup closing immediately for test to complete
      mockPopup.closed = true;

      const { result } = renderHook(() => useYouTubeConnect(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(window.open).toHaveBeenCalled());

      expect(window.open).toHaveBeenCalledWith(
        'https://accounts.google.com/oauth',
        'youtube-auth',
        expect.stringContaining('width=600')
      );
    });

    it('should reject when popup is blocked', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ authUrl: 'https://accounts.google.com/oauth' }),
      });
      vi.spyOn(window, 'open').mockReturnValue(null);

      const { result } = renderHook(() => useYouTubeConnect(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toContain('Popup blocked');
    });

    it('should resolve when popup is closed by user', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ authUrl: 'https://accounts.google.com/oauth' }),
      });

      const { result } = renderHook(() => useYouTubeConnect(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate();
      });

      // Simulate popup being closed
      mockPopup.closed = true;

      await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 3000 });
    });

    it('should invalidate queries on success', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ authUrl: 'https://accounts.google.com/oauth' }),
      });

      const queryClient = createTestQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      // Popup closes immediately
      mockPopup.closed = true;

      const { result } = renderHook(() => useYouTubeConnect(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 3000 });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: youtubeAuthKeys.status });
    });

    it('should handle auth URL fetch error', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => useYouTubeConnect(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe('Failed to get auth URL');
    });

    it('should resolve on postMessage youtube-auth-success', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ authUrl: 'https://accounts.google.com/oauth' }),
      });

      const queryClient = createTestQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useYouTubeConnect(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      // Wait for popup to be opened
      await waitFor(() => expect(window.open).toHaveBeenCalled());

      // Simulate postMessage from OAuth callback
      await act(async () => {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'youtube-auth-success' },
        }));
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockPopup.close).toHaveBeenCalled();
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: youtubeAuthKeys.status });
    });

    it('should ignore unrelated postMessage events', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ authUrl: 'https://accounts.google.com/oauth' }),
      });

      const { result } = renderHook(() => useYouTubeConnect(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate();
      });

      // Wait for popup to be opened
      await waitFor(() => expect(window.open).toHaveBeenCalled());

      // Send unrelated message - should be ignored
      await act(async () => {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'some-other-event' },
        }));
      });

      // Popup should not be closed by unrelated message
      expect(mockPopup.close).not.toHaveBeenCalled();

      // Now close popup manually to complete the test
      mockPopup.closed = true;
      await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 3000 });
    });

    it('should reject on timeout after 5 minutes', async () => {
      vi.useFakeTimers();

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ authUrl: 'https://accounts.google.com/oauth' }),
      });

      const { result } = renderHook(() => useYouTubeConnect(), {
        wrapper: createWrapper(),
      });

      // Start the mutation (don't await)
      act(() => {
        result.current.mutate();
      });

      // Run pending microtasks to allow fetch to complete
      await vi.advanceTimersByTimeAsync(0);

      // Verify popup was opened
      expect(window.open).toHaveBeenCalled();

      // Advance time by 5 minutes to trigger timeout
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      });

      // Wait for mutation state to update
      await vi.advanceTimersByTimeAsync(100);

      expect(result.current.isError).toBe(true);
      expect(result.current.error?.message).toBe('Authentication timeout');
      expect(mockPopup.close).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should not call popup.close() when popup is already closed on timeout', async () => {
      vi.useFakeTimers();

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ authUrl: 'https://accounts.google.com/oauth' }),
      });

      // Keep popup open initially
      mockPopup.closed = false;

      const { result } = renderHook(() => useYouTubeConnect(), {
        wrapper: createWrapper(),
      });

      // Start the mutation
      act(() => {
        result.current.mutate();
      });

      // Run pending microtasks to allow fetch to complete
      await vi.advanceTimersByTimeAsync(0);

      // Verify popup was opened
      expect(window.open).toHaveBeenCalled();

      // Clear any previous calls to mockPopup.close
      mockPopup.close.mockClear();

      // Advance to just before timeout (keep popup open)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
      });

      // Now set popup as closed (simulating user closing it right before timeout)
      mockPopup.closed = true;

      // Advance past timeout
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1 * 60 * 1000 + 100);
      });

      // Verify popup.close() was NOT called because popup.closed was already true
      expect(mockPopup.close).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  // ============================================
  // useYouTubeDisconnect Tests
  // ============================================

  describe('useYouTubeDisconnect', () => {
    it('should disconnect successfully', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const queryClient = createTestQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useYouTubeDisconnect(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('action=disconnect'),
        expect.objectContaining({
          method: 'POST',
        })
      );
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: youtubeAuthKeys.status });
    });

    it('should handle disconnect error', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => useYouTubeDisconnect(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe('Failed to disconnect');
    });
  });

  // ============================================
  // useYouTubeRefreshToken Tests
  // ============================================

  describe('useYouTubeRefreshToken', () => {
    it('should refresh token successfully', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const queryClient = createTestQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useYouTubeRefreshToken(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('action=refresh'),
        expect.objectContaining({
          method: 'POST',
        })
      );
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: youtubeAuthKeys.status });
    });

    it('should handle refresh error', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const { result } = renderHook(() => useYouTubeRefreshToken(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe('Failed to refresh token');
    });
  });

  // ============================================
  // useYouTubeAuth Combined Hook Tests
  // ============================================

  describe('useYouTubeAuth', () => {
    it('should return connected state correctly', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAuthStatus),
      });

      const { result } = renderHook(() => useYouTubeAuth(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.isConnected).toBe(true);
      expect(result.current.isExpired).toBe(false);
      expect(result.current.syncInterval).toBe('daily');
      expect(result.current.autoSyncEnabled).toBe(true);
    });

    it('should return disconnected state correctly', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDisconnectedStatus),
      });

      const { result } = renderHook(() => useYouTubeAuth(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.isConnected).toBe(false);
      expect(result.current.syncInterval).toBe('manual');
      expect(result.current.autoSyncEnabled).toBe(false);
    });

    it('should provide loading states', async () => {
      (global.fetch as Mock).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({
          ok: true,
          json: () => Promise.resolve(mockAuthStatus),
        }), 100))
      );

      const { result } = renderHook(() => useYouTubeAuth(), {
        wrapper: createWrapper(),
      });

      // Initially loading
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isConnecting).toBe(false);
      expect(result.current.isDisconnecting).toBe(false);
      expect(result.current.isRefreshing).toBe(false);

      await waitFor(() => expect(result.current.isLoading).toBe(false));
    });

    it('should convert expiresAt string to Date', async () => {
      const expiresAtDate = new Date(Date.now() + 3600000);
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ...mockAuthStatus,
          expiresAt: expiresAtDate.toISOString(),
        }),
      });

      const { result } = renderHook(() => useYouTubeAuth(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.expiresAt).toBeInstanceOf(Date);
    });

    it('should return null expiresAt when not set', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ...mockDisconnectedStatus,
          expiresAt: null,
        }),
      });

      const { result } = renderHook(() => useYouTubeAuth(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.expiresAt).toBeNull();
    });

    it('should provide refetch capability', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAuthStatus),
      });

      const { result } = renderHook(() => useYouTubeAuth(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(typeof result.current.refetch).toBe('function');
    });

    it('should expose connect action', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDisconnectedStatus),
      });

      const { result } = renderHook(() => useYouTubeAuth(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(typeof result.current.connect).toBe('function');
    });

    it('should expose disconnect action', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAuthStatus),
      });

      const { result } = renderHook(() => useYouTubeAuth(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(typeof result.current.disconnect).toBe('function');
    });

    it('should expose refresh action', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAuthStatus),
      });

      const { result } = renderHook(() => useYouTubeAuth(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(typeof result.current.refresh).toBe('function');
    });
  });

  // ============================================
  // Query Key Tests
  // ============================================

  describe('Query Keys', () => {
    it('should export correct query keys', () => {
      expect(youtubeAuthKeys.status).toEqual(['youtube', 'auth', 'status']);
    });
  });
});
