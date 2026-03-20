import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { queryKeys } from '@/shared/config/query-client';
import { MoodState, type MoodResult } from './types';

const MOOD_STALE_TIME = 5 * 60_000;

export function useMoodDetection(mandalaId: string | undefined) {
  return useQuery<MoodResult>({
    queryKey: queryKeys.mandala.mood(mandalaId ?? ''),
    queryFn: () => apiClient.getMandalaMood(mandalaId!),
    enabled: !!mandalaId,
    staleTime: MOOD_STALE_TIME,
    select: (data) => data,
    placeholderData: {
      state: MoodState.COMFORTABLE,
      signals: {
        weeklySessionCount: 0,
        entertainmentRatio: 0,
        newTopicCount: 0,
        daysSinceLastActivity: 0,
        totalCards: 0,
      },
      updatedAt: new Date().toISOString(),
    },
  });
}
