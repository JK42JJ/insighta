/**
 * useLocalCards Hook
 *
 * Manages locally added scratchpad cards (URL paste, D&D)
 * stored in Supabase separately from YouTube synced videos.
 */

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { getAuthHeaders, getEdgeFunctionUrl } from '@/shared/lib/supabase-auth';

import type {
  LocalCard,
  LocalCardsResponse,
  AddLocalCardPayload,
  UpdateLocalCardPayload,
  UserSubscription,
  LimitExceededError,
} from '@/entities/card/model/local-cards';
import type { InsightCard } from '@/entities/card/model/types';
import { localCardToInsightCard, insightCardToAddPayload } from '@/entities/card/model/local-cards';
import { DEFAULT_CARD_LIMIT } from '@/shared/config/subscription-tiers';

// Query Keys
export const localCardsKeys = {
  all: ['local-cards'] as const,
  list: () => [...localCardsKeys.all, 'list'] as const,
  subscription: () => [...localCardsKeys.all, 'subscription'] as const,
};

// Shorthand for local-cards Edge Function URLs
function localCardsUrl(action: string): string {
  return getEdgeFunctionUrl('local-cards', action);
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
      const response = await fetch(localCardsUrl('list'), { headers });

      if (!response.ok) {
        throw new Error('Failed to get local cards');
      }

      return response.json();
    },
    staleTime: 30 * 1000, // 30 seconds
    placeholderData: keepPreviousData,
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
    subscription: query.data?.subscription ?? { tier: 'free', limit: DEFAULT_CARD_LIMIT, used: 0 },
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
      const response = await fetch(localCardsUrl('add'), {
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
    onSettled: () => {
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
      const response = await fetch(localCardsUrl('update'), {
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

      // Optimistic update for ALL changes including position
      if (previous) {
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
    onSettled: () => {
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
      const response = await fetch(localCardsUrl('delete'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: cardId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete local card');
      }
    },
    onMutate: async (cardId: string) => {
      await queryClient.cancelQueries({ queryKey: localCardsKeys.list() });
      const previous = queryClient.getQueryData<LocalCardsResponse>(localCardsKeys.list());

      if (previous) {
        queryClient.setQueryData<LocalCardsResponse>(localCardsKeys.list(), {
          ...previous,
          cards: previous.cards.filter((card) => card.id !== cardId),
          subscription: {
            ...previous.subscription,
            used: Math.max(0, previous.subscription.used - 1),
          },
        });
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(localCardsKeys.list(), context.previous);
      }
    },
    onSettled: () => {
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
