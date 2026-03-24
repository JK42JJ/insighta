/**
 * Auth session cache — provides instant UI render before Supabase responds.
 * Stored in localStorage, synchronized on login/logout/session refresh.
 */

const AUTH_CACHE_KEY = 'insighta_auth_cache';
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AuthCacheData {
  userId: string;
  email: string;
  name: string;
  avatar: string | null;
  tier: string;
  timestamp: number;
}

/** Synchronously read cached auth data (returns null if missing/expired) */
export function getAuthCache(): AuthCacheData | null {
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    const cache: AuthCacheData = JSON.parse(raw);
    if (Date.now() - cache.timestamp > MAX_CACHE_AGE_MS) {
      localStorage.removeItem(AUTH_CACHE_KEY);
      return null;
    }
    return cache;
  } catch {
    return null;
  }
}

/** Save auth data to cache (call on login success / session refresh) */
export function setAuthCache(data: Omit<AuthCacheData, 'timestamp'>): void {
  try {
    localStorage.setItem(
      AUTH_CACHE_KEY,
      JSON.stringify({ ...data, timestamp: Date.now() })
    );
  } catch {
    // localStorage full or blocked — ignore silently
  }
}

/** Update tier in existing cache (call when subscription data loads) */
export function updateAuthCacheTier(tier: string): void {
  const cache = getAuthCache();
  if (cache) {
    setAuthCache({ ...cache, tier });
  }
}

/** Clear auth cache (call on logout) */
export function clearAuthCache(): void {
  try {
    localStorage.removeItem(AUTH_CACHE_KEY);
  } catch {
    // ignore
  }
}
