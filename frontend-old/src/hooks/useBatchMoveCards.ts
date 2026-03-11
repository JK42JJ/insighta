/**
 * useBatchMoveCards Hook
 *
 * Batches card move operations into at most 2 HTTP requests:
 * - synced cards → batch-update-video-state
 * - local + pending cards → batch-move
 *
 * Optimistic updates via onMutate → RQ cache is the single source of truth.
 * Rollback on error, invalidateQueries on settled for server reconciliation.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthHeaders, getEdgeFunctionUrl } from '@/lib/supabase-auth';
import { localCardsKeys } from './useLocalCards';
import type { InsightCard } from '@/types/mandala';
import type { LocalCardsResponse } from '@/types/local-cards';
import type { UserVideoStateWithVideo } from '@/types/youtube';
import { type CardSource } from '@/lib/cardUtils';

interface BatchMoveItem {
  card: InsightCard;
  source: CardSource;
  cellIndex: number;
  levelId: string;
}

interface BatchMoveParams {
  items: BatchMoveItem[];
}

export function useBatchMoveCards() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ items }: BatchMoveParams) => {
      const headers = await getAuthHeaders();

      const syncedItems = items.filter((i) => i.source === 'synced');
      const localItems = items.filter((i) => i.source === 'local');
      const pendingItems = items.filter((i) => i.source === 'pending');

      const promises: Promise<unknown>[] = [];

      // Batch 1: synced cards → youtube-sync batch-update-video-state
      if (syncedItems.length > 0) {
        promises.push(
          fetch(getEdgeFunctionUrl('youtube-sync', 'batch-update-video-state'), {
            method: 'POST',
            headers,
            body: JSON.stringify({
              updates: syncedItems.map((item) => ({
                videoStateId: item.card.id,
                updates: {
                  is_in_ideation: item.levelId === 'scratchpad',
                  cell_index: item.cellIndex,
                  level_id: item.levelId,
                },
              })),
            }),
          }).then(async (res) => {
            if (!res.ok) {
              const err = await res.json();
              throw new Error(err.error || 'batch-update-video-state failed');
            }
            return res.json();
          })
        );
      }

      // Batch 2: local + pending cards → local-cards batch-move
      if (localItems.length > 0 || pendingItems.length > 0) {
        promises.push(
          fetch(getEdgeFunctionUrl('local-cards', 'batch-move'), {
            method: 'POST',
            headers,
            body: JSON.stringify({
              updates: localItems.map((item) => ({
                id: item.card.id,
                cell_index: item.cellIndex,
                level_id: item.levelId,
              })),
              inserts: pendingItems.map((item) => ({
                url: item.card.videoUrl,
                title: item.card.title,
                thumbnail: item.card.thumbnail,
                link_type: item.card.linkType || 'other',
                user_note: item.card.userNote,
                cell_index: item.cellIndex,
                level_id: item.levelId,
              })),
            }),
          }).then(async (res) => {
            if (!res.ok) {
              const err = await res.json();
              throw new Error(err.error || 'batch-move failed');
            }
            return res.json();
          })
        );
      }

      await Promise.all(promises);
    },

    onMutate: async ({ items }) => {
      const videoPrefix = ['youtube', 'all-video-states'];
      // Cancel in-flight queries to prevent overwriting optimistic updates
      await Promise.all([
        queryClient.cancelQueries({ queryKey: localCardsKeys.listPrefix }),
        queryClient.cancelQueries({ queryKey: videoPrefix }),
      ]);

      // Snapshot all matching caches for rollback
      const previousLocalCaches = new Map<readonly unknown[], LocalCardsResponse | undefined>();
      queryClient
        .getQueriesData<LocalCardsResponse>({ queryKey: localCardsKeys.listPrefix })
        .forEach(([key, data]) => previousLocalCaches.set(key, data));

      const previousVideoCaches = new Map<
        readonly unknown[],
        UserVideoStateWithVideo[] | undefined
      >();
      queryClient
        .getQueriesData<UserVideoStateWithVideo[]>({ queryKey: videoPrefix })
        .forEach(([key, data]) => previousVideoCaches.set(key, data));

      // Optimistic: update local cards caches (position changes)
      const localItems = items.filter((i) => i.source === 'local');
      if (localItems.length > 0) {
        const movedIds = new Set(localItems.map((i) => i.card.id));
        previousLocalCaches.forEach((_data, key) => {
          queryClient.setQueryData<LocalCardsResponse>(key, (prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              cards: prev.cards.map((card) => {
                if (movedIds.has(card.id)) {
                  const item = localItems.find((i) => i.card.id === card.id);
                  if (!item) return card;
                  return { ...card, cell_index: item.cellIndex, level_id: item.levelId };
                }
                return card;
              }),
            };
          });
        });
      }

      // Optimistic: update allVideoStates caches (synced card positions)
      const syncedItems = items.filter((i) => i.source === 'synced');
      if (syncedItems.length > 0) {
        previousVideoCaches.forEach((_data, key) => {
          queryClient.setQueryData<UserVideoStateWithVideo[]>(key, (prev) =>
            prev?.map((v) => {
              const moved = syncedItems.find((i) => i.card.id === v.id);
              if (moved) {
                return {
                  ...v,
                  is_in_ideation: moved.levelId === 'scratchpad',
                  cell_index: moved.cellIndex,
                  level_id: moved.levelId,
                };
              }
              return v;
            })
          );
        });
      }

      // Optimistic: add pending cards to local cards caches (will be inserted by API)
      const pendingItems = items.filter((i) => i.source === 'pending');
      if (pendingItems.length > 0) {
        previousLocalCaches.forEach((_data, key) => {
          queryClient.setQueryData<LocalCardsResponse>(key, (prev) => {
            if (!prev) return prev;
            const newCards = pendingItems.map((item) => ({
              id: item.card.id,
              user_id: '',
              url: item.card.videoUrl,
              title: item.card.title,
              thumbnail: item.card.thumbnail,
              link_type: (item.card.linkType || 'other') as import('@/types/mandala').LinkType,
              user_note: item.card.userNote || null,
              metadata_title: item.card.metadata?.title || null,
              metadata_description: item.card.metadata?.description || null,
              metadata_image: item.card.metadata?.image || null,
              cell_index: item.cellIndex,
              level_id: item.levelId,
              mandala_id: null,
              sort_order: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }));
            return {
              ...prev,
              cards: [...prev.cards, ...newCards],
            };
          });
        });
      }

      return { previousLocalCaches, previousVideoCaches };
    },

    onError: (err, _vars, context) => {
      console.error('[batchMoveCards] mutation error:', err);
      // Rollback to snapshots
      if (context?.previousLocalCaches) {
        context.previousLocalCaches.forEach((data, key) => {
          if (data) queryClient.setQueryData(key, data);
        });
      }
      if (context?.previousVideoCaches) {
        context.previousVideoCaches.forEach((data, key) => {
          if (data) queryClient.setQueryData(key, data);
        });
      }
    },

    onSettled: () => {
      // Server reconciliation — replace stale optimistic data with real server state
      queryClient.invalidateQueries({ queryKey: localCardsKeys.listPrefix });
      queryClient.invalidateQueries({ queryKey: ['youtube', 'all-video-states'] });
    },
  });
}
