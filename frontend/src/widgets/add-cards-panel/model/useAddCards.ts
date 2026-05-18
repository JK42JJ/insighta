/**
 * Add Cards mutation (CP466).
 *
 * Calls `POST /api/v1/mandalas/:mandalaId/add-cards`. Wraps TanStack
 * Query useMutation so the panel can submit, show loading, and surface
 * errors via toast. Result list is held in component state (not cache)
 * because the user immediately picks from it — re-fetch is the user's
 * intent ("more videos"), not a stale-cache problem.
 *
 * Spec: docs/design/add-cards-2026-05-18.md §5 (BE) + §6 (FE hook).
 */

import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';

export interface AddCardCandidate {
  videoId: string;
  title: string;
  channel: string | null;
  thumbnail: string | null;
  durationSec: number | null;
  viewCount: number | null;
  publishedAt: string | null;
  score: number;
  cellIndex: number;
  source: 'video_pool';
}

interface AddCardsRequest {
  mandalaId: string;
  extraKeywords: string[];
  excludeVideoIds: string[];
}

interface AddCardsResponseData {
  cards: AddCardCandidate[];
  trace?: {
    layer1_count: number;
    after_exclude: number;
    layer4_boost_applied: number;
    caps_enforced: { channel: number; subgoal: number };
    drift_guard_fired: boolean;
    duration_ms: number;
  };
}

export function useAddCards() {
  return useMutation<AddCardsResponseData, Error, AddCardsRequest>({
    mutationFn: async ({ mandalaId, extraKeywords, excludeVideoIds }) => {
      const result = await apiClient.addCards(mandalaId, { extraKeywords, excludeVideoIds });
      return result.data;
    },
  });
}
