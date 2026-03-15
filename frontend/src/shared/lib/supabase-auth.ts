/**
 * Shared Supabase auth utilities for Edge Function calls.
 */

import { supabase } from '@/shared/integrations/supabase/client';
import { subscribeAuth } from './auth-event-bus';

let cachedHeaders: { headers: Record<string, string>; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000; // 30 seconds

// Invalidate cache on auth state changes via event bus (single listener)
subscribeAuth(() => {
  cachedHeaders = null;
});

// Circuit breaker state
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000; // 30 seconds

/**
 * Get auth headers for Edge Function calls.
 * Caches headers for 30s to avoid repeated getSession() calls during rapid mutations.
 * Includes retry with backoff and circuit breaker protection.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  if (cachedHeaders && Date.now() < cachedHeaders.expiresAt) {
    return cachedHeaders.headers;
  }

  // Circuit breaker check
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD && Date.now() < circuitOpenUntil) {
    throw new Error('Auth temporarily unavailable — too many consecutive failures');
  }

  const maxRetries = 2;
  const backoffMs = [1500, 3000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      let {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        const { data: refreshData } = await supabase.auth.refreshSession();
        session = refreshData?.session ?? null;
        if (!session?.access_token) {
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
      consecutiveFailures = 0; // Reset on success
      return headers;
    } catch (err) {
      // Don't retry auth errors (user not logged in)
      if (err instanceof Error && err.message === 'Not authenticated') {
        consecutiveFailures++;
        if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
          circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
        }
        throw err;
      }

      // Retry on transient errors (network, QUIC timeout)
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt]));
        continue;
      }

      // Final failure
      consecutiveFailures++;
      if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
        console.error('[getAuthHeaders] Circuit breaker open after', consecutiveFailures, 'failures');
      }
      throw err;
    }
  }

  // Should not reach here, but TypeScript requires it
  throw new Error('Auth failed after retries');
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
