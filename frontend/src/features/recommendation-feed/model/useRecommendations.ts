import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';

export type RecommendationMode = 'auto' | 'manual';
export type RecommendationSource = 'auto_recommend' | 'manual';

export interface RecommendationItem {
  id: string;
  videoId: string;
  title: string;
  channel: string | null;
  thumbnail: string | null;
  durationSec: number | null;
  recScore: number;
  cellIndex: number | null;
  cellLabel: string | null;
  keyword: string;
  source: RecommendationSource;
  recReason: string | null;
}

export interface RecommendationsResponse {
  mandalaId: string;
  mode: RecommendationMode;
  items: RecommendationItem[];
  lastRefreshed: string | null;
}

/** 5 minutes — recommendation_cache is refreshed by an offline pipeline. */
const REC_FEED_STALE_TIME_MS = 5 * 60 * 1000;

export function useRecommendations(mandalaId: string | null | undefined) {
  const { data, isLoading, isError, refetch } = useQuery<RecommendationsResponse>({
    queryKey: ['mandala', 'recommendations', mandalaId ?? null],
    queryFn: () => apiClient.getMandalaRecommendations(mandalaId as string),
    enabled: !!mandalaId,
    staleTime: REC_FEED_STALE_TIME_MS,
    retry: (failureCount, err: unknown) => {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 403) return false;
      return failureCount < 2;
    },
  });

  return {
    recommendations: data ?? null,
    isLoading,
    isError,
    refetch,
  };
}
