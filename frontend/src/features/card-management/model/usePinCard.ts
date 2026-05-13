/**
 * usePinCard — toggle pin / bookmark on a grid view card.
 *
 * Cards can originate from either `user_local_cards` or `user_video_states`,
 * carried as `InsightCard.sourceTable`. The mutation hits BE
 * `PATCH /api/v1/cards/:id/pin` which dispatches to the correct table.
 *
 * On success we invalidate BOTH the local-cards list (`localCardsKeys.list()`)
 * and the recommendation cache (`['mandala', 'recommendations', mandalaId]`)
 * so whichever feed displays the card refetches the new `pinned_at` value.
 *
 * Optimistic update: caller pattern (`useDeleteMandala`) keeps the existing
 * list shape and just flips the local boolean on the matching row. We mirror
 * that to keep the UI in sync until the next refetch.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { localCardsKeys } from './useLocalCards';
import type { InsightCard } from '@/entities/card/model/types';

export interface PinCardArgs {
  card: InsightCard;
  pinned: boolean;
}

export function usePinCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ card, pinned }: PinCardArgs) => {
      const source = card.sourceTable ?? 'user_local_cards';
      const result = await apiClient.setCardPin(card.id, pinned, source);
      return result;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: localCardsKeys.list() });
      if (vars.card.mandalaId) {
        queryClient.invalidateQueries({
          queryKey: ['mandala', 'recommendations', vars.card.mandalaId],
        });
      }
      queryClient.invalidateQueries({
        queryKey: ['mandala', 'recommendations'],
      });
    },
  });
}
