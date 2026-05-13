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
  /**
   * Best-matching transcript chunk start time, in seconds.
   * When non-null, the card click builds a YouTube URL with `&t=<startSec>s`
   * so the user lands on the relevant moment. Null when no chunk data exists
   * for the video (most videos as of 2026-05-12 — only 64/1493 covered).
   *
   * Sourced from `video_chunk_embeddings.start_time` via BE chunk anchor
   * lookup (hybrid-retrieval spec PR3).
   */
  startSec?: number | null;
  /**
   * CP457+ pin/bookmark timestamp from user_video_states (joined by
   * video_id). ISO string when pinned, null when not. Surfaced so the
   * grid bookmark icon renders in its persisted active state without a
   * second round-trip.
   */
  pinnedAt?: string | null;
}

export interface RecommendationsResponse {
  mandalaId: string;
  mode: RecommendationMode;
  items: RecommendationItem[];
  lastRefreshed: string | null;
}

/**
 * Stale time = how long cached data is considered fresh before refetch is
 * allowed. 30s lets SSE push be the fast path while REST polling stays the
 * idempotency baseline (CP455 멱등성 원칙).
 */
const REC_FEED_STALE_TIME_MS = 30 * 1000;

/**
 * Background refetch interval (CP455 SSE PR — loosely coupled fallback).
 * Polls `/recommendations` regardless of SSE state so the dashboard stays
 * correct even if SSE is dead (proxy / CDN timeout / browser quirk).
 * 8s = balance between freshness (user sees cards within ~8s if SSE down)
 * and quota (8 requests / minute / mandala — light).
 */
const REC_FEED_REFETCH_INTERVAL_MS = 8 * 1000;

export function useRecommendations(mandalaId: string | null | undefined) {
  const { data, isLoading, isError, refetch } = useQuery<RecommendationsResponse>({
    queryKey: ['mandala', 'recommendations', mandalaId ?? null],
    queryFn: () => apiClient.getMandalaRecommendations(mandalaId as string),
    enabled: !!mandalaId,
    staleTime: REC_FEED_STALE_TIME_MS,
    refetchInterval: REC_FEED_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
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
