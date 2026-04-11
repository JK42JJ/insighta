import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/shared/integrations/supabase/client';
import { subscribeAuth } from '@/shared/lib/auth-event-bus';
import { apiClient } from '@/shared/lib/api-client';
import { getAuthCache, setAuthCache, clearAuthCache } from '@/features/auth/lib/auth-cache';
import { identifyUser, resetUser } from '@/shared/lib/posthog';
import type { User, Session, AuthError } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isTokenReady: boolean;
  error: AuthError | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, name?: string) => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  // If we have a cached session, skip the loading state entirely for instant render
  const cachedAuth = getAuthCache();
  const [user, setUser] = useState<User | null>(
    cachedAuth
      ? ({
          id: cachedAuth.userId,
          email: cachedAuth.email,
          user_metadata: { full_name: cachedAuth.name, avatar_url: cachedAuth.avatar },
        } as unknown as User)
      : null
  );
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(!cachedAuth);
  const [isTokenReady, setIsTokenReady] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);

  // Note: cross-user cache isolation is handled STRUCTURALLY by
  // `QueryProvider` which owns a per-session QueryClient (Issue #369
  // Option A). AuthContext used to run a blanket `queryClient.clear()`
  // on every userId transition (hotfix D, CP360), but that was a
  // workaround — the per-session client makes it redundant because
  // there is no shared cache across sessions to leak.

  useEffect(() => {
    // Get initial session
    const getInitialSession = async () => {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();
        if (error) {
          console.error('Error getting session:', error);
          setError(error);
          // Cache was wrong — clear it
          if (cachedAuth) clearAuthCache();
        } else {
          setSession(session);
          setUser(session?.user ?? null);
          // Update cache with fresh data (preserve existing tier — subscription query updates it separately)
          if (session?.user) {
            setAuthCache({
              userId: session.user.id,
              email: session.user.email ?? '',
              name:
                session.user.user_metadata?.full_name ?? session.user.email?.split('@')[0] ?? '',
              avatar: session.user.user_metadata?.avatar_url ?? null,
              tier: cachedAuth?.tier ?? 'free',
            });
          } else if (cachedAuth) {
            // No session but we had cache — user logged out elsewhere
            clearAuthCache();
          }
        }
      } catch (err) {
        console.error('Unexpected error getting session:', err);
      } finally {
        setIsLoading(false);
        // Wait for apiClient to have the token cached before allowing queries
        apiClient.tokenReady.then(() => {
          if (apiClient.getAccessToken()) {
            setIsTokenReady(true);
          }
        });
      }
    };

    getInitialSession();

    // Listen for auth changes via event bus (single Supabase listener).
    // Note: React Query cache isolation across users is handled by
    // QueryProvider via per-session client (Issue #369 Option A), not here.
    const unsubscribe = subscribeAuth((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setError(null);
      // Sync auth cache (preserve tier from existing cache)
      if (session?.user) {
        const existing = getAuthCache();
        setAuthCache({
          userId: session.user.id,
          email: session.user.email ?? '',
          name: session.user.user_metadata?.full_name ?? session.user.email?.split('@')[0] ?? '',
          avatar: session.user.user_metadata?.avatar_url ?? null,
          tier: existing?.tier ?? 'free',
        });
        identifyUser(session.user.id, {
          email: session.user.email ?? undefined,
          created_at: session.user.created_at,
        });
      }
      // Ensure isTokenReady reflects token availability on auth transitions
      if (session?.access_token) {
        setIsTokenReady(true);
      } else if (event === 'SIGNED_OUT') {
        setIsTokenReady(false);
        clearAuthCache();
        resetUser();
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const signInWithGoogle = async () => {
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/`,
          scopes: 'https://www.googleapis.com/auth/youtube.readonly',
          queryParams: {
            access_type: 'offline',
            prompt: 'select_account',
          },
        },
      });

      if (error) {
        console.error('Google sign-in error:', error);
        setError(error);
        throw error;
      }
    } catch (err) {
      console.error('Unexpected error during Google sign-in:', err);
      throw err;
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error);
        throw error;
      }
    } catch (err) {
      if (err instanceof Error && !('status' in err)) {
        console.error('Unexpected error during email sign-in:', err);
      }
      throw err;
    }
  };

  const signUpWithEmail = async (email: string, password: string, name?: string) => {
    setError(null);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: name ? { full_name: name } : undefined },
      });
      if (error) {
        setError(error);
        throw error;
      }
    } catch (err) {
      if (err instanceof Error && !('status' in err)) {
        console.error('Unexpected error during email sign-up:', err);
      }
      throw err;
    }
  };

  const signInWithMagicLink = async (email: string) => {
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
        },
      });
      if (error) {
        setError(error);
        throw error;
      }
    } catch (err) {
      if (err instanceof Error && !('status' in err)) {
        console.error('Unexpected error during magic link:', err);
      }
      throw err;
    }
  };

  const resetPassword = async (email: string) => {
    setError(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        setError(error);
        throw error;
      }
    } catch (err) {
      if (err instanceof Error && !('status' in err)) {
        console.error('Unexpected error during password reset:', err);
      }
      throw err;
    }
  };

  const signOut = async () => {
    setError(null);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Sign out error:', error);
        setError(error);
        throw error;
      }
    } catch (err) {
      console.error('Unexpected error during sign out:', err);
      throw err;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        isTokenReady,
        error,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        signInWithMagicLink,
        resetPassword,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuthContext() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}
