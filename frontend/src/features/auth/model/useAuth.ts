import { useAuthContext } from './AuthContext';

/**
 * Hook to access authentication state and methods
 * Wraps the AuthContext with additional computed properties
 */
export function useAuth() {
  const context = useAuthContext();

  return {
    ...context,
    // Computed properties
    isLoggedIn: !!context.user,
    userEmail: context.user?.email ?? null,
    userName: context.user?.user_metadata?.full_name ?? context.user?.email?.split('@')[0] ?? null,
    userAvatar: context.user?.user_metadata?.avatar_url ?? null,
  };
}

export type { User, Session } from '@supabase/supabase-js';
