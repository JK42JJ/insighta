/**
 * useLocalCards Hook
 *
 * Manages locally added scratchpad cards (URL paste, D&D)
 * stored in Supabase separately from YouTube synced videos.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  LocalCard,
  LocalCardsResponse,
  AddLocalCardPayload,
  UpdateLocalCardPayload,
  UserSubscription,
  LimitExceededError,
} from '@/types/local-cards';
import type { InsightCard } from '@/types/mandala';
import { localCardToInsightCard, insightCardToAddPayload } from '@/types/local-cards';

// Query Keys
export const localCardsKeys = {
  all: ['local-cards'] as const,
  list: () => [...localCardsKeys.all, 'list'] as const,
  subscription: () => [...localCardsKeys.all, 'subscription'] as const,
};

// Edge Function URL helper
function getEdgeFunctionUrl(action: string): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  return `${supabaseUrl}/functions/v1/local-cards?action=${action}`;
}

// Get auth headers (includes apikey for Kong API Gateway)
async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }
  const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  return {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
    'apikey': apiKey,
  };
}

/**
 * Check if error is a limit exceeded error
 */
export function isLimitExceededError(error: unknown): error is LimitExceededError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'error' in error &&
    (error as LimitExceededError).error === 'LIMIT_EXCEEDED'
  );
}

/**
 * Hook to list all local cards with subscription info
 */
export function useLocalCardsList() {
  return useQuery({
    queryKey: localCardsKeys.list(),
    queryFn: async (): Promise<LocalCardsResponse> => {
      const headers = await getAuthHeaders();
      const response = await fetch(getEdgeFunctionUrl('list'), { headers });

      if (!response.ok) {
        throw new Error('Failed to get local cards');
      }

      return response.json();
    },
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook to get local cards as InsightCard format
 */
export function useLocalCardsAsInsight() {
  const query = useLocalCardsList();

  return {
    ...query,
    cards: query.data?.cards.map(localCardToInsightCard) ?? [],
    subscription: query.data?.subscription ?? { tier: 'free', limit: 10, used: 0 },
  };
}

/**
 * Hook to add a new local card
 */
export function useAddLocalCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: AddLocalCardPayload): Promise<LocalCard> => {
      const headers = await getAuthHeaders();
      const response = await fetch(getEdgeFunctionUrl('add'), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        if (error.error === 'LIMIT_EXCEEDED') {
          throw error as LimitExceededError;
        }
        throw new Error(error.error || 'Failed to add local card');
      }

      const data = await response.json();
      return data.card;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: localCardsKeys.list() });
    },
  });
}

/**
 * Hook to add an InsightCard as a local card
 */
export function useAddLocalCardFromInsight() {
  const addLocalCard = useAddLocalCard();

  return useMutation({
    mutationFn: async (card: InsightCard): Promise<LocalCard> => {
      const payload = insightCardToAddPayload(card);
      return addLocalCard.mutateAsync(payload);
    },
    onSuccess: addLocalCard.onSuccess,
    onError: addLocalCard.onError,
  });
}

/**
 * Hook to update a local card
 */
export function useUpdateLocalCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpdateLocalCardPayload): Promise<LocalCard> => {
      const headers = await getAuthHeaders();
      const response = await fetch(getEdgeFunctionUrl('update'), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update local card');
      }

      const data = await response.json();

      // ✨ 디버깅: 반환된 데이터 검증
      console.log('[useUpdateLocalCard] Server response:', {
        requestPayload: payload,
        returnedCard: {
          id: data.card.id,
          cell_index: data.card.cell_index,
          level_id: data.card.level_id,
        },
      });

      // 업데이트가 실제로 반영되었는지 확인
      if (payload.cell_index !== undefined && data.card.cell_index !== payload.cell_index) {
        console.error('[useUpdateLocalCard] ⚠️ cell_index MISMATCH:', {
          requested: payload.cell_index,
          returned: data.card.cell_index,
        });
      }
      if (payload.level_id !== undefined && data.card.level_id !== payload.level_id) {
        console.error('[useUpdateLocalCard] ⚠️ level_id MISMATCH:', {
          requested: payload.level_id,
          returned: data.card.level_id,
        });
      }

      return data.card;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: localCardsKeys.list() });
    },
  });
}

/**
 * Hook to delete a local card
 */
export function useDeleteLocalCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (cardId: string): Promise<void> => {
      const headers = await getAuthHeaders();
      const response = await fetch(getEdgeFunctionUrl('delete'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: cardId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete local card');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: localCardsKeys.list() });
    },
  });
}

/**
 * Combined hook for local cards operations
 */
export function useLocalCards() {
  const listQuery = useLocalCardsAsInsight();
  const addCard = useAddLocalCard();
  const addFromInsight = useAddLocalCardFromInsight();
  const updateCard = useUpdateLocalCard();
  const deleteCard = useDeleteLocalCard();

  return {
    // Data
    cards: listQuery.cards,
    subscription: listQuery.subscription,

    // Loading states
    isLoading: listQuery.isLoading,
    isAdding: addCard.isPending,
    isUpdating: updateCard.isPending,
    isDeleting: deleteCard.isPending,

    // Error states
    error: listQuery.error || addCard.error || updateCard.error || deleteCard.error,

    // Limit check
    canAddCard: listQuery.subscription.used < listQuery.subscription.limit,
    remainingSlots: listQuery.subscription.limit - listQuery.subscription.used,

    // Actions
    addCard: addCard.mutateAsync,
    addCardFromInsight: addFromInsight.mutateAsync,
    updateCard: updateCard.mutateAsync,
    deleteCard: deleteCard.mutateAsync,
    refetch: listQuery.refetch,

    // Error handling
    isLimitExceededError,
  };
}
