/**
 * useUIPreferences Hook Tests
 *
 * Tests for UI preferences management hook including debounced updates,
 * optimistic updates, Supabase persistence, and convenience methods.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import type { UIPreferences } from '@/types/ui-preferences';
import { DEFAULT_UI_PREFERENCES } from '@/types/ui-preferences';

// ============================================
// Mocks
// ============================================

// Mock useAuth
const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

// Mock Supabase client
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockUpsert = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
  },
}));

// Import after mocking
import { useUIPreferences } from '@/hooks/useUIPreferences';

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

// Helper to wait for debounce
const waitForDebounce = () => new Promise((resolve) => setTimeout(resolve, 600));

// ============================================
// Mock Data
// ============================================

const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
};

const mockPreferences: UIPreferences = {
  id: 'pref-1',
  user_id: 'test-user-id',
  scratchpad_is_floating: true,
  scratchpad_dock_position: 'bottom',
  scratchpad_position_x: 200,
  scratchpad_position_y: 150,
  scratchpad_width: 400,
  scratchpad_height: 350,
  mandala_is_floating: true,
  mandala_is_minimized: false,
  mandala_dock_position: 'right',
  mandala_position_x: 300,
  mandala_position_y: 100,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-06-01T00:00:00Z',
};

// ============================================
// Setup
// ============================================

describe('useUIPreferences', () => {
  let originalConsoleWarn: typeof console.warn;

  beforeEach(() => {
    vi.clearAllMocks();
    originalConsoleWarn = console.warn;
    console.warn = vi.fn();

    // Default auth state: logged in
    mockUseAuth.mockReturnValue({
      isLoggedIn: true,
      user: mockUser,
    });

    // Setup mock chain
    mockFrom.mockReturnValue({
      select: mockSelect,
      upsert: mockUpsert,
    });

    mockSelect.mockReturnValue({
      eq: mockEq,
    });

    mockEq.mockReturnValue({
      single: mockSingle,
    });

    // Default: successful fetch
    mockSingle.mockResolvedValue({
      data: mockPreferences,
      error: null,
    });

    // Default: successful upsert
    mockUpsert.mockResolvedValue({
      error: null,
    });
  });

  afterEach(() => {
    console.warn = originalConsoleWarn;
  });

  // ============================================
  // Fetch Preferences Tests
  // ============================================

  describe('fetching preferences', () => {
    it('should return default preferences when not logged in', async () => {
      mockUseAuth.mockReturnValue({
        isLoggedIn: false,
        user: null,
      });

      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      // Query is disabled when not logged in, returns defaults immediately
      expect(result.current.preferences).toEqual(DEFAULT_UI_PREFERENCES);
      expect(result.current.isLoading).toBe(false);
    });

    it('should fetch preferences from Supabase when logged in', async () => {
      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(mockFrom).toHaveBeenCalledWith('user_ui_preferences');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq).toHaveBeenCalledWith('user_id', mockUser.id);
      expect(result.current.preferences).toEqual(mockPreferences);
    });

    it('should return defaults on PGRST116 error (no rows)', async () => {
      mockSingle.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116', message: 'No rows returned' },
      });

      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.preferences).toEqual(DEFAULT_UI_PREFERENCES);
      expect(result.current.error).toBeNull();
    });

    it('should return defaults on 42P01 error (table not found)', async () => {
      mockSingle.mockResolvedValueOnce({
        data: null,
        error: { code: '42P01', message: 'Table not found' },
      });

      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.preferences).toEqual(DEFAULT_UI_PREFERENCES);
      expect(console.warn).toHaveBeenCalledWith(
        'user_ui_preferences table not found, using defaults'
      );
    });

    it('should return defaults on 404 error', async () => {
      mockSingle.mockResolvedValueOnce({
        data: null,
        error: { status: 404, message: 'Not found' },
      });

      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.preferences).toEqual(DEFAULT_UI_PREFERENCES);
    });

    it('should throw on other errors', async () => {
      // Use status: 403 which doesn't retry (per hook's retry logic)
      // but isn't handled specially by queryFn either, so it throws
      const testError = { status: 403, message: 'Forbidden' };
      mockSingle.mockResolvedValueOnce({
        data: null,
        error: testError,
      });

      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      // Wait for query to fail - the error should be set (no retries for status 403)
      await waitFor(
        () => {
          expect(result.current.error).not.toBeNull();
        },
        { timeout: 2000 }
      );

      expect(result.current.error).toMatchObject(testError);
    });
  });

  // ============================================
  // Update Preferences Tests
  // ============================================

  describe('updating preferences', () => {
    it('should apply optimistic updates immediately', async () => {
      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      const initialX = result.current.preferences.scratchpad_position_x;

      act(() => {
        result.current.updatePreferences({ scratchpad_position_x: 500 });
      });

      // Immediately reflects the update (optimistic) - wait for React to process the state update
      await waitFor(() => {
        expect(result.current.preferences.scratchpad_position_x).toBe(500);
      });
      expect(result.current.preferences.scratchpad_position_x).not.toBe(initialX);
    });

    it('should debounce and merge multiple rapid updates', async () => {
      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Make rapid updates
      act(() => {
        result.current.updatePreferences({ scratchpad_is_floating: true });
      });
      act(() => {
        result.current.updatePreferences({ scratchpad_position_x: 200 });
      });
      act(() => {
        result.current.updatePreferences({ scratchpad_position_y: 300 });
      });

      // No API call yet (debounce pending)
      expect(mockUpsert).not.toHaveBeenCalled();

      // Wait for debounce to complete
      await waitForDebounce();

      // Now the batched update should be sent
      await waitFor(() => {
        expect(mockUpsert).toHaveBeenCalledTimes(1);
      });

      // All updates should be merged
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: mockUser.id,
          scratchpad_is_floating: true,
          scratchpad_position_x: 200,
          scratchpad_position_y: 300,
        }),
        { onConflict: 'user_id' }
      );
    });

    it('should warn when updating without being logged in', async () => {
      mockUseAuth.mockReturnValue({
        isLoggedIn: false,
        user: null,
      });

      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.updatePreferences({ scratchpad_is_floating: true });
      });

      expect(console.warn).toHaveBeenCalledWith(
        'Cannot update preferences: user not logged in'
      );
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('should flush pending updates on unmount', async () => {
      const { result, unmount } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Make update but don't wait for debounce
      act(() => {
        result.current.updatePreferences({ scratchpad_is_floating: true });
      });

      // Unmount before debounce completes
      unmount();

      // Flush should have happened
      await waitFor(() => {
        expect(mockUpsert).toHaveBeenCalled();
      });
    });

    it('should handle update errors gracefully', async () => {
      // Use status: 403 which doesn't retry (per hook's retry logic)
      // Also reset mockUpsert to default success AFTER this test's error
      mockUpsert.mockResolvedValueOnce({
        error: { status: 403, message: 'Update failed' },
      });

      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => {
        result.current.updatePreferences({ scratchpad_is_floating: true });
      });

      // Wait for debounce
      await waitForDebounce();

      // Should warn but not crash
      await waitFor(() => {
        expect(console.warn).toHaveBeenCalledWith(
          'Failed to save UI preferences:',
          expect.anything()
        );
      });
    });
  });

  // ============================================
  // Convenience Methods Tests
  // ============================================

  describe('convenience methods', () => {
    it('should update scratchpad floating state', async () => {
      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => {
        result.current.setScratchPadFloating(false);
      });

      await waitFor(() => {
        expect(result.current.preferences.scratchpad_is_floating).toBe(false);
      });
    });

    it('should update scratchpad dock position', async () => {
      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => {
        result.current.setScratchPadDockPosition('right');
      });

      await waitFor(() => {
        expect(result.current.preferences.scratchpad_dock_position).toBe('right');
      });
    });

    it('should update scratchpad position', async () => {
      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => {
        result.current.setScratchPadPosition(250, 350);
      });

      await waitFor(() => {
        expect(result.current.preferences.scratchpad_position_x).toBe(250);
        expect(result.current.preferences.scratchpad_position_y).toBe(350);
      });
    });

    it('should update scratchpad size', async () => {
      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => {
        result.current.setScratchPadSize(500, 600);
      });

      await waitFor(() => {
        expect(result.current.preferences.scratchpad_width).toBe(500);
        expect(result.current.preferences.scratchpad_height).toBe(600);
      });
    });

    it('should update mandala floating state', async () => {
      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => {
        result.current.setMandalaFloating(false);
      });

      await waitFor(() => {
        expect(result.current.preferences.mandala_is_floating).toBe(false);
      });
    });

    it('should update mandala minimized state', async () => {
      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => {
        result.current.setMandalaMinimized(true);
      });

      await waitFor(() => {
        expect(result.current.preferences.mandala_is_minimized).toBe(true);
      });
    });

    it('should update mandala dock position', async () => {
      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => {
        result.current.setMandalaDockPosition('left');
      });

      await waitFor(() => {
        expect(result.current.preferences.mandala_dock_position).toBe('left');
      });
    });

    it('should update mandala position', async () => {
      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => {
        result.current.setMandalaPosition(400, 200);
      });

      await waitFor(() => {
        expect(result.current.preferences.mandala_position_x).toBe(400);
        expect(result.current.preferences.mandala_position_y).toBe(200);
      });
    });
  });

  // ============================================
  // Return Value Tests
  // ============================================

  describe('return values', () => {
    it('should return all expected properties and methods', async () => {
      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Properties
      expect(result.current.preferences).toBeDefined();
      expect(typeof result.current.isLoading).toBe('boolean');
      expect(typeof result.current.isUpdating).toBe('boolean');
      expect(result.current.error).toBeNull();

      // Methods
      expect(typeof result.current.updatePreferences).toBe('function');
      expect(typeof result.current.setScratchPadFloating).toBe('function');
      expect(typeof result.current.setScratchPadDockPosition).toBe('function');
      expect(typeof result.current.setScratchPadPosition).toBe('function');
      expect(typeof result.current.setScratchPadSize).toBe('function');
      expect(typeof result.current.setMandalaFloating).toBe('function');
      expect(typeof result.current.setMandalaMinimized).toBe('function');
      expect(typeof result.current.setMandalaDockPosition).toBe('function');
      expect(typeof result.current.setMandalaPosition).toBe('function');
    });

    it('should show isUpdating during mutation', async () => {
      // Make upsert slow
      let resolveUpsert: (value: { error: null }) => void;
      mockUpsert.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveUpsert = resolve;
          })
      );

      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.isUpdating).toBe(false);

      act(() => {
        result.current.updatePreferences({ scratchpad_is_floating: true });
      });

      // Wait for debounce
      await waitForDebounce();

      // Should be updating now
      await waitFor(() => expect(result.current.isUpdating).toBe(true));

      // Complete the mutation
      act(() => {
        resolveUpsert!({ error: null });
      });

      await waitFor(() => expect(result.current.isUpdating).toBe(false));
    });
  });

  // ============================================
  // Edge Cases
  // ============================================

  describe('edge cases', () => {
    it('should handle rapid position updates efficiently', async () => {
      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Simulate drag operation with many rapid updates
      for (let i = 0; i < 50; i++) {
        act(() => {
          result.current.setScratchPadPosition(100 + i, 100 + i);
        });
      }

      // Still no API call due to debouncing
      expect(mockUpsert).not.toHaveBeenCalled();

      // Final position should be reflected (optimistic updates)
      await waitFor(() => {
        expect(result.current.preferences.scratchpad_position_x).toBe(149);
        expect(result.current.preferences.scratchpad_position_y).toBe(149);
      });

      // Wait for debounce to complete
      await waitForDebounce();

      // Only one API call with final values
      await waitFor(() => {
        expect(mockUpsert).toHaveBeenCalledTimes(1);
      });

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          scratchpad_position_x: 149,
          scratchpad_position_y: 149,
        }),
        expect.anything()
      );
    });

    it('should merge concurrent updates from different methods', async () => {
      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Multiple different updates in quick succession
      act(() => {
        result.current.setScratchPadFloating(false);
        result.current.setScratchPadPosition(200, 300);
        result.current.setMandalaFloating(false);
        result.current.setMandalaMinimized(true);
      });

      // Wait for debounce
      await waitForDebounce();

      // All merged into single API call
      await waitFor(() => {
        expect(mockUpsert).toHaveBeenCalledTimes(1);
      });

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          scratchpad_is_floating: false,
          scratchpad_position_x: 200,
          scratchpad_position_y: 300,
          mandala_is_floating: false,
          mandala_is_minimized: true,
        }),
        expect.anything()
      );
    });

    it('should handle user switching (id change)', async () => {
      const queryClient = createTestQueryClient();

      const { result, rerender } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // First user's preferences
      expect(result.current.preferences).toEqual(mockPreferences);

      // Switch to different user
      const newUserId = 'different-user-id';
      mockUseAuth.mockReturnValue({
        isLoggedIn: true,
        user: { id: newUserId, email: 'other@example.com' },
      });

      // Return different preferences for new user
      mockSingle.mockResolvedValueOnce({
        data: {
          ...DEFAULT_UI_PREFERENCES,
          user_id: newUserId,
          scratchpad_is_floating: false,
        },
        error: null,
      });

      rerender();

      await waitFor(() => {
        expect(mockEq).toHaveBeenCalledWith('user_id', newUserId);
      });
    });
  });

  // ============================================
  // Query Invalidation Tests
  // ============================================

  describe('query invalidation', () => {
    it('should invalidate query on successful update', async () => {
      const queryClient = createTestQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => {
        result.current.setScratchPadFloating(false);
      });

      // Wait for debounce
      await waitForDebounce();

      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['ui-preferences', mockUser.id],
        });
      });
    });
  });

  // ============================================
  // Retry Behavior Tests
  // ============================================

  describe('retry behavior', () => {
    it('should not retry query on 42P01 error', async () => {
      let callCount = 0;
      mockSingle.mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          data: null,
          error: { code: '42P01', message: 'Table not found' },
        });
      });

      renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      // Wait for query to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should only be called once (no retries)
      expect(callCount).toBe(1);
    });

    it('should not retry mutation on 403 error', async () => {
      let mutationCallCount = 0;
      mockUpsert.mockImplementation(() => {
        mutationCallCount++;
        return Promise.resolve({
          error: { status: 403, message: 'Forbidden' },
        });
      });

      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => {
        result.current.setScratchPadFloating(true);
      });

      // Wait for debounce and potential retries
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Should only be called once (no retries for 403)
      expect(mutationCallCount).toBe(1);
    }, 10000);

    it('should retry query on generic errors up to 2 times (covers failureCount < 2 branch)', async () => {
      let callCount = 0;
      mockSingle.mockImplementation(() => {
        callCount++;
        // Return a generic error (not 42P01, 404, 403, 406) to trigger retry logic
        return Promise.resolve({
          data: null,
          error: { code: 'GENERIC_ERROR', message: 'Something went wrong', status: 500 },
        });
      });

      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: 2, // Allow retries
            retryDelay: 10, // Fast retries for testing
            gcTime: 0,
          },
        },
      });

      renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(queryClient),
      });

      // Wait for query and retries to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should be called 3 times: initial + 2 retries (failureCount < 2 returns true for 0, 1)
      expect(callCount).toBe(3);
    });

    it('should guard against updates when user.id becomes falsy', async () => {
      // Start with logged in but user.id is empty (edge case - e.g., corrupted state)
      mockUseAuth.mockReturnValue({
        isLoggedIn: true,
        user: { id: '', email: 'test@example.com' }, // user.id is falsy
      });

      const { result } = renderHook(() => useUIPreferences(), {
        wrapper: createWrapper(),
      });

      // Wait for initial load
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The updatePreferences has a guard that checks user.id
      act(() => {
        result.current.setScratchPadFloating(true);
      });

      // The guard at line 144 should warn and return early
      expect(console.warn).toHaveBeenCalledWith(
        'Cannot update preferences: user not logged in'
      );

      // No API call should be made due to the guard
      expect(mockUpsert).not.toHaveBeenCalled();
    });
  });
});
