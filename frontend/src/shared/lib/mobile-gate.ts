/**
 * Mobile gate — during closed beta the app is desktop-only; mobile visitors
 * only see the marketing surfaces until the mobile UX redesign ships.
 *
 * Detection combines viewport width AND coarse pointer so narrow desktop
 * windows (devtools, split screen) are not falsely gated.
 */

export const MOBILE_GATE_MAX_WIDTH = 767;

/** Marketing/legal surfaces that stay reachable on mobile. */
const ALLOWED_MOBILE_PATH_PREFIXES = [
  '/landing',
  '/beta',
  '/pricing',
  '/templates',
  '/privacy',
  '/terms',
  '/help',
] as const;

export function isPathAllowedOnMobile(pathname: string): boolean {
  return ALLOWED_MOBILE_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const narrow = window.matchMedia(`(max-width: ${MOBILE_GATE_MAX_WIDTH}px)`).matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  return narrow && coarse;
}

/** Session flag so the landing page can explain why the app redirected. */
export const MOBILE_GATE_FLAG_KEY = 'insighta:mobile-gated';
