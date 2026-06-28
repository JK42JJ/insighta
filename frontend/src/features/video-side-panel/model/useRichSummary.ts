/**
 * useRichSummary — fetch cached AI rich summary for a YouTube video.
 *
 * CP425 (C2) — wraps `GET /api/v1/videos/:id/rich-summary`. 404 → null
 * (empty state), other errors surface via TanStack Query `error`.
 *
 * CP488+ Phase 4 (2026-05-27) — switched from "BE 404 hides non-pass
 * rows + FE shows pending message" to "BE returns content with
 * `qualityFlag` field + FE shows a subtle auto-improving badge".
 * Honors the user's "detection, not blocking" spec
 * (docs/design/v2-quality-audit-system-2026-05-27.md §2): broken row
 * content is still shown so users can use whatever is available; the
 * background regen worker (Phase 3) replaces it with better content
 * on the next view.
 *
 * Contract: hook MUST NOT trigger generation. Generation is driven by
 * the daily audit cron + Phase 3 regen worker + Heart-click on-demand
 * path. This hook is read-only.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient, type VideoRichSummaryResponse } from '@/shared/lib/api-client';
import { queryKeys } from '@/shared/config/query-client';

const RICH_SUMMARY_STALE_MS = 5 * 60 * 1000;

export interface UseRichSummaryResult {
  richSummary: VideoRichSummaryResponse | null;
  isLoading: boolean;
  isError: boolean;
  /**
   * CP488+ Phase 4 — true when the row exists but `quality_flag !== 'pass'`.
   * Callers should:
   *   1. Render the rich-summary content as-is (no hiding)
   *   2. Display a subtle "auto-improving" indicator
   *   3. SKIP the auto-enrich trigger (avoids re-stamping the same row
   *      in a loop while Phase 3 worker is processing it)
   */
  isQualityWarning: boolean;
}

export function useRichSummary(videoId: string | null | undefined): UseRichSummaryResult {
  const { data, isLoading, isError } = useQuery({
    queryKey: videoId
      ? queryKeys.video.richSummary(videoId)
      : ['video', 'rich-summary', 'disabled'],
    queryFn: () => apiClient.getVideoRichSummary(videoId as string),
    enabled: Boolean(videoId),
    staleTime: RICH_SUMMARY_STALE_MS,
    refetchOnMount: 'always',
    retry: false,
  });

  const isQualityWarning = Boolean(data && data.qualityFlag && data.qualityFlag !== 'pass');

  return {
    richSummary: data ?? null,
    isLoading,
    isError,
    isQualityWarning,
  };
}
