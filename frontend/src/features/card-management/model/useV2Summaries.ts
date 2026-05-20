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

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';

export interface V2SummaryItem {
  videoId: string;
  oneLiner: string | null;
  /**
   * CP474 — v2 `analysis.core_argument` (2-3 sentences capturing the
   * central thesis). Grid card blockquote prefers this over `oneLiner`
   * because oneLiner is capped at 20 chars and underfills the
   * line-clamp-3 slot. NULL when the row is pre-v2 or `analysis` is
   * absent.
   */
  coreArgument: string | null;
  /** Top key-concept terms (≤ 3) used as book-index entries in the
   *  sidebar. Empty when the row is pre-v2 or analysis is absent. */
  keyConcepts: string[];
  /** Fallback keyword source for videos without a v2 row yet — derived
   *  from video_summaries.tags. Sidebar uses these when keyConcepts empty. */
  fallbackTags: string[];
  mandalaRelevancePct: number | null;
  qualityFlag: string | null;
  templateVersion: string;
  /**
   * CP475+ — true when v2 full path landed (segments.atoms > 0). Grid
   * card promotes v2 essence over v1 summary_ko only when this is true,
   * preventing the quick-only essence from overwriting a richer v1
   * description while the full path is still running.
   */
  v2FullLanded: boolean;
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
    // CP475+ — bookmarking a new card invalidates this query, and the
    // grid mutation simultaneously changes `dedupedIds.length` → a new
    // cache entry with `data=undefined` would render every existing
    // card's v2 summary as empty while the refetch runs (visible as a
    // height-shrink jump across the grid). `keepPreviousData` makes
    // the previous batch's data act as a placeholder until the next
    // batch resolves, so no v2-derived field ever transiently goes to
    // null on an unrelated card.
    placeholderData: keepPreviousData,
  });

  const map = new Map<string, V2SummaryItem>();
  for (const item of query.data?.data.items ?? []) {
    map.set(item.videoId, item);
  }

  return {
    summariesByVideoId: map,
    isLoading: query.isLoading,
    // Covers initial load + background refetch. Consumers suppress v1
    // fallback while this is true to avoid the v1->v2 swap flicker.
    isFetching: query.isFetching,
    isError: query.isError,
  };
}
