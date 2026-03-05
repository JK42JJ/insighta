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
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }
  const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
    apikey: apiKey,
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
    onSuccess: (newCard: LocalCard) => {
      queryClient.setQueryData<LocalCardsResponse>(localCardsKeys.list(), (prev) =>
        prev
          ? {
              ...prev,
              cards: [...prev.cards, newCard],
              subscription: { ...prev.subscription, used: prev.subscription.used + 1 },
            }
          : prev
      );
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
      return data.card;
    },
    onMutate: async (payload: UpdateLocalCardPayload) => {
      await queryClient.cancelQueries({ queryKey: localCardsKeys.list() });
      const previous = queryClient.getQueryData<LocalCardsResponse>(localCardsKeys.list());

      // 위치 변경(cell_index/level_id)은 이미 optimistic setState로 처리됨
      const isPositionChange = 'cell_index' in payload || 'level_id' in payload;
      if (previous && !isPositionChange) {
        queryClient.setQueryData<LocalCardsResponse>(localCardsKeys.list(), (prev) =>
          prev
            ? {
                ...prev,
                cards: prev.cards.map((card) =>
                  card.id === payload.id ? { ...card, ...payload } : card
                ),
              }
            : prev
        );
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(localCardsKeys.list(), context.previous);
      }
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
