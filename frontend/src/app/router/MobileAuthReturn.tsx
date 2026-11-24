import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { AUTH_RETURN_KEY } from '@/app/router/mobile-auth-return';
import { WATCH_RETURN_PATH } from '@/app/router/watch-path';
import { useAuth } from '@/features/auth/model/useAuth';
import { WatchBoot } from '@/features/morning-feed/WatchBoot';

/** If the session from the return URL is still not read after this, go on anyway (James 2026-11-24: a black
 * screen after Google sign-in on an iPhone). The target screen shows the landing or the app by itself. */
export const AUTH_RETURN_WAIT_MS = 5000;

/** Waits until the session from the OAuth return is read, then goes to the target (or /landing). */
export function MobileAuthReturn({ target }: { target: string }): JSX.Element {
  const { isLoading, isLoggedIn } = useAuth();
  useEffect(() => {
    if (isLoading) return;
    try {
      sessionStorage.removeItem(AUTH_RETURN_KEY);
    } catch {
      /* storage blocked */
    }
  }, [isLoading]);
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (!isLoading) return;
    const t = window.setTimeout(() => setGaveUp(true), AUTH_RETURN_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [isLoading]);
  // the paper boot screen (never a blank, dark page) until the session from the return URL is read
  if (isLoading && !gaveUp) return <WatchBoot />;
  return <Navigate to={isLoggedIn || gaveUp ? target : WATCH_RETURN_PATH} replace />;
}
