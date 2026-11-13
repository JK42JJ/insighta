import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';

import { AUTH_RETURN_KEY } from '@/app/router/mobile-auth-return';
import { useAuth } from '@/features/auth/model/useAuth';

/** Waits until the session from the OAuth return is read, then goes to the target (or /landing). */
export function MobileAuthReturn({ target }: { target: string }): JSX.Element | null {
  const { isLoading, isLoggedIn } = useAuth();
  useEffect(() => {
    if (isLoading) return;
    try {
      sessionStorage.removeItem(AUTH_RETURN_KEY);
    } catch {
      /* storage blocked */
    }
  }, [isLoading]);
  // nothing until the session from the return URL is read (a few hundred ms at most)
  return isLoading ? null : <Navigate to={isLoggedIn ? target : '/landing'} replace />;
}
