/**
 * useLocalCards Hook
 *
 * Manages locally added scratchpad cards (URL paste, D&D)
 * stored in Supabase separately from YouTube synced videos.
 */

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { getAuthHeaders, getEdgeFunctionUrl } from '@/lib/supabase-auth';
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
import { queryKeys } from '@/lib/queryKeys';

// Re-export for backward compatibility
export const localCardsKeys = {
  all: queryKeys.localCards.all,
  list: (mandalaId?: string) => queryKeys.localCards.list(mandalaId),
  listPrefix: ['local-cards', 'list'] as const,
  subscription: () => queryKeys.localCards.subscription,
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
 * When mandalaId is provided, filters to only that mandala's cards.
 */
export function useLocalCardsList(mandalaId?: string) {
  return useQuery({
    queryKey: localCardsKeys.list(mandalaId),
    queryFn: async (): Promise<LocalCardsResponse> => {
      const headers = await getAuthHeaders();
      let url = localCardsUrl('list');
      if (mandalaId) {
        url += `&mandala_id=${encodeURIComponent(mandalaId)}`;
      }
      const response = await fetch(url, { headers });

      if (!response.ok) {
        throw new Error('Failed to get local cards');
      }

      return response.json();
    },
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
    onMutate: async (payload: AddLocalCardPayload) => {
      await queryClient.cancelQueries({ queryKey: localCardsKeys.listPrefix });
      const previousCaches = new Map<readonly unknown[], LocalCardsResponse | undefined>();
      queryClient
        .getQueriesData<LocalCardsResponse>({ queryKey: localCardsKeys.listPrefix })
        .forEach(([key, data]) => {
          previousCaches.set(key, data);
          if (data) {
            const tempCard: LocalCard = {
              id: `temp-${Date.now()}`,
              user_id: '',
              url: payload.url,
              title: payload.title ?? null,
              thumbnail: payload.thumbnail ?? null,
              link_type: payload.link_type,
              user_note: payload.user_note ?? null,
              metadata_title: payload.metadata_title ?? null,
              metadata_description: payload.metadata_description ?? null,
              metadata_image: payload.metadata_image ?? null,
              cell_index: payload.cell_index ?? -1,
              level_id: payload.level_id || 'scratchpad',
              mandala_id: payload.mandala_id ?? null,
              sort_order: payload.sort_order ?? null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            queryClient.setQueryData<LocalCardsResponse>(key, {
              ...data,
              cards: [...data.cards, tempCard],
              subscription: { ...data.subscription, used: data.subscription.used + 1 },
            });
          }
        });

      return { previousCaches };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousCaches) {
        context.previousCaches.forEach((data, key) => {
          if (data) queryClient.setQueryData(key, data);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: localCardsKeys.listPrefix });
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
      await queryClient.cancelQueries({ queryKey: localCardsKeys.listPrefix });
      const previousCaches = new Map<readonly unknown[], LocalCardsResponse | undefined>();
      queryClient
        .getQueriesData<LocalCardsResponse>({ queryKey: localCardsKeys.listPrefix })
        .forEach(([key, data]) => {
          previousCaches.set(key, data);
          if (data) {
            queryClient.setQueryData<LocalCardsResponse>(key, {
              ...data,
              cards: data.cards.map((card) =>
                card.id === payload.id ? { ...card, ...payload } : card
              ),
            });
          }
        });

      return { previousCaches };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousCaches) {
        context.previousCaches.forEach((data, key) => {
          if (data) queryClient.setQueryData(key, data);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: localCardsKeys.listPrefix });
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
      await queryClient.cancelQueries({ queryKey: localCardsKeys.listPrefix });
      const previousCaches = new Map<readonly unknown[], LocalCardsResponse | undefined>();
      queryClient
        .getQueriesData<LocalCardsResponse>({ queryKey: localCardsKeys.listPrefix })
        .forEach(([key, data]) => {
          previousCaches.set(key, data);
          if (data) {
            queryClient.setQueryData<LocalCardsResponse>(key, {
              ...data,
              cards: data.cards.filter((card) => card.id !== cardId),
              subscription: {
                ...data.subscription,
                used: Math.max(0, data.subscription.used - 1),
              },
            });
          }
        });

      return { previousCaches };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousCaches) {
        context.previousCaches.forEach((data, key) => {
          if (data) queryClient.setQueryData(key, data);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: localCardsKeys.listPrefix });
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
