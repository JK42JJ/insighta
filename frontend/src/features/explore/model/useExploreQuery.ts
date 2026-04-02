import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { queryKeys } from '@/shared/config/query-client';
import type { ExploreFilters, ExploreListResponse } from '@/shared/types/explore';

export function useExploreMandalas(filters: ExploreFilters) {
  return useQuery<ExploreListResponse>({
    queryKey: queryKeys.explore.list(filters as unknown as Record<string, unknown>),
    queryFn: () =>
      apiClient.listExploreMandalas({
        q: filters.q || undefined,
        domain: filters.domain !== 'all' ? filters.domain : undefined,
        language: filters.language !== 'all' ? filters.language : undefined,
        source: filters.source !== 'all' ? filters.source : undefined,
        sort: filters.sort,
        page: filters.page,
      }),
    staleTime: 30 * 60 * 1000, // 30분 — 템플릿 데이터는 거의 불변
    placeholderData: (prev) => prev,
  });
}

export function useExploreLike() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (mandalaId: string) => apiClient.toggleMandalaLike(mandalaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.explore.all });
    },
  });
}

export function useExploreClone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (mandalaId: string) => apiClient.clonePublicMandala(mandalaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.explore.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.all });
    },
  });
}
