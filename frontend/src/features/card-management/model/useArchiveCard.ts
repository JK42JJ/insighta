/**
 * useArchiveCard — soft-hide a video card within a mandala.
 *
 * CP462+ Issue #649 Phase 3. Records signal='archive' with the
 * mandala_id; the FE is expected to optimistically hide the card and
 * present a 5-second undo affordance (per handoff decision #6).
 *
 * Schema caveat (also documented in BE cards.ts inline): the UNIQUE
 * constraint is mandala-agnostic, so re-archiving the same video in a
 * different mandala overwrites the mandala_id rather than producing a
 * per-mandala row. Multi-mandala archive scoping is deferred to a
 * future schema iteration.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { localCardsKeys } from './useLocalCards';

export interface ArchiveCardArgs {
  videoId: string;
  mandalaId: string;
}

export function useArchiveCard() {
  const queryClient = useQueryClient();

  const archive = useMutation({
    mutationFn: async (args: ArchiveCardArgs) => {
      const { videoId, mandalaId } = args;
      await apiClient.archiveCard(videoId, mandalaId);
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: localCardsKeys.list() });
      queryClient.invalidateQueries({
        queryKey: ['mandala', 'recommendations', vars.mandalaId],
      });
      queryClient.invalidateQueries({ queryKey: ['mandala', 'recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['cards', 'v2-summaries'] });
    },
  });

  const unarchive = useMutation({
    mutationFn: async (videoId: string) => {
      await apiClient.unarchiveCard(videoId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: localCardsKeys.list() });
      queryClient.invalidateQueries({ queryKey: ['mandala', 'recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['cards', 'v2-summaries'] });
    },
  });

  return { archive, unarchive };
}
