/**
 * useLikeCard — Heart-click a video card.
 *
 * CP462+ Issue #649 Phase 3. Mirrors usePinCard's invalidation
 * strategy: on success the local-cards list AND every cached
 * recommendation feed for the affected mandala refetch so the new
 * pinned_at / signal state surfaces without a manual reload.
 *
 * Two mutation modes:
 *   - like(videoId, {mandalaId, title?, description?}) — records
 *     signal='like', sets pinned_at=now() on source rows, enqueues
 *     v2 enrichment when mandalaId is provided. Returns the BE
 *     payload so callers (Heart UI) can read the new jobId and open
 *     the enrich-stream EventSource.
 *   - unlike(videoId) — DELETE signal + pinned_at=NULL.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { localCardsKeys } from './useLocalCards';

export interface LikeCardArgs {
  videoId: string;
  mandalaId?: string;
  title?: string;
  description?: string;
  /** CP466 — Add Cards panel pass the candidate's auto-assigned cell
   *  so the BE UPSERT can place it in the right mandala sector. */
  cellIndex?: number;
  /** CP467 — Tier 2 (fresh-from-YouTube) candidates have no
   *  youtube_videos row yet. Sending the metadata lets BE INSERT
   *  the row so the card actually reaches the mandala grid. */
  videoCacheHint?: {
    title?: string | null;
    description?: string | null;
    channelTitle?: string | null;
    thumbnailUrl?: string | null;
    durationSec?: number | null;
    viewCount?: number | null;
    publishedAt?: string | null;
  };
}

export function useLikeCard() {
  const queryClient = useQueryClient();

  const like = useMutation({
    mutationFn: async (args: LikeCardArgs) => {
      const { videoId, mandalaId, title, description, cellIndex, videoCacheHint } = args;
      return apiClient.likeCard(videoId, {
        mandalaId,
        title,
        description,
        cellIndex,
        videoCacheHint,
      });
    },
    onSuccess: () => {
      // Skip the recommendation feed invalidate — the optimistic flip
      // covers the grid and a full refetch causes flicker storms.
      queryClient.invalidateQueries({ queryKey: ['cards', 'v2-summaries'] });
      // localCards drives the sidebar book-index; refetch so the new
      // pinned card surfaces under its sub-goal without a manual reload.
      queryClient.invalidateQueries({ queryKey: localCardsKeys.list() });
    },
  });

  const unlike = useMutation({
    mutationFn: async (videoId: string) => {
      await apiClient.unlikeCard(videoId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards', 'v2-summaries'] });
      queryClient.invalidateQueries({ queryKey: localCardsKeys.list() });
    },
  });

  return { like, unlike };
}
