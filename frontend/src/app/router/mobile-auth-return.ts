import { isPathAllowedOnMobile } from '@/shared/lib/mobile-gate';

/**
 * Google sign-in on a phone (2026-11-13). OAuth returns to `/`, and on a phone the closed-beta
 * gate sends `/` to /landing, so the return target LoginPage stored was never used: the person
 * ended on the landing page instead of the screen they came from (e.g. /morning-cards?view=watch).
 * Only for `/` with a pending target whose path is open on phones; everything else is unchanged.
 */
export const AUTH_RETURN_KEY = 'auth-return-to';

/** The stored target to go to after sign-in on a phone, or null to keep the gate as it is. */
export function mobileReturnTarget(pathname: string, stored: string | null): string | null {
  if (pathname !== '/' || !stored) return null;
  if (!stored.startsWith('/') || stored.startsWith('//')) return null;
  const path = stored.split(/[?#]/)[0];
  if (path === '/' || path === '/login') return null;
  return isPathAllowedOnMobile(path) ? stored : null;
}

export function readAuthReturn(): string | null {
  try {
    return sessionStorage.getItem(AUTH_RETURN_KEY);
  } catch {
    return null;
  }
}
