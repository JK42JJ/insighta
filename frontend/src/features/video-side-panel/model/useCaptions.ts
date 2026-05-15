/**
 * useCaptions — fetch YouTube captions (transcript) for a video on demand.
 *
 * Powers the chatbot's video-summary fallback: when no rich summary exists
 * yet, the transcript is fed to the model so it can still produce a real
 * summary instead of refusing. Caller gates `enabled` (typically
 * `!richSummary`) so transcript is only fetched when actually needed.
 *
 * Transcript extraction can fail (no public captions, bot-gate) — that
 * surfaces as `captions === null`, and the chatbot degrades to its
 * "analysis in progress" message rather than fabricating content.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient, type VideoCaptionResponse } from '@/shared/lib/api-client';
import { queryKeys } from '@/shared/config/query-client';

// Transcript text is immutable for a given video — cache aggressively.
const CAPTIONS_STALE_MS = 60 * 60 * 1000;

export interface UseCaptionsResult {
  captions: VideoCaptionResponse | null;
  isLoading: boolean;
  isError: boolean;
}

export function useCaptions(
  videoId: string | null | undefined,
  enabled: boolean
): UseCaptionsResult {
  const { data, isLoading, isError } = useQuery({
    queryKey: videoId
      ? queryKeys.video.captions(videoId, 'auto')
      : ['video', 'captions', 'disabled'],
    // No explicit language — the server tries en then ko, maximising hit
    // rate. Output language is controlled by the chatbot's own language rule.
    queryFn: () => apiClient.getVideoCaptions(videoId as string),
    enabled: Boolean(videoId) && enabled,
    staleTime: CAPTIONS_STALE_MS,
    retry: false,
  });

  return {
    captions: data ?? null,
    isLoading,
    isError,
  };
}
