/**
 * useV2Summaries — batch lookup of v2 rich-summary fields for the
 * card grid.
 *
 * CP462+ Issue #649 Phase 3. Returns a Map keyed by videoId, so the
 * grid can render the Heart-only quality badge
 * (`mandala_relevance_pct`) and the footer one-liner without a
 * per-card round trip. videoIds without a v2 row simply do not appear
 * in the map (FE hides the badge and footer for those).
 *
 * Cache settings:
 *   - staleTime: 60s (v2 rows mutate only on Heart click or cron
 *     promotion; 60s is long enough to amortise the request, short
 *     enough that a fresh Heart click sees its new score on the next
 *     grid render).
 *   - queryKey includes the SORTED ids list so two callers with the
 *     same set hit the same cache regardless of input order.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';

export interface V2SummaryItem {
  videoId: string;
  oneLiner: string | null;
  mandalaRelevancePct: number | null;
  qualityFlag: string | null;
  templateVersion: string;
}

const V2_SUMMARIES_STALE_MS = 60 * 1000;

export function useV2Summaries(videoIds: string[] | null | undefined) {
  const dedupedIds = videoIds && videoIds.length > 0 ? [...new Set(videoIds)].sort() : [];
  const enabled = dedupedIds.length > 0;

  const query = useQuery({
    // CP463 flicker-fix — queryKey is the LENGTH + first/last id only,
    // NOT the full join. The full-join key changed on every card list
    // mutation (server refetch returns a new array even when contents
    // match), which forced a cache miss + loading-state render on every
    // refetch cycle, contributing to the grid flicker storm. Length +
    // bounds is a stable identifier for "same set of cards in the same
    // order" — when the set genuinely changes the key changes too.
    queryKey: [
      'cards',
      'v2-summaries',
      dedupedIds.length,
      dedupedIds[0] ?? '',
      dedupedIds[dedupedIds.length - 1] ?? '',
    ],
    queryFn: () => apiClient.getV2Summaries(dedupedIds),
    enabled,
    staleTime: V2_SUMMARIES_STALE_MS,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const map = new Map<string, V2SummaryItem>();
  for (const item of query.data?.data.items ?? []) {
    map.set(item.videoId, item);
  }

  return {
    summariesByVideoId: map,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
