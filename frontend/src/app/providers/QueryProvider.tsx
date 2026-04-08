/**
 * QueryProvider — CP360 Option A (Issue #369)
 *
 * Owns the lifecycle of a PER-SESSION React Query client. A fresh
 * `QueryClient` is created every time the Supabase authenticated user
 * transitions (null→user, user→null, userA→userB). The previous client
 * is fully torn down — its cache is cleared and any in-flight queries
 * are cancelled — before being replaced.
 *
 * Why: under a singleton client, query keys like `['mandala','list']`
 * (which contain no userId) were cross-user leaky. When user A signed
 * out and user B signed in, the sidebar would still render user A's
 * cached payload until the next refetch. See issue #369 for the full
 * RCA + the rejected alternatives (userId in every key / ESLint rule).
 *
 * This component is the ONLY place that owns a QueryClient. Do not
 * import `createQueryClient` elsewhere except in tests.
 *
 * Provider nesting (from App.tsx):
 *
 *   BrowserRouter
 *     ErrorBoundary
 *       QueryProvider        ← owns per-session client, subscribes to auth bus
 *         ThemeProvider
 *           AuthProvider     ← can safely use useQueryClient() if needed
 *             ...
 *
 * QueryProvider subscribes to the auth event bus directly (not via
 * AuthContext) so that it sits ABOVE AuthProvider in the tree without
 * a circular dependency. The event bus is a module-level singleton;
 * multiple subscribers coexist without conflict.
 */

import { useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '@/shared/integrations/supabase/client';
import { subscribeAuth } from '@/shared/lib/auth-event-bus';
import { createQueryClient } from '@/shared/config/query-client';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client, setClient] = useState<QueryClient>(() => createQueryClient());

  // Track the userId the current client belongs to. Starts unknown —
  // resolved either by the initial getSession() call below or by the
  // first auth event. Ref instead of state so updates don't trigger
  // re-renders (the setClient call already re-renders when needed).
  const clientOwnerRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    /**
     * Replace the current QueryClient with a brand new one. The old
     * client's in-flight queries are cancelled and its cache is
     * cleared. Any components holding a reference to the old client
     * via `useQueryClient()` will be re-rendered with the new client
     * through QueryClientProvider's context update.
     *
     * The new client is created SYNCHRONOUSLY (outside the setClient
     * updater callback) so test spies on `createQueryClient` observe
     * the call immediately, and so the teardown of `prev` happens in
     * a predictable order.
     */
    function replaceClient(newUserId: string | null): void {
      if (cancelled) return;
      const next = createQueryClient();
      setClient((prev) => {
        // Tear down the previous client: cancel in-flight queries so
        // they don't resolve into the new client's cache (which
        // wouldn't happen anyway since the context has changed, but
        // cancelling also releases the network requests).
        try {
          prev.cancelQueries();
        } catch {
          // ignore — cancelling is best-effort
        }
        prev.clear();
        return next;
      });
      clientOwnerRef.current = newUserId;
    }

    // 1. Initial session resolution. If the persisted session belongs
    //    to a specific user, claim the current (empty) client for that
    //    user. No client swap needed — the fresh client from useState
    //    is already empty.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        const initialUserId = data.session?.user?.id ?? null;
        clientOwnerRef.current = initialUserId;
      })
      .catch(() => {
        // ignore — if getSession fails we leave the client unclaimed;
        // the next auth event will repair the state
      });

    // 2. Subscribe to runtime auth transitions.
    const unsubscribe = subscribeAuth((_event, session) => {
      if (cancelled) return;
      const newUserId = session?.user?.id ?? null;
      // Only replace on actual userId change — TOKEN_REFRESHED for the
      // same user must NOT blow away the cache (would cause a refetch
      // storm every time Supabase rotates the JWT, ~hourly).
      if (clientOwnerRef.current !== newUserId) {
        replaceClient(newUserId);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // Intentionally empty deps: this effect owns the full lifecycle.
    // `client` changes through setClient inside replaceClient, so
    // including it would cause an infinite re-subscription loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
