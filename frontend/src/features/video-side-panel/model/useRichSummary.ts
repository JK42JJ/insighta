/**
 * useRichSummary — fetch cached AI rich summary for a YouTube video.
 *
 * CP425 (C2) — wraps `GET /api/v1/videos/:id/rich-summary`. 404 → null
 * (empty state), other errors surface via TanStack Query `error`.
 *
 * CP488+ — when BE returns 404 with code='RICH_SUMMARY_QUALITY_LOW' the
 * hook surfaces `isQualityLow=true` so callers can show a
 * regeneration-pending message and SKIP the auto-enrich trigger that
 * would otherwise re-stamp the same qwen3 row in a loop (until B2
 * Sonnet 4.6 model swap ships).
 *
 * Contract: hook MUST NOT trigger generation. Generation is driven by
 * CP425 Trigger 1 (wizard completion) + the server's on-demand enrich
 * hook. This hook is read-only.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient, type VideoRichSummaryResponse, ApiHttpError } from '@/shared/lib/api-client';
import { queryKeys } from '@/shared/config/query-client';

const RICH_SUMMARY_STALE_MS = 5 * 60 * 1000;

export interface UseRichSummaryResult {
  richSummary: VideoRichSummaryResponse | null;
  isLoading: boolean;
  isError: boolean;
  /** CP488+ — row exists but quality_flag != 'pass'. Callers should hide
   *  segments / show regeneration-pending message / skip auto-enrich. */
  isQualityLow: boolean;
}

export function useRichSummary(videoId: string | null | undefined): UseRichSummaryResult {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: videoId
      ? queryKeys.video.richSummary(videoId)
      : ['video', 'rich-summary', 'disabled'],
    queryFn: () => apiClient.getVideoRichSummary(videoId as string),
    enabled: Boolean(videoId),
    staleTime: RICH_SUMMARY_STALE_MS,
    refetchOnMount: 'always',
    retry: false,
  });

  const isQualityLow =
    isError && error instanceof ApiHttpError && error.code === 'RICH_SUMMARY_QUALITY_LOW';

  return {
    richSummary: data ?? null,
    isLoading,
    // Quality-low is an expected state, not an error — keep the consumer's
    // error UI from triggering when this is the only failure mode.
    isError: isError && !isQualityLow,
    isQualityLow,
  };
}
