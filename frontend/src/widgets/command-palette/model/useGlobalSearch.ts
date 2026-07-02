/**
 * ⌘K palette search hook — debounced call to GET /api/v1/search (PR-1 BE).
 * Server does all scoping/ranking; this hook only debounces + caches.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient, type GlobalSearchResponse } from '@/shared/lib/api-client';
import { useAuth } from '@/features/auth/model/useAuth';
import { useDebounce } from '@/shared/lib/useDebounce';

const PALETTE_DEBOUNCE_MS = 300;
const PALETTE_GROUP_LIMIT = 5;
const PALETTE_STALE_MS = 30_000;

export const globalSearchKeys = {
  all: ['global-search'] as const,
  query: (q: string) => [...globalSearchKeys.all, q] as const,
};

export function useGlobalSearch(rawTerm: string, enabled: boolean) {
  const { isLoggedIn, isTokenReady } = useAuth();
  const term = rawTerm.trim();
  const debounced = useDebounce(term, PALETTE_DEBOUNCE_MS);
  const active = debounced.length > 0;

  const query = useQuery<GlobalSearchResponse>({
    queryKey: globalSearchKeys.query(debounced),
    queryFn: () => apiClient.searchAll(debounced, PALETTE_GROUP_LIMIT),
    enabled: enabled && isLoggedIn && isTokenReady && active,
    staleTime: PALETTE_STALE_MS,
    placeholderData: (prev) => prev,
  });

  return {
    data: query.data ?? null,
    isLoading: query.isFetching && active,
    isActive: active,
    error: query.error,
  };
}
