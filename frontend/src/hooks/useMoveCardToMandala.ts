/**
 * useMoveCardToMandala Hook
 *
 * Moves a card (synced or local) to a different mandala.
 * Updates mandala_id via Edge Functions and invalidates both source/target caches.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthHeaders, getEdgeFunctionUrl } from '@/lib/supabase-auth';
import type { CardSource } from '@/lib/cardUtils';

interface MoveCardToMandalaVars {
  cardId: string;
  targetMandalaId: string;
  source: CardSource;
}

export function useMoveCardToMandala() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ cardId, targetMandalaId, source }: MoveCardToMandalaVars) => {
      const headers = await getAuthHeaders();

      if (source === 'synced') {
        const url = getEdgeFunctionUrl('youtube-sync', 'batch-update-video-state');
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            updates: [
              {
                videoStateId: cardId,
                updates: { mandala_id: targetMandalaId },
              },
            ],
          }),
        });
        if (!response.ok) {
          throw new Error('Failed to move synced card');
        }
      } else if (source === 'local') {
        const url = getEdgeFunctionUrl('local-cards', 'update');
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            id: cardId,
            mandala_id: targetMandalaId,
          }),
        });
        if (!response.ok) {
          throw new Error('Failed to move local card');
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['youtube', 'all-video-states'] });
      queryClient.invalidateQueries({ queryKey: ['local-cards', 'list'] });
    },
  });
}
