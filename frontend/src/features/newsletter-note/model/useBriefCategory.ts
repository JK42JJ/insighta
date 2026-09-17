/**
 * One brief's published issues, for the list page and the sidebar panel.
 *
 * Keyed on the category so the two surfaces share one fetch, and so
 * subscribing from the panel invalidates what the page shows and vice versa.
 */

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/shared/lib/api-client';

export const briefCategoryQueryKey = (categoryKey: string) =>
  ['brief-category', categoryKey] as const;

export function useBriefCategory(categoryKey: string | undefined) {
  return useQuery({
    queryKey: briefCategoryQueryKey(categoryKey ?? ''),
    queryFn: async () => {
      const res = await apiClient.getBriefCategoryIssues(categoryKey as string);
      if (res.status !== 'ok' || !res.data) throw new Error(res.error ?? 'failed');
      return res.data;
    },
    enabled: !!categoryKey,
    // A weekly publication does not change between renders.
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
