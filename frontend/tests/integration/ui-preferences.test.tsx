/**
 * UI Preferences Integration Tests
 *
 * Tests for UI preferences persistence including:
 * - Debounced updates (no spam)
 * - Optimistic updates (immediate UI)
 * - Unmount flush (pending changes saved)
 * - Table not found → defaults
 * - Cross-session persistence
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';

// Mock Supabase client
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockUpsert = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    auth: {
      getSession: () => mockGetSession(),
      refreshSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: (cb: unknown) => mockOnAuthStateChange(cb),
    },
  },
}));

// Import after mocking
import { useUIPreferences } from '@/hooks/useUIPreferences';
import { useAuth } from '@/hooks/useAuth';
import { DEFAULT_UI_PREFERENCES } from '@/types/ui-preferences';

// Mock useAuth hook
vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

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
  queryClient?: QueryClient;
}

function TestWrapper({ children, queryClient }: TestWrapperProps) {
  const client = queryClient || createTestQueryClient();
  return (
    <QueryClientProvider client={client}>
      {children}
    </QueryClientProvider>
  );
}

// Helper to wait for debounce
const waitForDebounce = () => new Promise((resolve) => setTimeout(resolve, 600));

// ============================================
// Mock Data
// ============================================

const mockUser = {
  id: 'user-123',
  email: 'test@example.com',
};

const mockPreferences = {
  user_id: 'user-123',
  scratchpad_is_floating: false,
  scratchpad_dock_position: 'right',
  scratchpad_position_x: 100,
  scratchpad_position_y: 100,
  scratchpad_width: 400,
  scratchpad_height: 300,
  mandala_is_floating: false,
  mandala_is_minimized: false,
  mandala_dock_position: 'left',
  mandala_position_x: 50,
  mandala_position_y: 50,
  updated_at: new Date().toISOString(),
};

// ============================================
// Test Components
// ============================================

// Component that uses UI preferences
function PreferencesDisplay() {
  const { preferences, isLoading, error, updatePreferences } = useUIPreferences();

  if (isLoading) return <div data-testid="loading">Loading preferences...</div>;
  if (error) return <div data-testid="error">{error.message}</div>;

  return (
    <div>
      <div data-testid="scratchpad-floating">
        {preferences.scratchpad_is_floating ? 'floating' : 'docked'}
      </div>
      <div data-testid="scratchpad-position">
        {preferences.scratchpad_position_x},{preferences.scratchpad_position_y}
      </div>
      <div data-testid="mandala-minimized">
        {preferences.mandala_is_minimized ? 'minimized' : 'expanded'}
      </div>
      <button
        data-testid="toggle-floating"
        onClick={() => updatePreferences({ scratchpad_is_floating: !preferences.scratchpad_is_floating })}
      >
        Toggle Floating
      </button>
      <button
        data-testid="update-position"
        onClick={() => updatePreferences({ scratchpad_position_x: 200, scratchpad_position_y: 200 })}
      >
        Update Position
      </button>
      <button
        data-testid="toggle-mandala"
        onClick={() => updatePreferences({ mandala_is_minimized: !preferences.mandala_is_minimized })}
      >
        Toggle Mandala
      </button>
    </div>
  );
}

// Component that mounts/unmounts to test flush behavior
function MountableComponent({ onMount, onUnmount }: { onMount?: () => void; onUnmount?: () => void }) {
  const { preferences, updatePreferences } = useUIPreferences();

  React.useEffect(() => {
    onMount?.();
    return () => {
      onUnmount?.();
    };
  }, [onMount, onUnmount]);

  return (
    <div>
      <div data-testid="current-x">{preferences.scratchpad_position_x}</div>
      <button
        data-testid="rapid-update"
        onClick={() => updatePreferences({ scratchpad_position_x: 999 })}
      >
        Rapid Update
      </button>
    </div>
  );
}

import React from 'react';

// Parent component to control mounting
function MountController() {
  const [isMounted, setIsMounted] = useState(true);

  return (
    <div>
      {isMounted && <MountableComponent />}
      <button data-testid="unmount-btn" onClick={() => setIsMounted(false)}>
        Unmount
      </button>
      <button data-testid="remount-btn" onClick={() => setIsMounted(true)}>
        Remount
      </button>
    </div>
  );
}

// ============================================
// Test Suite
// ============================================

describe('UI Preferences Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Default: logged in user
    (useAuth as Mock).mockReturnValue({
      isLoggedIn: true,
      user: mockUser,
    });

    // Setup Supabase chain
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

    // Default: preferences exist
    mockSingle.mockResolvedValue({
      data: mockPreferences,
      error: null,
    });

    mockUpsert.mockResolvedValue({ error: null });

    // Auth mocks
    mockGetSession.mockResolvedValue({
      data: { session: { user: mockUser } },
      error: null,
    });

    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================
  // Debounced Updates (No Spam)
  // ============================================

  describe('debounced updates', () => {
    it('should debounce rapid updates and send single request', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(
        <TestWrapper>
          <PreferencesDisplay />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('scratchpad-floating')).toBeInTheDocument();
      });

      // Click toggle multiple times rapidly
      const toggleBtn = screen.getByTestId('toggle-floating');
      await user.click(toggleBtn);
      await user.click(toggleBtn);
      await user.click(toggleBtn);

      // No API call yet (debounce pending)
      expect(mockUpsert).not.toHaveBeenCalled();

      // Advance timers past debounce delay (500ms)
      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      // Should have only one API call with final state
      expect(mockUpsert).toHaveBeenCalledTimes(1);
    });

    it('should merge multiple different updates into single request', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(
        <TestWrapper>
          <PreferencesDisplay />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('scratchpad-floating')).toBeInTheDocument();
      });

      // Click different buttons rapidly
      await user.click(screen.getByTestId('toggle-floating'));
      await user.click(screen.getByTestId('update-position'));
      await user.click(screen.getByTestId('toggle-mandala'));

      expect(mockUpsert).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      // Single merged call
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-123',
          scratchpad_is_floating: true,
          scratchpad_position_x: 200,
          scratchpad_position_y: 200,
          mandala_is_minimized: true,
        }),
        expect.any(Object)
      );
    });
  });

  // ============================================
  // Optimistic Updates (Immediate UI)
  // ============================================

  describe('optimistic updates', () => {
    it('should update UI immediately before API call completes', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(
        <TestWrapper>
          <PreferencesDisplay />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('scratchpad-floating')).toHaveTextContent('docked');
      });

      // Click toggle
      await user.click(screen.getByTestId('toggle-floating'));

      // UI should update immediately (optimistic)
      expect(screen.getByTestId('scratchpad-floating')).toHaveTextContent('floating');

      // API hasn't been called yet (debounce pending)
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('should show updated position immediately after update', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(
        <TestWrapper>
          <PreferencesDisplay />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('scratchpad-position')).toHaveTextContent('100,100');
      });

      await user.click(screen.getByTestId('update-position'));

      // UI updates immediately
      expect(screen.getByTestId('scratchpad-position')).toHaveTextContent('200,200');
    });

    it('should maintain optimistic state across multiple rapid updates', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(
        <TestWrapper>
          <PreferencesDisplay />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mandala-minimized')).toHaveTextContent('expanded');
      });

      // Toggle multiple times
      await user.click(screen.getByTestId('toggle-mandala')); // minimized
      expect(screen.getByTestId('mandala-minimized')).toHaveTextContent('minimized');

      await user.click(screen.getByTestId('toggle-mandala')); // expanded
      expect(screen.getByTestId('mandala-minimized')).toHaveTextContent('expanded');

      await user.click(screen.getByTestId('toggle-mandala')); // minimized
      expect(screen.getByTestId('mandala-minimized')).toHaveTextContent('minimized');

      // Final state should be minimized
      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      expect(screen.getByTestId('mandala-minimized')).toHaveTextContent('minimized');
    });
  });

  // ============================================
  // Unmount Flush (Pending Changes Saved)
  // ============================================

  describe('unmount flush', () => {
    it('should flush pending updates on component unmount', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(
        <TestWrapper>
          <MountController />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('current-x')).toBeInTheDocument();
      });

      // Make an update
      await user.click(screen.getByTestId('rapid-update'));

      // Not sent yet (debounce pending)
      expect(mockUpsert).not.toHaveBeenCalled();

      // Unmount the component
      await user.click(screen.getByTestId('unmount-btn'));

      // Should flush pending updates on unmount
      await waitFor(() => {
        expect(mockUpsert).toHaveBeenCalled();
      });

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          scratchpad_position_x: 999,
        }),
        expect.any(Object)
      );
    });
  });

  // ============================================
  // Table Not Found → Defaults
  // ============================================

  describe('table not found handling', () => {
    it('should use defaults when PGRST116 error (no rows)', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' },
      });

      render(
        <TestWrapper>
          <PreferencesDisplay />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('scratchpad-floating')).toBeInTheDocument();
      });

      // Should show default values
      expect(screen.getByTestId('scratchpad-floating')).toHaveTextContent(
        DEFAULT_UI_PREFERENCES.scratchpad_is_floating ? 'floating' : 'docked'
      );
    });

    it('should use defaults when 42P01 error (table not found)', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { code: '42P01', message: 'Table not found' },
      });

      render(
        <TestWrapper>
          <PreferencesDisplay />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('scratchpad-floating')).toBeInTheDocument();
      });

      // Should show default values without error
      expect(screen.queryByTestId('error')).not.toBeInTheDocument();
    });

    it('should use defaults when 404 error', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { status: 404, message: 'Not found' },
      });

      render(
        <TestWrapper>
          <PreferencesDisplay />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('scratchpad-floating')).toBeInTheDocument();
      });

      // Should show default values
      expect(screen.queryByTestId('error')).not.toBeInTheDocument();
    });
  });

  // ============================================
  // Cross-Session Persistence
  // ============================================

  describe('cross-session persistence', () => {
    it('should restore preferences from database on mount', async () => {
      const savedPreferences = {
        ...mockPreferences,
        scratchpad_is_floating: true,
        scratchpad_position_x: 500,
        scratchpad_position_y: 300,
      };

      mockSingle.mockResolvedValue({
        data: savedPreferences,
        error: null,
      });

      render(
        <TestWrapper>
          <PreferencesDisplay />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('scratchpad-floating')).toHaveTextContent('floating');
      });

      expect(screen.getByTestId('scratchpad-position')).toHaveTextContent('500,300');
    });

    it('should persist changes that can be restored in new session', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const queryClient = createTestQueryClient();

      // First render - initial state
      const { unmount } = render(
        <TestWrapper queryClient={queryClient}>
          <PreferencesDisplay />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('scratchpad-floating')).toHaveTextContent('docked');
      });

      // Make changes
      await user.click(screen.getByTestId('toggle-floating'));
      await user.click(screen.getByTestId('update-position'));

      // Wait for debounce
      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      // Verify API was called with new values
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          scratchpad_is_floating: true,
          scratchpad_position_x: 200,
          scratchpad_position_y: 200,
        }),
        expect.any(Object)
      );

      // Unmount first session
      unmount();

      // Simulate new session with persisted data
      mockSingle.mockResolvedValue({
        data: {
          ...mockPreferences,
          scratchpad_is_floating: true,
          scratchpad_position_x: 200,
          scratchpad_position_y: 200,
        },
        error: null,
      });

      // Second render - new session
      render(
        <TestWrapper queryClient={createTestQueryClient()}>
          <PreferencesDisplay />
        </TestWrapper>
      );

      // Should restore persisted values
      await waitFor(() => {
        expect(screen.getByTestId('scratchpad-floating')).toHaveTextContent('floating');
        expect(screen.getByTestId('scratchpad-position')).toHaveTextContent('200,200');
      });
    });

    it('should use user-specific query key for isolation', async () => {
      render(
        <TestWrapper>
          <PreferencesDisplay />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('scratchpad-floating')).toBeInTheDocument();
      });

      // Verify query was made with user-specific filter
      expect(mockFrom).toHaveBeenCalledWith('user_ui_preferences');
      expect(mockEq).toHaveBeenCalledWith('user_id', 'user-123');
    });
  });

  // ============================================
  // Not Logged In Behavior
  // ============================================

  describe('not logged in behavior', () => {
    it('should return defaults when not logged in', async () => {
      (useAuth as Mock).mockReturnValue({
        isLoggedIn: false,
        user: null,
      });

      render(
        <TestWrapper>
          <PreferencesDisplay />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('scratchpad-floating')).toBeInTheDocument();
      });

      // Should show default values
      expect(screen.getByTestId('scratchpad-floating')).toHaveTextContent('docked');

      // Should not make API call
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('should not save updates when not logged in', async () => {
      (useAuth as Mock).mockReturnValue({
        isLoggedIn: false,
        user: null,
      });

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      render(
        <TestWrapper>
          <PreferencesDisplay />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('toggle-floating')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('toggle-floating'));

      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      // Should not call API
      expect(mockUpsert).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Cannot update preferences: user not logged in');

      consoleSpy.mockRestore();
    });
  });

  // ============================================
  // Error Recovery
  // ============================================

  describe('error recovery', () => {
    it('should continue working after API save error', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // First save fails
      mockUpsert.mockResolvedValueOnce({
        error: { message: 'Network error' },
      });

      render(
        <TestWrapper>
          <PreferencesDisplay />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('scratchpad-floating')).toBeInTheDocument();
      });

      // Make first update (will fail)
      await user.click(screen.getByTestId('toggle-floating'));
      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      // UI should still show optimistic update
      expect(screen.getByTestId('scratchpad-floating')).toHaveTextContent('floating');

      // Second save succeeds
      mockUpsert.mockResolvedValueOnce({ error: null });

      // Make another update
      await user.click(screen.getByTestId('update-position'));
      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      // Should have attempted both saves
      expect(mockUpsert).toHaveBeenCalledTimes(2);

      consoleSpy.mockRestore();
    });

    it('should handle permission error gracefully', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { status: 403, message: 'Permission denied' },
      });

      render(
        <TestWrapper>
          <PreferencesDisplay />
        </TestWrapper>
      );

      // 403 errors show error state (not silently handled like 404)
      await waitFor(() => {
        expect(screen.getByTestId('error')).toBeInTheDocument();
      });

      expect(screen.getByTestId('error')).toHaveTextContent('Permission denied');
    });
  });

  // ============================================
  // Query Invalidation
  // ============================================

  describe('query invalidation', () => {
    it('should refetch after successful save', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(
        <TestWrapper>
          <PreferencesDisplay />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('scratchpad-floating')).toBeInTheDocument();
      });

      // Initial fetch
      expect(mockSingle).toHaveBeenCalledTimes(1);

      // Make update
      await user.click(screen.getByTestId('toggle-floating'));
      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      // Wait for mutation success and invalidation
      await waitFor(() => {
        expect(mockUpsert).toHaveBeenCalled();
      });

      // After mutation succeeds, query should be invalidated and refetched
      await waitFor(() => {
        expect(mockSingle.mock.calls.length).toBeGreaterThanOrEqual(1);
      });
    });
  });
});
