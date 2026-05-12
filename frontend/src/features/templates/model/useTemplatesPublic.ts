import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { queryKeys } from '@/shared/config/query-client';
import type { ExploreFilters, ExploreListResponse } from '@/shared/types/explore';

/**
 * Public templates listing for the marketing /templates page.
 *
 * - Anonymous-accessible (no auth token attached by BE contract).
 * - `source` is forced to `'all'` — `'mine'` is rejected (marketing page has no user
 *   ownership context).
 * - Mirrors `useExploreMandalas` shape so the page UI can be a thin variant of the
 *   pre-CP453 ExplorePage.
 */
const STALE_TIME_MS = 30 * 60 * 1000; // 30 minutes — templates are near-immutable

export function useTemplatesPublic(filters: ExploreFilters) {
  return useQuery<ExploreListResponse>({
    queryKey: queryKeys.templatesPublic.list(filters as unknown as Record<string, unknown>),
    queryFn: () =>
      apiClient.listPublicTemplates({
        q: filters.q || undefined,
        domain: filters.domain !== 'all' ? filters.domain : undefined,
        language: filters.language !== 'all' ? filters.language : undefined,
        sort: filters.sort,
        page: filters.page,
      }),
    staleTime: STALE_TIME_MS,
    placeholderData: (prev) => prev,
  });
}
