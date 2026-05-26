import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { youtubeSyncKeys } from '@/features/youtube-sync/model/useYouTubeSync';
import { localCardsKeys } from './useLocalCards';

export interface LikeCardArgs {
  videoId: string;
  mandalaId?: string;
  title?: string;
  description?: string;
  cellIndex?: number;
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

export type UnlikeCardArgs =
  | string
  | { videoId: string; mandalaId?: string; removeFromMandala?: boolean };

function refreshCardSources(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['cards', 'v2-summaries'] });
  queryClient.invalidateQueries({ queryKey: localCardsKeys.list() });
  queryClient.invalidateQueries({ queryKey: youtubeSyncKeys.allVideoStates });
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
    onSettled: () => {
      refreshCardSources(queryClient);
    },
  });

  const unlike = useMutation({
    mutationFn: async (args: UnlikeCardArgs) => {
      if (typeof args === 'string') {
        await apiClient.unlikeCard(args);
        return;
      }
      const { videoId, mandalaId, removeFromMandala } = args;
      await apiClient.unlikeCard(videoId, { mandalaId, removeFromMandala });
    },
    onSettled: () => {
      refreshCardSources(queryClient);
    },
  });

  return { like, unlike };
}
