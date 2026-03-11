/**
 * useAuth Hook Tests
 *
 * Tests for authentication hook computed properties and context integration.
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock the AuthContext module
const mockUseAuthContext = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => mockUseAuthContext(),
}));

// Import after mocking
import { useAuth } from '@/hooks/useAuth';

// ============================================
// Test Data Factories
// ============================================

function createMockUser(overrides = {}) {
  return {
    id: 'test-user-id',
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
    ...overrides,
  };
}

function createMockSession(user = createMockUser()) {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user,
  };
}

function createMockContext(overrides = {}) {
  const user = overrides.user !== undefined ? overrides.user : createMockUser();
  return {
    user,
    session: user ? createMockSession(user) : null,
    isLoading: false,
    error: null,
    signInWithGoogle: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ============================================
// Test Suite
// ============================================

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuthContext.mockReturnValue(createMockContext({ user: null, session: null }));
  });

  // ============================================
  // Computed Properties - Unauthenticated State
  // ============================================

  describe('unauthenticated state', () => {
    beforeEach(() => {
      mockUseAuthContext.mockReturnValue(createMockContext({ user: null, session: null }));
    });

    it('should return isLoggedIn as false when user is null', () => {
      const { result } = renderHook(() => useAuth());

      expect(result.current.isLoggedIn).toBe(false);
    });

    it('should return null for userEmail when not logged in', () => {
      const { result } = renderHook(() => useAuth());

      expect(result.current.userEmail).toBeNull();
    });

    it('should return null for userName when not logged in', () => {
      const { result } = renderHook(() => useAuth());

      expect(result.current.userName).toBeNull();
    });

    it('should return null for userAvatar when not logged in', () => {
      const { result } = renderHook(() => useAuth());

      expect(result.current.userAvatar).toBeNull();
    });

    it('should return null for user object', () => {
      const { result } = renderHook(() => useAuth());

      expect(result.current.user).toBeNull();
    });

    it('should return null for session', () => {
      const { result } = renderHook(() => useAuth());

      expect(result.current.session).toBeNull();
    });
  });

  // ============================================
  // Computed Properties - Authenticated State
  // ============================================

  describe('authenticated state', () => {
    it('should return isLoggedIn as true when user exists', () => {
      const user = createMockUser();
      mockUseAuthContext.mockReturnValue(createMockContext({ user }));

      const { result } = renderHook(() => useAuth());

      expect(result.current.isLoggedIn).toBe(true);
    });

    it('should return user email correctly', () => {
      const user = createMockUser({ email: 'john@example.com' });
      mockUseAuthContext.mockReturnValue(createMockContext({ user }));

      const { result } = renderHook(() => useAuth());

      expect(result.current.userEmail).toBe('john@example.com');
    });

    it('should return full_name from user_metadata as userName', () => {
      const user = createMockUser({
        user_metadata: { full_name: 'John Doe', avatar_url: null },
      });
      mockUseAuthContext.mockReturnValue(createMockContext({ user }));

      const { result } = renderHook(() => useAuth());

      expect(result.current.userName).toBe('John Doe');
    });

    it('should fallback to email prefix when full_name is not available', () => {
      const user = createMockUser({
        email: 'johndoe@example.com',
        user_metadata: {},
      });
      mockUseAuthContext.mockReturnValue(createMockContext({ user }));

      const { result } = renderHook(() => useAuth());

      expect(result.current.userName).toBe('johndoe');
    });

    it('should return avatar_url from user_metadata', () => {
      const user = createMockUser({
        user_metadata: { avatar_url: 'https://cdn.example.com/avatar.jpg' },
      });
      mockUseAuthContext.mockReturnValue(createMockContext({ user }));

      const { result } = renderHook(() => useAuth());

      expect(result.current.userAvatar).toBe('https://cdn.example.com/avatar.jpg');
    });

    it('should return null for userAvatar when avatar_url is not set', () => {
      const user = createMockUser({
        user_metadata: { full_name: 'Test', avatar_url: undefined },
      });
      mockUseAuthContext.mockReturnValue(createMockContext({ user }));

      const { result } = renderHook(() => useAuth());

      expect(result.current.userAvatar).toBeNull();
    });
  });

  // ============================================
  // Context Integration
  // ============================================

  describe('context integration', () => {
    it('should expose user from context', () => {
      const user = createMockUser({ id: 'user-123' });
      mockUseAuthContext.mockReturnValue(createMockContext({ user }));

      const { result } = renderHook(() => useAuth());

      expect(result.current.user).toBeDefined();
      expect(result.current.user?.id).toBe('user-123');
    });

    it('should expose session from context', () => {
      const user = createMockUser();
      const session = createMockSession(user);
      mockUseAuthContext.mockReturnValue(createMockContext({ user, session }));

      const { result } = renderHook(() => useAuth());

      expect(result.current.session).toBeDefined();
      expect(result.current.session?.access_token).toBe('test-access-token');
    });

    it('should expose isLoading state from context', () => {
      mockUseAuthContext.mockReturnValue(createMockContext({ isLoading: true, user: null }));

      const { result } = renderHook(() => useAuth());

      expect(result.current.isLoading).toBe(true);
    });

    it('should expose error state from context', () => {
      const testError = { message: 'Auth failed', status: 401 };
      mockUseAuthContext.mockReturnValue(createMockContext({ error: testError, user: null }));

      const { result } = renderHook(() => useAuth());

      expect(result.current.error).toEqual(testError);
    });

    it('should expose signInWithGoogle function from context', () => {
      const mockSignIn = vi.fn().mockResolvedValue(undefined);
      mockUseAuthContext.mockReturnValue(createMockContext({ signInWithGoogle: mockSignIn, user: null }));

      const { result } = renderHook(() => useAuth());

      expect(result.current.signInWithGoogle).toBe(mockSignIn);
    });

    it('should expose signOut function from context', () => {
      const mockSignOut = vi.fn().mockResolvedValue(undefined);
      mockUseAuthContext.mockReturnValue(createMockContext({ signOut: mockSignOut }));

      const { result } = renderHook(() => useAuth());

      expect(result.current.signOut).toBe(mockSignOut);
    });
  });

  // ============================================
  // Edge Cases
  // ============================================

  describe('edge cases', () => {
    it('should handle user with empty email', () => {
      const user = createMockUser({ email: '', user_metadata: {} });
      mockUseAuthContext.mockReturnValue(createMockContext({ user }));

      const { result } = renderHook(() => useAuth());

      expect(result.current.userEmail).toBe('');
      // Empty string split results in [''] so first element is ''
      expect(result.current.userName).toBe('');
    });

    it('should handle user with email but no @ symbol', () => {
      const user = createMockUser({ email: 'invalid-email', user_metadata: {} });
      mockUseAuthContext.mockReturnValue(createMockContext({ user }));

      const { result } = renderHook(() => useAuth());

      expect(result.current.userName).toBe('invalid-email');
    });

    it('should handle undefined user_metadata', () => {
      const user = createMockUser({ user_metadata: undefined });
      mockUseAuthContext.mockReturnValue(createMockContext({ user }));

      const { result } = renderHook(() => useAuth());

      // Falls back to email prefix
      expect(result.current.userName).toBe('test');
      expect(result.current.userAvatar).toBeNull();
    });

    it('should handle null values in user_metadata', () => {
      const user = createMockUser({
        user_metadata: { full_name: null, avatar_url: null },
      });
      mockUseAuthContext.mockReturnValue(createMockContext({ user }));

      const { result } = renderHook(() => useAuth());

      // Falls back to email prefix when full_name is null
      expect(result.current.userName).toBe('test');
      expect(result.current.userAvatar).toBeNull();
    });

    it('should handle email with multiple @ symbols', () => {
      const user = createMockUser({
        email: 'user@subdomain@example.com',
        user_metadata: {},
      });
      mockUseAuthContext.mockReturnValue(createMockContext({ user }));

      const { result } = renderHook(() => useAuth());

      expect(result.current.userName).toBe('user');
    });
  });

  // ============================================
  // Reactivity Tests
  // ============================================

  describe('reactivity', () => {
    it('should update computed properties when context changes', () => {
      // Initial: not logged in
      mockUseAuthContext.mockReturnValue(createMockContext({ user: null }));
      const { result, rerender } = renderHook(() => useAuth());

      expect(result.current.isLoggedIn).toBe(false);
      expect(result.current.userEmail).toBeNull();

      // Simulate login
      const user = createMockUser({ email: 'new@example.com' });
      mockUseAuthContext.mockReturnValue(createMockContext({ user }));
      rerender();

      expect(result.current.isLoggedIn).toBe(true);
      expect(result.current.userEmail).toBe('new@example.com');
    });

    it('should update when user metadata changes', () => {
      const user = createMockUser({ user_metadata: { full_name: 'Old Name' } });
      mockUseAuthContext.mockReturnValue(createMockContext({ user }));
      const { result, rerender } = renderHook(() => useAuth());

      expect(result.current.userName).toBe('Old Name');

      // Update metadata
      const updatedUser = createMockUser({ user_metadata: { full_name: 'New Name' } });
      mockUseAuthContext.mockReturnValue(createMockContext({ user: updatedUser }));
      rerender();

      expect(result.current.userName).toBe('New Name');
    });

    it('should handle loading state transitions', () => {
      mockUseAuthContext.mockReturnValue(createMockContext({ isLoading: true, user: null }));
      const { result, rerender } = renderHook(() => useAuth());

      expect(result.current.isLoading).toBe(true);

      // Loading complete
      mockUseAuthContext.mockReturnValue(createMockContext({ isLoading: false, user: null }));
      rerender();

      expect(result.current.isLoading).toBe(false);
    });
  });

  // ============================================
  // Function Behavior
  // ============================================

  describe('function behavior', () => {
    it('should call signInWithGoogle from context when invoked', async () => {
      const mockSignIn = vi.fn().mockResolvedValue(undefined);
      mockUseAuthContext.mockReturnValue(createMockContext({ signInWithGoogle: mockSignIn }));

      const { result } = renderHook(() => useAuth());
      await result.current.signInWithGoogle();

      expect(mockSignIn).toHaveBeenCalledTimes(1);
    });

    it('should call signOut from context when invoked', async () => {
      const mockSignOut = vi.fn().mockResolvedValue(undefined);
      mockUseAuthContext.mockReturnValue(createMockContext({ signOut: mockSignOut }));

      const { result } = renderHook(() => useAuth());
      await result.current.signOut();

      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });

    it('should propagate errors from signInWithGoogle', async () => {
      const mockError = new Error('OAuth failed');
      const mockSignIn = vi.fn().mockRejectedValue(mockError);
      mockUseAuthContext.mockReturnValue(createMockContext({ signInWithGoogle: mockSignIn }));

      const { result } = renderHook(() => useAuth());

      await expect(result.current.signInWithGoogle()).rejects.toThrow('OAuth failed');
    });

    it('should propagate errors from signOut', async () => {
      const mockError = new Error('Sign out failed');
      const mockSignOut = vi.fn().mockRejectedValue(mockError);
      mockUseAuthContext.mockReturnValue(createMockContext({ signOut: mockSignOut }));

      const { result } = renderHook(() => useAuth());

      await expect(result.current.signOut()).rejects.toThrow('Sign out failed');
    });
  });
});
