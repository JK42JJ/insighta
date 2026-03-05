/**
 * Shared Supabase auth utilities for Edge Function calls.
 */

import { supabase } from '@/integrations/supabase/client';

let cachedHeaders: { headers: Record<string, string>; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000; // 30 seconds

// Invalidate cache on auth state changes (sign-in, sign-out, token refresh)
supabase.auth.onAuthStateChange(() => {
  cachedHeaders = null;
});

/**
 * Get auth headers for Edge Function calls.
 * Caches headers for 30s to avoid repeated getSession() calls during rapid mutations.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  if (cachedHeaders && Date.now() < cachedHeaders.expiresAt) {
    return cachedHeaders.headers;
  }

  let {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    const { data: refreshData } = await supabase.auth.refreshSession();
    session = refreshData?.session ?? null;
    if (!session?.access_token) {
      console.error('[getAuthHeaders] No valid session after refresh attempt');
      throw new Error('Not authenticated');
    }
  }
  const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  const headers = {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
    apikey: apiKey,
  };

  cachedHeaders = { headers, expiresAt: Date.now() + CACHE_TTL_MS };
  return headers;
}

/**
 * Build Edge Function URL.
 */
export function getEdgeFunctionUrl(functionName: string, action: string): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL is not configured');
  }
  return `${supabaseUrl}/functions/v1/${functionName}?action=${action}`;
}
