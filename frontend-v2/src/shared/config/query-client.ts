import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 2,
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
  },
  uiPreferences: {
    all: ['ui-preferences'] as const,
  },
} as const;
