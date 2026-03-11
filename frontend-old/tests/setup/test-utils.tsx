/**
 * Test Utilities
 *
 * Custom render function with providers, test helpers, and mock factories.
 */

import React, { type ReactElement, type ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { vi } from 'vitest';

// ============================================
// Query Client for Tests
// ============================================

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0, // Disable garbage collection in tests
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

// ============================================
// Mock Auth Context
// ============================================

interface MockUser {
  id: string;
  email: string;
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
  };
}

interface MockSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  user: MockUser;
}

interface MockAuthContextValue {
  user: MockUser | null;
  session: MockSession | null;
  isLoading: boolean;
  error: Error | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const defaultMockAuthContext: MockAuthContextValue = {
  user: null,
  session: null,
  isLoading: false,
  error: null,
  signInWithGoogle: vi.fn().mockResolvedValue(undefined),
  signOut: vi.fn().mockResolvedValue(undefined),
};

// Create authenticated mock context
export function createAuthenticatedContext(
  overrides: Partial<MockUser> = {}
): MockAuthContextValue {
  const user: MockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    user_metadata: {
      full_name: 'Test User',
      avatar_url: 'https://example.com/avatar.png',
    },
    ...overrides,
  };

  const session: MockSession = {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_at: Date.now() + 3600000,
    user,
  };

  return {
    ...defaultMockAuthContext,
    user,
    session,
  };
}

// Mock AuthContext
const MockAuthContext = React.createContext<MockAuthContextValue>(defaultMockAuthContext);

export const MockAuthProvider: React.FC<{
  children: ReactNode;
  value?: Partial<MockAuthContextValue>;
}> = ({ children, value = {} }) => {
  const contextValue = { ...defaultMockAuthContext, ...value };
  return (
    <MockAuthContext.Provider value={contextValue}>
      {children}
    </MockAuthContext.Provider>
  );
};

export function useMockAuthContext(): MockAuthContextValue {
  return React.useContext(MockAuthContext);
}

// ============================================
// All Providers Wrapper
// ============================================

interface AllProvidersProps {
  children: ReactNode;
  authValue?: Partial<MockAuthContextValue>;
  queryClient?: QueryClient;
}

export const AllProviders: React.FC<AllProvidersProps> = ({
  children,
  authValue,
  queryClient = createTestQueryClient(),
}) => {
  return (
    <QueryClientProvider client={queryClient}>
      <MockAuthProvider value={authValue}>
        <BrowserRouter>{children}</BrowserRouter>
      </MockAuthProvider>
    </QueryClientProvider>
  );
};

// ============================================
// Custom Render Function
// ============================================

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  authValue?: Partial<MockAuthContextValue>;
  queryClient?: QueryClient;
  route?: string;
}

export function customRender(
  ui: ReactElement,
  options: CustomRenderOptions = {}
): RenderResult & { queryClient: QueryClient } {
  const { authValue, queryClient = createTestQueryClient(), route = '/', ...renderOptions } = options;

  // Set initial route
  window.history.pushState({}, 'Test page', route);

  const Wrapper: React.FC<{ children: ReactNode }> = ({ children }) => (
    <AllProviders authValue={authValue} queryClient={queryClient}>
      {children}
    </AllProviders>
  );

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    queryClient,
  };
}

// ============================================
// Test Data Factories
// ============================================

export function createMockPlaylist(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'playlist-1',
    youtube_playlist_id: 'PLtest123',
    title: 'Test Playlist',
    description: 'A test playlist',
    thumbnail_url: 'https://i.ytimg.com/vi/test/default.jpg',
    channel_title: 'Test Channel',
    item_count: 10,
    published_at: '2024-01-01T00:00:00Z',
    last_synced_at: '2024-06-01T00:00:00Z',
    sync_interval: 'daily',
    is_auto_sync_enabled: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-06-01T00:00:00Z',
    ...overrides,
  };
}

export function createMockVideo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'video-1',
    youtube_video_id: 'dQw4w9WgXcQ',
    title: 'Test Video',
    description: 'A test video description',
    thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg',
    channel_title: 'Test Channel',
    duration: 213,
    published_at: '2024-01-01T00:00:00Z',
    view_count: 1000000,
    like_count: 50000,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-06-01T00:00:00Z',
    ...overrides,
  };
}

export function createMockUserVideoState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'state-1',
    user_id: 'test-user-id',
    video_id: 'video-1',
    is_watched: false,
    watch_position_seconds: 0,
    is_in_ideation: false,
    user_note: null,
    cell_index: null,
    level_id: null,
    sort_order: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-06-01T00:00:00Z',
    ...overrides,
  };
}

// ============================================
// Wait Utilities
// ============================================

export async function waitForLoadingToFinish(): Promise<void> {
  // Wait for any loading states to complete
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ============================================
// Event Helpers
// ============================================

export function createPointerEvent(
  type: string,
  props: Partial<PointerEventInit> = {}
): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    ...props,
  });
  return event;
}

export function createDragEvent(
  type: string,
  dataTransfer: DataTransfer = new DataTransfer()
): DragEvent {
  const event = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    dataTransfer,
  });
  return event;
}

// ============================================
// Exports
// ============================================

export * from '@testing-library/react';
export { customRender as render };
