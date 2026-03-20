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

export const queryClient = new QueryClient({
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
  },
  uiPreferences: {
    all: ['ui-preferences'] as const,
  },
} as const;
