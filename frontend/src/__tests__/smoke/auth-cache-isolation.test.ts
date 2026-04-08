/**
 * Cross-user cache isolation regression test (CP360)
 *
 * Pins the contract that React Query cache is cleared on every userId
 * transition so one user cannot see another user's cached data after
 * a sign-out / sign-in sequence.
 *
 * Triggering incident (2026-04-08): jamesjk4242 created "파이선 코딩 정복"
 * → signed out → jamie24kim signed in → sidebar rendered jamesjk4242's
 * mandala for jamie24kim even though the DB correctly had no such row
 * for the second user. Root cause: query keys like ['mandala','list']
 * have no userId and cache was not cleared on auth transitions.
 *
 * This test spins up a mock queryClient and a fake subscribeAuth bus,
 * then verifies that the same transition sequences that caused the
 * incident all trigger queryClient.clear().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

// Capture the registered auth listener so we can drive it in tests
let capturedHandler:
  | ((event: string, session: { access_token?: string; user?: { id: string } } | null) => void)
  | null = null;

vi.mock('@shared/lib/auth-event-bus', () => ({
  subscribeAuth: vi.fn((handler) => {
    capturedHandler = handler;
    return () => {
      capturedHandler = null;
    };
  }),
}));

vi.mock('@shared/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ error: null, data: {} }),
      signUp: vi.fn().mockResolvedValue({ error: null, data: {} }),
      signInWithOtp: vi.fn().mockResolvedValue({ error: null, data: {} }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null, data: {} }),
    },
  },
}));

vi.mock('@shared/lib/api-client', () => ({
  apiClient: {
    tokenReady: Promise.resolve(),
    getAccessToken: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('@features/auth/lib/auth-cache', () => ({
  getAuthCache: vi.fn().mockReturnValue(null),
  setAuthCache: vi.fn(),
  clearAuthCache: vi.fn(),
}));

// Replace the real queryClient with a spy we can inspect
const clearSpy = vi.fn();
vi.mock('@shared/config/query-client', () => ({
  queryClient: {
    clear: clearSpy,
    invalidateQueries: vi.fn(),
  } as unknown as QueryClient,
}));

describe('Cross-user cache isolation (CP360)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    capturedHandler = null;
    // Dynamic import AFTER mocks are in place
    const { AuthProvider } = await import('@features/auth/model/AuthContext');
    // Render the provider once to install the subscribeAuth listener.
    // React Testing Library would be nicer but we don't need it — the
    // AuthProvider's useEffect runs on its own when we instantiate via
    // React's createElement into a detached container. Simpler: just
    // check that the mocked subscribeAuth captured a handler.
    const { createElement } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    root.render(createElement(AuthProvider, null, null));
    // Wait for async getInitialSession + subscribeAuth registration
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('clears cache on null → user transition (sign-in)', () => {
    expect(capturedHandler).not.toBeNull();
    const initialClearCount = clearSpy.mock.calls.length;

    capturedHandler?.('SIGNED_IN', {
      access_token: 'new-token',
      user: { id: 'user-a' },
    });

    // At least one clear call after the transition
    expect(clearSpy.mock.calls.length).toBeGreaterThan(initialClearCount);
  });

  it('clears cache on userA → userB transition (the exact jamie24kim bug)', () => {
    expect(capturedHandler).not.toBeNull();

    // First user signs in
    capturedHandler?.('SIGNED_IN', {
      access_token: 'token-a',
      user: { id: 'jamesjk4242' },
    });
    const afterFirstSignIn = clearSpy.mock.calls.length;

    // Second user signs in (without explicit sign-out, simulating tab
    // restore or session swap)
    capturedHandler?.('SIGNED_IN', {
      access_token: 'token-b',
      user: { id: 'jamie24kim' },
    });

    // Must have triggered ANOTHER clear — cross-user transition
    expect(clearSpy.mock.calls.length).toBeGreaterThan(afterFirstSignIn);
  });

  it('clears cache on user → null transition (sign-out)', () => {
    expect(capturedHandler).not.toBeNull();

    capturedHandler?.('SIGNED_IN', {
      access_token: 'token-a',
      user: { id: 'user-a' },
    });
    const afterSignIn = clearSpy.mock.calls.length;

    capturedHandler?.('SIGNED_OUT', null);
    expect(clearSpy.mock.calls.length).toBeGreaterThan(afterSignIn);
  });

  it('does NOT clear cache on same-user token refresh', () => {
    expect(capturedHandler).not.toBeNull();

    capturedHandler?.('SIGNED_IN', {
      access_token: 'token-1',
      user: { id: 'user-a' },
    });
    const afterFirst = clearSpy.mock.calls.length;

    // TOKEN_REFRESHED for the same user — must NOT clear cache (would
    // otherwise cause a refetch storm every hour when the JWT rotates)
    capturedHandler?.('TOKEN_REFRESHED', {
      access_token: 'token-2',
      user: { id: 'user-a' },
    });

    expect(clearSpy.mock.calls.length).toBe(afterFirst);
  });
});
