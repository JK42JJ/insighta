/**
 * Authentication Flow Integration Tests
 *
 * Tests for complete authentication workflows including:
 * - Google OAuth sign-in flow
 * - Session persistence across page refresh
 * - Session expiry and redirect
 * - Error handling and display
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Mock Supabase client
const mockGetSession = vi.fn();
const mockSignInWithOAuth = vi.fn();
const mockSignOut = vi.fn();
const mockOnAuthStateChange = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      refreshSession: () => Promise.resolve({ data: { session: null }, error: null }),
      signInWithOAuth: (opts: unknown) => mockSignInWithOAuth(opts),
      signOut: () => mockSignOut(),
      onAuthStateChange: (cb: unknown) => mockOnAuthStateChange(cb),
    },
  },
}));

// Import after mocking
import { AuthProvider, useAuthContext } from '@/contexts/AuthContext';

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
  initialRoute?: string;
}

function TestWrapper({ children, initialRoute = '/' }: TestWrapperProps) {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <AuthProvider>{children}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// Test components
function LoginPage() {
  const { signInWithGoogle, isLoading, error } = useAuthContext();

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch {
      // Error is already handled by AuthContext and stored in error state
    }
  };

  return (
    <div>
      <h1>Login Page</h1>
      {error && <div data-testid="error-message">{error.message}</div>}
      <button onClick={handleSignIn} disabled={isLoading} data-testid="google-login-btn">
        {isLoading ? 'Loading...' : 'Sign in with Google'}
      </button>
    </div>
  );
}

function HomePage() {
  const { user, signOut, isLoading } = useAuthContext();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {
      // Error is already handled by AuthContext
    }
  };

  if (isLoading) return <div>Loading...</div>;
  if (!user) return <div>Please log in</div>;
  return (
    <div>
      <h1>Welcome, {user.email}</h1>
      <button onClick={handleSignOut} data-testid="logout-btn">
        Sign Out
      </button>
    </div>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuthContext();
  if (isLoading) return <div data-testid="loading">Loading...</div>;
  if (!user) return <div data-testid="redirect-login">Redirecting to login...</div>;
  return <>{children}</>;
}

// ============================================
// Mock Data
// ============================================

const mockUser = {
  id: 'user-123',
  email: 'test@example.com',
  aud: 'authenticated',
  role: 'authenticated',
  email_confirmed_at: '2024-01-01T00:00:00Z',
  user_metadata: {
    full_name: 'Test User',
    avatar_url: 'https://example.com/avatar.png',
  },
  app_metadata: {},
  created_at: '2024-01-01T00:00:00Z',
};

const mockSession = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
  user: mockUser,
};

// ============================================
// Test Suite
// ============================================

describe('Authentication Flow Integration', () => {
  let authStateCallback: ((event: string, session: typeof mockSession | null) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    authStateCallback = null;

    // Default: not authenticated
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    // Capture auth state change callback
    mockOnAuthStateChange.mockImplementation((callback: typeof authStateCallback) => {
      authStateCallback = callback;
      return {
        data: {
          subscription: {
            unsubscribe: vi.fn(),
          },
        },
      };
    });

    mockSignOut.mockResolvedValue({ error: null });
  });

  // ============================================
  // Google OAuth Sign-In Flow
  // ============================================

  describe('Google OAuth sign-in flow', () => {
    it('should show login button when not authenticated', async () => {
      render(
        <TestWrapper>
          <LoginPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('google-login-btn')).toBeInTheDocument();
      });
    });

    it('should initiate OAuth flow when clicking sign in', async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: { url: 'https://accounts.google.com/oauth' },
        error: null,
      });

      const user = userEvent.setup();
      render(
        <TestWrapper>
          <LoginPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('google-login-btn')).toBeEnabled();
      });

      await user.click(screen.getByTestId('google-login-btn'));

      expect(mockSignInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: expect.objectContaining({
          redirectTo: expect.any(String),
        }),
      });
    });

    it('should update UI after successful authentication', async () => {
      // Start unauthenticated
      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Please log in')).toBeInTheDocument();
      });

      // Simulate successful OAuth callback
      await act(async () => {
        mockGetSession.mockResolvedValue({
          data: { session: mockSession },
          error: null,
        });
        authStateCallback?.('SIGNED_IN', mockSession);
      });

      await waitFor(() => {
        expect(screen.getByText('Welcome, test@example.com')).toBeInTheDocument();
      });
    });

    it('should display error message on OAuth failure', async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: null,
        error: { message: 'OAuth provider error' },
      });

      const user = userEvent.setup();
      render(
        <TestWrapper>
          <LoginPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('google-login-btn')).toBeEnabled();
      });

      await user.click(screen.getByTestId('google-login-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('OAuth provider error');
      });
    });
  });

  // ============================================
  // Session Persistence
  // ============================================

  describe('session persistence', () => {
    it('should restore session on page load', async () => {
      // Simulate existing session
      mockGetSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Welcome, test@example.com')).toBeInTheDocument();
      });
    });

    it('should show loading state while checking session', async () => {
      // Delay session check
      mockGetSession.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ data: { session: null }, error: null }), 100))
      );

      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      expect(screen.getByText('Loading...')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText('Please log in')).toBeInTheDocument();
      });
    });

    it('should handle session refresh events', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Welcome, test@example.com')).toBeInTheDocument();
      });

      // Simulate token refresh
      const refreshedSession = {
        ...mockSession,
        access_token: 'refreshed-token',
      };

      await act(async () => {
        authStateCallback?.('TOKEN_REFRESHED', refreshedSession);
      });

      // User should still be logged in
      expect(screen.getByText('Welcome, test@example.com')).toBeInTheDocument();
    });
  });

  // ============================================
  // Session Expiry
  // ============================================

  describe('session expiry and redirect', () => {
    it('should redirect to login when session expires', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      render(
        <TestWrapper>
          <Routes>
            <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Welcome, test@example.com')).toBeInTheDocument();
      });

      // Simulate session expiry
      await act(async () => {
        mockGetSession.mockResolvedValue({
          data: { session: null },
          error: null,
        });
        authStateCallback?.('SIGNED_OUT', null);
      });

      await waitFor(() => {
        expect(screen.getByTestId('redirect-login')).toBeInTheDocument();
      });
    });

    it('should show protected content only when authenticated', async () => {
      render(
        <TestWrapper>
          <ProtectedRoute>
            <div data-testid="protected-content">Secret Content</div>
          </ProtectedRoute>
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('redirect-login')).toBeInTheDocument();
        expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
      });
    });

    it('should show protected content when authenticated', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      render(
        <TestWrapper>
          <ProtectedRoute>
            <div data-testid="protected-content">Secret Content</div>
          </ProtectedRoute>
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('protected-content')).toBeInTheDocument();
      });
    });
  });

  // ============================================
  // Sign Out Flow
  // ============================================

  describe('sign out flow', () => {
    it('should sign out user when clicking logout', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      const user = userEvent.setup();
      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('logout-btn')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('logout-btn'));

      expect(mockSignOut).toHaveBeenCalled();
    });

    it('should update UI after signing out', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      const user = userEvent.setup();
      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Welcome, test@example.com')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('logout-btn'));

      // Simulate sign out event
      await act(async () => {
        mockGetSession.mockResolvedValue({
          data: { session: null },
          error: null,
        });
        authStateCallback?.('SIGNED_OUT', null);
      });

      await waitFor(() => {
        expect(screen.getByText('Please log in')).toBeInTheDocument();
      });
    });
  });

  // ============================================
  // Error Handling
  // ============================================

  describe('error handling', () => {
    it('should handle session fetch error gracefully', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: { message: 'Network error' },
      });

      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Please log in')).toBeInTheDocument();
      });
    });

    it('should handle sign out error', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      mockSignOut.mockResolvedValue({
        error: { message: 'Sign out failed' },
      });

      const user = userEvent.setup();
      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('logout-btn')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('logout-btn'));

      // Should still show user as logged in since sign out failed
      expect(mockSignOut).toHaveBeenCalled();
    });
  });

  // ============================================
  // Auth State Change Events
  // ============================================

  describe('auth state change events', () => {
    it('should handle SIGNED_IN event', async () => {
      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Please log in')).toBeInTheDocument();
      });

      await act(async () => {
        mockGetSession.mockResolvedValue({
          data: { session: mockSession },
          error: null,
        });
        authStateCallback?.('SIGNED_IN', mockSession);
      });

      await waitFor(() => {
        expect(screen.getByText('Welcome, test@example.com')).toBeInTheDocument();
      });
    });

    it('should handle SIGNED_OUT event', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Welcome, test@example.com')).toBeInTheDocument();
      });

      await act(async () => {
        mockGetSession.mockResolvedValue({
          data: { session: null },
          error: null,
        });
        authStateCallback?.('SIGNED_OUT', null);
      });

      await waitFor(() => {
        expect(screen.getByText('Please log in')).toBeInTheDocument();
      });
    });

    it('should handle USER_UPDATED event', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Welcome, test@example.com')).toBeInTheDocument();
      });

      // Simulate user update
      const updatedUser = { ...mockUser, email: 'updated@example.com' };
      const updatedSession = { ...mockSession, user: updatedUser };

      await act(async () => {
        mockGetSession.mockResolvedValue({
          data: { session: updatedSession },
          error: null,
        });
        authStateCallback?.('USER_UPDATED', updatedSession);
      });

      await waitFor(() => {
        expect(screen.getByText('Welcome, updated@example.com')).toBeInTheDocument();
      });
    });
  });
});
