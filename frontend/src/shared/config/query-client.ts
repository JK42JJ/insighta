import { QueryClient } from '@tanstack/react-query';
import { ApiHttpError } from '@/shared/lib/api-client';

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiHttpError) {
    // Allow 1 retry on 401 to handle auth race condition (token not yet cached)
    if (error.statusCode === 401) return failureCount < 1;
    if (failureCount >= 3) return false;
    return error.isTransient;
  }
  return failureCount < 3; // network errors etc.
}

function retryDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 10_000);
}

/**
 * CP360 Option A — Per-session QueryClient factory.
 *
 * Issue #369 background: React Query keys are user-agnostic by convention
 * (`['mandala','list']`, `['mandala','dashboard', mandalaId]`, etc.). Paired
 * with an app-lifetime singleton QueryClient, this let user A's cached data
 * leak into user B's session after account switching (triggering incident:
 * jamie24kim saw jamesjk4242's '파이선 코딩 정복').
 *
 * The structural fix is to OWN a fresh QueryClient per authenticated
 * session. When the userId transitions, we tear down the old client and
 * mount a new one — it is then STRUCTURALLY IMPOSSIBLE for the previous
 * user's cache to exist in the new session's client, no matter what key
 * shape a future developer uses.
 *
 * The factory is the only exported way to get a QueryClient. There is NO
 * module-level singleton. Callers must either:
 *   - Be inside the `<QueryProvider>` tree and use `useQueryClient()`, OR
 *   - Create their own client explicitly (tests, one-shot scripts)
 *
 * The previous `queryClient` singleton export was removed — any remaining
 * imports will fail to typecheck, which is the desired behavior. See
 * `QueryProvider.tsx` for the session ownership logic.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        retryDelay,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export const queryKeys = {
  youtube: {
    all: ['youtube'] as const,
    playlists: () => [...queryKeys.youtube.all, 'playlists'] as const,
    allVideoStates: () => [...queryKeys.youtube.all, 'all-video-states'] as const,
  },
  localCards: {
    all: ['local-cards'] as const,
    list: () => [...queryKeys.localCards.all, 'list'] as const,
  },
  mandala: {
    all: ['mandala'] as const,
    default: () => [...queryKeys.mandala.all, 'default'] as const,
    list: () => [...queryKeys.mandala.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.mandala.all, 'detail', id] as const,
    quota: () => [...queryKeys.mandala.all, 'quota'] as const,
    subscriptions: () => [...queryKeys.mandala.all, 'subscriptions'] as const,
    mood: (id: string) => [...queryKeys.mandala.all, 'mood', id] as const,
    sourceMappings: () => [...queryKeys.mandala.all, 'source-mappings'] as const,
  },
  skills: {
    all: ['skills'] as const,
    list: () => ['skills', 'list'] as const,
    outputs: (mandalaId: string) => ['skills', 'outputs', mandalaId] as const,
  },
  explore: {
    all: ['explore'] as const,
    list: (filters: Record<string, unknown>) => ['explore', 'list', filters] as const,
  },
  uiPreferences: {
    all: ['ui-preferences'] as const,
  },
  video: {
    all: ['video'] as const,
    richSummary: (videoId: string) => [...queryKeys.video.all, 'rich-summary', videoId] as const,
  },
} as const;
