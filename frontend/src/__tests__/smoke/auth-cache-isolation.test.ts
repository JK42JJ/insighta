/**
 * Cross-user cache isolation regression test — Issue #369 Option A
 *
 * Pins the contract that `QueryProvider` owns a PER-SESSION React Query
 * client and replaces it on every userId transition. This is the
 * structural fix that makes cross-user cache leaks impossible by
 * construction, superseding the hotfix-D blanket `queryClient.clear()`
 * that previously lived in AuthContext.
 *
 * Triggering incident (2026-04-08): jamesjk4242 created "파이선 코딩 정복"
 * → signed out → jamie24kim signed in → sidebar rendered jamesjk4242's
 * mandala for jamie24kim even though the DB correctly had no such row
 * for the second user. Root cause: singleton queryClient + user-agnostic
 * query keys (`['mandala','list']`).
 *
 * The fix: `QueryProvider` subscribes directly to the auth event bus,
 * holds a QueryClient in state, and calls `setClient(createQueryClient())`
 * (with teardown of the previous client's cache + in-flight queries)
 * on every userId transition.
 *
 * Verification strategy: spy on `createQueryClient` and assert it is
 * called once per userId transition and NOT called on same-user token
 * refresh events.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    },
  },
}));

// Spy on the factory so we can count invocations. Each call returns a
// real QueryClient so QueryClientProvider doesn't blow up when rendered.
const createClientSpy = vi.fn();
vi.mock('@shared/config/query-client', async () => {
  const { QueryClient } = await import('@tanstack/react-query');
  return {
    createQueryClient: () => {
      createClientSpy();
      return new QueryClient({ defaultOptions: { queries: { retry: false } } });
    },
  };
});

describe('Per-session QueryClient (Issue #369 Option A)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    capturedHandler = null;

    // Dynamic import AFTER mocks are in place
    const { QueryProvider } = await import('@app/providers/QueryProvider');
    const { createElement } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    root.render(createElement(QueryProvider, null, null));

    // Let React effects flush so subscribeAuth runs and the listener
    // is registered.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it('creates an initial QueryClient on mount', () => {
    // useState lazy initializer + any auth transitions during
    // getInitialSession should have fired by now. At minimum the
    // lazy initializer counts as 1 call.
    expect(createClientSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('creates a new QueryClient on sign-in transition (null → user)', () => {
    expect(capturedHandler).not.toBeNull();
    const before = createClientSpy.mock.calls.length;

    capturedHandler?.('SIGNED_IN', {
      access_token: 'token-a',
      user: { id: 'user-a' },
    });

    expect(createClientSpy.mock.calls.length).toBeGreaterThan(before);
  });

  it('creates a new QueryClient on cross-user transition (the jamie24kim bug)', () => {
    expect(capturedHandler).not.toBeNull();

    // First user signs in
    capturedHandler?.('SIGNED_IN', {
      access_token: 'token-a',
      user: { id: 'jamesjk4242' },
    });
    const afterFirstSignIn = createClientSpy.mock.calls.length;

    // Second user signs in without explicit sign-out
    capturedHandler?.('SIGNED_IN', {
      access_token: 'token-b',
      user: { id: 'jamie24kim' },
    });

    // Must have created ANOTHER fresh client — cross-user transition
    expect(createClientSpy.mock.calls.length).toBeGreaterThan(afterFirstSignIn);
  });

  it('creates a new QueryClient on sign-out (user → null)', () => {
    expect(capturedHandler).not.toBeNull();

    capturedHandler?.('SIGNED_IN', {
      access_token: 'token-a',
      user: { id: 'user-a' },
    });
    const afterSignIn = createClientSpy.mock.calls.length;

    capturedHandler?.('SIGNED_OUT', null);

    expect(createClientSpy.mock.calls.length).toBeGreaterThan(afterSignIn);
  });

  it('does NOT create a new QueryClient on same-user TOKEN_REFRESHED', () => {
    expect(capturedHandler).not.toBeNull();

    capturedHandler?.('SIGNED_IN', {
      access_token: 'token-1',
      user: { id: 'user-a' },
    });
    const afterSignIn = createClientSpy.mock.calls.length;

    // Token rotation (~hourly) — must NOT blow away the cache since
    // the user is the same. Otherwise we'd trigger a refetch storm on
    // every JWT rotation.
    capturedHandler?.('TOKEN_REFRESHED', {
      access_token: 'token-2',
      user: { id: 'user-a' },
    });

    expect(createClientSpy.mock.calls.length).toBe(afterSignIn);
  });

  it('does NOT create a new QueryClient on USER_UPDATED for same user', () => {
    expect(capturedHandler).not.toBeNull();

    capturedHandler?.('SIGNED_IN', {
      access_token: 'token-1',
      user: { id: 'user-a' },
    });
    const afterSignIn = createClientSpy.mock.calls.length;

    // User metadata update (e.g. avatar change) — same user id, no
    // cache replacement needed.
    capturedHandler?.('USER_UPDATED', {
      access_token: 'token-1',
      user: { id: 'user-a' },
    });

    expect(createClientSpy.mock.calls.length).toBe(afterSignIn);
  });
});
