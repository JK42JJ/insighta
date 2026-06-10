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
  source: 'video_pool' | 'realtime';
}

export type DurationBucket = 'short' | 'medium' | 'long' | 'xlong';

export interface AddCardsFilters {
  minViewCount?: number;
  durationBucket?: DurationBucket;
  publishedAfter?: string;
}

interface AddCardsRequest {
  mandalaId: string;
  /** T2 — 'en' = EN-only search for this request (한/영 chip). */
  searchLanguage?: 'ko' | 'en';
  extraKeywords: string[];
  excludeVideoIds: string[];
  filters?: AddCardsFilters;
}

export interface AddCardsMandalaMeta {
  title: string;
  focusTags: string[];
  targetLevel: string;
  language: 'ko' | 'en';
}

interface AddCardsResponseData {
  cards: AddCardCandidate[];
  mandalaMeta: AddCardsMandalaMeta;
  /** CP489 Phase 4 — uuid identifying this search round. Reuses the
   *  trace runId so admin can pivot from a UI screenshot to the trace. */
  roundId: string;
  /** CP489 Phase 4 — ISO timestamp the response was produced. Drives
   *  the per-round "방금" / "5분 전" label on the FE separator row. */
  roundAt: string;
  trace?: {
    layer1_count: number;
    tier2_count: number;
    after_exclude: number;
    layer4_boost_applied: number;
    caps_enforced: { channel: number; subgoal: number };
    drift_guard_fired: boolean;
    duration_ms: number;
  };
}

export function useAddCards() {
  return useMutation<AddCardsResponseData, Error, AddCardsRequest>({
    mutationFn: async ({ mandalaId, extraKeywords, excludeVideoIds, filters, searchLanguage }) => {
      const result = await apiClient.addCards(mandalaId, {
        extraKeywords,
        excludeVideoIds,
        ...(searchLanguage && { searchLanguage }),
        ...(filters && { filters }),
      });
      return result.data;
    },
  });
}
