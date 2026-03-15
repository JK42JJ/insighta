/**
 * Auth Event Bus — Single subscription point for Supabase auth state changes.
 *
 * Prevents multiple independent onAuthStateChange listeners from
 * causing lock contention and redundant refresh calls.
 */

import { supabase } from '@/shared/integrations/supabase/client';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

type AuthCallback = (event: AuthChangeEvent, session: Session | null) => void;

const subscribers = new Set<AuthCallback>();
let initialized = false;

function initialize() {
  if (initialized) return;
  initialized = true;

  supabase.auth.onAuthStateChange((event, session) => {
    for (const callback of subscribers) {
      try {
        callback(event, session);
      } catch (err) {
        console.error('[auth-event-bus] Subscriber error:', err);
      }
    }
  });
}

/**
 * Subscribe to auth state changes via the single event bus.
 * Returns an unsubscribe function.
 */
export function subscribeAuth(callback: AuthCallback): () => void {
  initialize();
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}
