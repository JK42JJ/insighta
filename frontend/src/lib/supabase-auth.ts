/**
 * Shared Supabase auth utilities for Edge Function calls.
 */

import { supabase } from '@/integrations/supabase/client';

/**
 * Get auth headers for Edge Function calls.
 * Attempts session refresh if the current session is expired.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
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
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
    apikey: apiKey,
  };
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
