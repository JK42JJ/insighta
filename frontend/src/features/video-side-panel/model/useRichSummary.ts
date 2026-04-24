/**
 * useRichSummary — fetch cached AI rich summary for a YouTube video.
 *
 * CP425 (C2) — wraps `GET /api/v1/videos/:id/rich-summary`. 404 → null
 * (empty state), other errors surface via TanStack Query `error`.
 *
 * Contract: hook MUST NOT trigger generation. Generation is driven by
 * CP425 Trigger 1 (wizard completion) + the server's on-demand enrich
 * hook. This hook is read-only.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient, type VideoRichSummaryResponse } from '@/shared/lib/api-client';
import { queryKeys } from '@/shared/config/query-client';

const RICH_SUMMARY_STALE_MS = 5 * 60 * 1000;

export interface UseRichSummaryResult {
  richSummary: VideoRichSummaryResponse | null;
  isLoading: boolean;
  isError: boolean;
}

export function useRichSummary(videoId: string | null | undefined): UseRichSummaryResult {
  const { data, isLoading, isError } = useQuery({
    queryKey: videoId
      ? queryKeys.video.richSummary(videoId)
      : ['video', 'rich-summary', 'disabled'],
    queryFn: () => apiClient.getVideoRichSummary(videoId as string),
    enabled: Boolean(videoId),
    staleTime: RICH_SUMMARY_STALE_MS,
    retry: false,
  });

  return {
    richSummary: data ?? null,
    isLoading,
    isError,
  };
}
