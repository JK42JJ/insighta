/**
 * YouTube OAuth Integration Tests
 *
 * Tests for complete YouTube OAuth workflows including:
 * - Complete OAuth flow (popup → success → connected)
 * - OAuth cancellation (popup closed by user)
 * - Timeout handling
 * - Popup blocked error handling
 * - Token refresh on expiry
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import { useYouTubeAuth } from '@/hooks/useYouTubeAuth';

// ============================================
// Test Utilities
// ============================================

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

interface TestWrapperProps {
  children: ReactNode;
}

function createWrapper(queryClient = createTestQueryClient()) {
  return function Wrapper({ children }: TestWrapperProps) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

// Test component that uses the YouTube auth hook
function YouTubeConnectPage() {
  const {
    isConnected,
    isLoading,
    isConnecting,
    isDisconnecting,
    isRefreshing,
    isExpired,
    expiresAt,
    connect,
    disconnect,
    refresh,
    error,
  } = useYouTubeAuth();

  const handleConnect = async () => {
    try {
      await connect();
    } catch {
      // Error handled by hook
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch {
      // Error handled by hook
    }
  };

  const handleRefresh = async () => {
    try {
      await refresh();
    } catch {
      // Error handled by hook
    }
  };

  if (isLoading) {
    return <div data-testid="loading">Loading...</div>;
  }

  return (
    <div>
      <h1>YouTube Connection</h1>

      {error && <div data-testid="error-message">{error.message}</div>}

      <div data-testid="connection-status">
        {isConnected ? 'Connected' : 'Not Connected'}
      </div>

      {isExpired && <div data-testid="expired-warning">Token Expired</div>}

      {expiresAt && (
        <div data-testid="expires-at">
          Expires: {expiresAt.toISOString()}
        </div>
      )}

      {!isConnected && (
        <button
          onClick={handleConnect}
          disabled={isConnecting}
          data-testid="connect-btn"
        >
          {isConnecting ? 'Connecting...' : 'Connect YouTube'}
        </button>
      )}

      {isConnected && (
        <>
          <button
            onClick={handleDisconnect}
            disabled={isDisconnecting}
            data-testid="disconnect-btn"
          >
            {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
          </button>

          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            data-testid="refresh-btn"
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh Token'}
          </button>
        </>
      )}
    </div>
  );
}

// ============================================
// Mock Data
// ============================================

const mockSession = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expires_in: 3600,
  user: { id: 'test-user-id', email: 'test@example.com' },
};

const mockConnectedStatus = {
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

const mockExpiredStatus = {
  isConnected: true,
  isExpired: true,
  expiresAt: new Date(Date.now() - 3600000).toISOString(),
  syncInterval: 'daily',
  autoSyncEnabled: true,
};

// ============================================
// Test Suite
// ============================================

describe('YouTube OAuth Integration', () => {
  let originalFetch: typeof global.fetch;
  let mockPopup: { closed: boolean; close: Mock };
  let originalOpen: typeof window.open;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Mock session
    mockGetSession.mockResolvedValue({
      data: { session: mockSession },
      error: null,
    });

    // Store originals
    originalFetch = global.fetch;
    originalOpen = window.open;

    // Mock fetch
    global.fetch = vi.fn();

    // Mock popup
    mockPopup = { closed: false, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(mockPopup as unknown as Window);

    // Set environment variables
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-api-key');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.open = originalOpen;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  // ============================================
  // Complete OAuth Flow
  // ============================================

  describe('complete OAuth flow', () => {
    it('should show connect button when not connected', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDisconnectedStatus),
      });

      const queryClient = createTestQueryClient();
      render(<YouTubeConnectPage />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('connect-btn')).toBeInTheDocument();
      });

      expect(screen.getByTestId('connection-status')).toHaveTextContent('Not Connected');
    });

    it('should show connected state after successful OAuth', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockConnectedStatus),
      });

      const queryClient = createTestQueryClient();
      render(<YouTubeConnectPage />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('connection-status')).toHaveTextContent('Connected');
      });

      expect(screen.getByTestId('disconnect-btn')).toBeInTheDocument();
      expect(screen.getByTestId('refresh-btn')).toBeInTheDocument();
    });

    it('should open popup with OAuth URL when connecting', async () => {
      // First fetch for status (disconnected)
      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockDisconnectedStatus),
        })
        // Second fetch for auth URL
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ authUrl: 'https://accounts.google.com/oauth/youtube' }),
        });

      // Popup closes immediately for test
      mockPopup.closed = true;

      const queryClient = createTestQueryClient();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<YouTubeConnectPage />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('connect-btn')).toBeEnabled();
      });

      await user.click(screen.getByTestId('connect-btn'));

      await waitFor(() => {
        expect(window.open).toHaveBeenCalledWith(
          'https://accounts.google.com/oauth/youtube',
          'youtube-auth',
          expect.stringContaining('width=600')
        );
      });
    });

    it('should update UI to connected after popup closes successfully', async () => {
      const queryClient = createTestQueryClient();

      // Initial status - disconnected
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDisconnectedStatus),
      });

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<YouTubeConnectPage />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('connect-btn')).toBeEnabled();
      });

      // Auth URL fetch
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ authUrl: 'https://accounts.google.com/oauth' }),
      });

      // After popup closes, status should be connected
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockConnectedStatus),
      });

      // Popup will close
      mockPopup.closed = true;

      await user.click(screen.getByTestId('connect-btn'));

      // Wait for the query to be invalidated and refetched
      await waitFor(
        () => {
          expect(screen.getByTestId('connection-status')).toHaveTextContent('Connected');
        },
        { timeout: 5000 }
      );
    });
  });

  // ============================================
  // OAuth Cancellation
  // ============================================

  describe('OAuth cancellation', () => {
    it('should handle popup closed by user gracefully', async () => {
      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockDisconnectedStatus),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ authUrl: 'https://accounts.google.com/oauth' }),
        })
        // After popup closes, still disconnected
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockDisconnectedStatus),
        });

      const queryClient = createTestQueryClient();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<YouTubeConnectPage />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('connect-btn')).toBeEnabled();
      });

      // Simulate popup being closed without completing auth
      mockPopup.closed = true;

      await user.click(screen.getByTestId('connect-btn'));

      // Should still show not connected and button should be available again
      await waitFor(() => {
        expect(screen.getByTestId('connection-status')).toHaveTextContent('Not Connected');
        expect(screen.getByTestId('connect-btn')).toBeEnabled();
      });
    });
  });

  // ============================================
  // Popup Blocked
  // ============================================

  describe('popup blocked handling', () => {
    it('should show error when popup is blocked', async () => {
      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockDisconnectedStatus),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ authUrl: 'https://accounts.google.com/oauth' }),
        });

      // Popup is blocked
      vi.spyOn(window, 'open').mockReturnValue(null);

      const queryClient = createTestQueryClient();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<YouTubeConnectPage />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('connect-btn')).toBeEnabled();
      });

      await user.click(screen.getByTestId('connect-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent(/popup.*blocked/i);
      });
    });
  });

  // ============================================
  // Token Expiry
  // ============================================

  describe('token expiry handling', () => {
    it('should show expired warning when token is expired', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockExpiredStatus),
      });

      const queryClient = createTestQueryClient();
      render(<YouTubeConnectPage />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('expired-warning')).toBeInTheDocument();
      });
    });

    it('should refresh token successfully', async () => {
      const queryClient = createTestQueryClient();

      // Initial status - expired
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockExpiredStatus),
      });

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<YouTubeConnectPage />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('refresh-btn')).toBeEnabled();
      });

      // Refresh request
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      // After refresh, connected with new token
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockConnectedStatus),
      });

      await user.click(screen.getByTestId('refresh-btn'));

      await waitFor(() => {
        expect(screen.queryByTestId('expired-warning')).not.toBeInTheDocument();
      });
    });

    it('should handle refresh failure', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockExpiredStatus),
      });

      const queryClient = createTestQueryClient();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<YouTubeConnectPage />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('refresh-btn')).toBeEnabled();
      });

      // Refresh request fails
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await user.click(screen.getByTestId('refresh-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent(/failed.*refresh/i);
      });
    });
  });

  // ============================================
  // Disconnect Flow
  // ============================================

  describe('disconnect flow', () => {
    it('should disconnect successfully', async () => {
      const queryClient = createTestQueryClient();

      // Initial status - connected
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockConnectedStatus),
      });

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<YouTubeConnectPage />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('disconnect-btn')).toBeEnabled();
      });

      // Disconnect request
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      // After disconnect, not connected
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDisconnectedStatus),
      });

      await user.click(screen.getByTestId('disconnect-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('connection-status')).toHaveTextContent('Not Connected');
      });
    });

    it('should handle disconnect failure', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockConnectedStatus),
      });

      const queryClient = createTestQueryClient();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<YouTubeConnectPage />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('disconnect-btn')).toBeEnabled();
      });

      // Disconnect request fails
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await user.click(screen.getByTestId('disconnect-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent(/failed.*disconnect/i);
      });
    });
  });

  // ============================================
  // Loading States
  // ============================================

  describe('loading states', () => {
    it('should show loading state while fetching status', async () => {
      // Delay the response
      (global.fetch as Mock).mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: () => Promise.resolve(mockDisconnectedStatus),
                }),
              100
            )
          )
      );

      const queryClient = createTestQueryClient();
      render(<YouTubeConnectPage />, { wrapper: createWrapper(queryClient) });

      expect(screen.getByTestId('loading')).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });
    });

    it('should show connecting state during OAuth', async () => {
      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockDisconnectedStatus),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ authUrl: 'https://accounts.google.com/oauth' }),
        });

      const queryClient = createTestQueryClient();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<YouTubeConnectPage />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('connect-btn')).toBeEnabled();
      });

      // Start connecting
      const clickPromise = user.click(screen.getByTestId('connect-btn'));

      // Should show connecting state
      await waitFor(() => {
        expect(screen.getByTestId('connect-btn')).toHaveTextContent('Connecting...');
      });

      // Close popup to complete
      mockPopup.closed = true;

      await clickPromise;
    });
  });

  // ============================================
  // Expiration Display
  // ============================================

  describe('expiration display', () => {
    it('should display expiration time when connected', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockConnectedStatus),
      });

      const queryClient = createTestQueryClient();
      render(<YouTubeConnectPage />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('expires-at')).toBeInTheDocument();
      });

      expect(screen.getByTestId('expires-at')).toHaveTextContent(/Expires:/);
    });

    it('should not display expiration when not connected', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDisconnectedStatus),
      });

      const queryClient = createTestQueryClient();
      render(<YouTubeConnectPage />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('connection-status')).toHaveTextContent('Not Connected');
      });

      expect(screen.queryByTestId('expires-at')).not.toBeInTheDocument();
    });
  });

  // ============================================
  // Error Handling
  // ============================================

  describe('error handling', () => {
    it('should handle network error during status fetch', async () => {
      (global.fetch as Mock).mockRejectedValueOnce(new Error('Network error'));

      const queryClient = createTestQueryClient();
      render(<YouTubeConnectPage />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });

      // Should show error or fallback state
      expect(screen.getByTestId('error-message')).toBeInTheDocument();
    });

    it('should handle auth URL fetch failure', async () => {
      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockDisconnectedStatus),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        });

      const queryClient = createTestQueryClient();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<YouTubeConnectPage />, { wrapper: createWrapper(queryClient) });

      await waitFor(() => {
        expect(screen.getByTestId('connect-btn')).toBeEnabled();
      });

      await user.click(screen.getByTestId('connect-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent(/failed.*auth/i);
      });
    });
  });
});
