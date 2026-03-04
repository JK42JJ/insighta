/**
 * Supabase Client Mock
 *
 * Mocks Supabase client for testing auth flows and database operations.
 */

import { vi } from 'vitest';
import { mockUser, mockSession } from './fixtures';

// ============================================
// Mock State
// ============================================

let isAuthenticated = true;
let currentUser = mockUser;
let currentSession = mockSession;
const authCallbacks: Array<(event: string, session: typeof mockSession | null) => void> = [];

// ============================================
// Auth Mock
// ============================================

export const mockSupabaseAuth = {
  getSession: vi.fn().mockImplementation(() =>
    Promise.resolve({
      data: {
        session: isAuthenticated ? currentSession : null,
      },
      error: null,
    })
  ),

  getUser: vi.fn().mockImplementation(() =>
    Promise.resolve({
      data: {
        user: isAuthenticated ? currentUser : null,
      },
      error: null,
    })
  ),

  signInWithOAuth: vi.fn().mockImplementation(({ provider }: { provider: string }) => {
    console.log(`Mock OAuth sign-in with ${provider}`);
    return Promise.resolve({
      data: { url: `https://accounts.google.com/o/oauth2/auth?mock=true` },
      error: null,
    });
  }),

  signOut: vi.fn().mockImplementation(() => {
    isAuthenticated = false;
    authCallbacks.forEach((cb) => cb('SIGNED_OUT', null));
    return Promise.resolve({ error: null });
  }),

  onAuthStateChange: vi.fn().mockImplementation((callback: (event: string, session: typeof mockSession | null) => void) => {
    authCallbacks.push(callback);
    return {
      data: {
        subscription: {
          unsubscribe: vi.fn().mockImplementation(() => {
            const index = authCallbacks.indexOf(callback);
            if (index > -1) {
              authCallbacks.splice(index, 1);
            }
          }),
        },
      },
    };
  }),

  refreshSession: vi.fn().mockImplementation(() =>
    Promise.resolve({
      data: {
        session: {
          ...currentSession,
          access_token: 'refreshed-access-token',
        },
      },
      error: null,
    })
  ),
};

// ============================================
// Functions Mock (Edge Functions)
// ============================================

export const mockSupabaseFunctions = {
  invoke: vi.fn().mockImplementation((functionName: string, options?: { body?: unknown }) => {
    console.log(`Mock Edge Function call: ${functionName}`, options?.body);
    return Promise.resolve({
      data: { success: true },
      error: null,
    });
  }),
};

// ============================================
// Database Mock (for REST API calls)
// ============================================

export const mockSupabaseFrom = vi.fn().mockImplementation((table: string) => {
  const mockQueryBuilder = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockImplementation(() =>
      Promise.resolve({
        data: null,
        error: null,
      })
    ),
    maybeSingle: vi.fn().mockImplementation(() =>
      Promise.resolve({
        data: null,
        error: null,
      })
    ),
    then: vi.fn().mockImplementation((resolve: (value: { data: null; error: null }) => void) =>
      resolve({ data: null, error: null })
    ),
  };

  // Add execute method that resolves the promise chain
  const execute = vi.fn().mockImplementation(() =>
    Promise.resolve({
      data: [],
      error: null,
    })
  );

  return {
    ...mockQueryBuilder,
    execute,
  };
});

// ============================================
// Complete Supabase Client Mock
// ============================================

export const mockSupabaseClient = {
  auth: mockSupabaseAuth,
  functions: mockSupabaseFunctions,
  from: mockSupabaseFrom,
};

// ============================================
// Helper Functions
// ============================================

/**
 * Set authentication state for tests
 */
export function setMockAuthState(
  authenticated: boolean,
  user = mockUser,
  session = mockSession
): void {
  isAuthenticated = authenticated;
  currentUser = user;
  currentSession = session;

  // Trigger auth state change
  const event = authenticated ? 'SIGNED_IN' : 'SIGNED_OUT';
  authCallbacks.forEach((cb) => cb(event, authenticated ? session : null));
}

/**
 * Simulate token refresh
 */
export function simulateTokenRefresh(): void {
  const newSession = {
    ...currentSession,
    access_token: `refreshed-${Date.now()}`,
  };
  currentSession = newSession;
  authCallbacks.forEach((cb) => cb('TOKEN_REFRESHED', newSession));
}

/**
 * Simulate session expiry
 */
export function simulateSessionExpiry(): void {
  isAuthenticated = false;
  authCallbacks.forEach((cb) => cb('SIGNED_OUT', null));
}

/**
 * Reset all mocks
 */
export function resetSupabaseMocks(): void {
  isAuthenticated = true;
  currentUser = mockUser;
  currentSession = mockSession;
  authCallbacks.length = 0;

  vi.clearAllMocks();
}

// ============================================
// Module Mock Factory
// ============================================

/**
 * Creates the mock module for vi.mock()
 */
export function createSupabaseMock() {
  return {
    createClient: vi.fn().mockReturnValue(mockSupabaseClient),
    supabase: mockSupabaseClient,
  };
}

export default mockSupabaseClient;
