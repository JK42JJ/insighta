/**
 * useSummaryRating — Rate AI summaries and fetch existing ratings
 *
 * Stores ratings in ontology.nodes.properties (summary_rating: 1 | -1 | null).
 * Used for model quality scoring pipeline.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/model/useAuth';
import apiClient from '@/shared/lib/api-client';

export type SummaryRating = 1 | -1 | null;

// Query key
export const summaryRatingsKey = ['summary-ratings'] as const;

interface RatingsResponse {
  status: string;
  data: { ratings: Record<string, number> };
}

/**
 * Fetch all summary ratings for current user
 */
export function useSummaryRatings() {
  const { isLoggedIn, isTokenReady } = useAuth();

  return useQuery({
    queryKey: summaryRatingsKey,
    queryFn: async (): Promise<Record<string, number>> => {
      await apiClient.tokenReady;
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/v1/ontology/summary-ratings`,
        {
          headers: {
            Authorization: `Bearer ${apiClient.getAccessToken()}`,
            'Content-Type': 'application/json',
          },
        }
      );
      if (!res.ok) throw new Error('Failed to fetch summary ratings');
      const json: RatingsResponse = await res.json();
      return json.data.ratings;
    },
    enabled: isLoggedIn && isTokenReady,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Rate an AI summary (like/unlike/clear)
 */
export function useRateSummary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ cardId, rating }: { cardId: string; rating: SummaryRating }) => {
      await apiClient.tokenReady;
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/v1/ontology/rate-summary`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiClient.getAccessToken()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ card_id: cardId, rating }),
        }
      );
      if (!res.ok) throw new Error('Failed to rate summary');
      return res.json();
    },
    onMutate: async ({ cardId, rating }) => {
      await queryClient.cancelQueries({ queryKey: summaryRatingsKey });
      const previous = queryClient.getQueryData<Record<string, number>>(summaryRatingsKey);

      // Optimistic update
      queryClient.setQueryData<Record<string, number>>(summaryRatingsKey, (prev) => {
        const next = { ...(prev ?? {}) };
        if (rating === null) {
          delete next[cardId];
        } else {
          next[cardId] = rating;
        }
        return next;
      });

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(summaryRatingsKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: summaryRatingsKey });
    },
  });
}
