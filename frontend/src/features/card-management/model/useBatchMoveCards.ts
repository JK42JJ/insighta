/**
 * useBatchMoveCards Hook
 *
 * Batches card move operations into at most 2 HTTP requests:
 * - synced cards -> batch-update-video-state
 * - local + pending cards -> batch-move
 *
 * Optimistic updates via onMutate -> RQ cache is the single source of truth.
 * Rollback on error, invalidateQueries on settled for server reconciliation.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthHeaders, getEdgeFunctionUrl } from '@/shared/lib/supabase-auth';
import { localCardsKeys } from './useLocalCards';
import { youtubeSyncKeys } from '@/features/youtube-sync/model/useYouTubeSync';
import type { InsightCard, LinkType } from '@/entities/card/model/types';
import type { LocalCardsResponse } from '@/entities/card/model/local-cards';
import type { UserVideoStateWithVideo } from '@/entities/youtube/model/types';
import { type CardSource } from '../lib/cardUtils';

interface BatchMoveItem {
  card: InsightCard;
  source: CardSource;
  cellIndex: number;
  levelId: string;
  mandalaId?: string | null;
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

      // Batch 1: synced cards -> youtube-sync batch-update-video-state
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
                  mandala_id: item.mandalaId ?? null,
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

      // Batch 2: local + pending cards -> local-cards batch-move
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
                mandala_id: item.mandalaId ?? null,
              })),
              inserts: pendingItems.map((item) => ({
                url: item.card.videoUrl,
                title: item.card.title,
                thumbnail: item.card.thumbnail,
                link_type: item.card.linkType || 'other',
                user_note: item.card.userNote,
                cell_index: item.cellIndex,
                level_id: item.levelId,
                mandala_id: item.mandalaId ?? null,
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
      // Cancel in-flight queries to prevent overwriting optimistic updates
      await Promise.all([
        queryClient.cancelQueries({ queryKey: localCardsKeys.list() }),
        queryClient.cancelQueries({ queryKey: youtubeSyncKeys.allVideoStates }),
      ]);

      // Snapshot for rollback
      const previousLocal = queryClient.getQueryData<LocalCardsResponse>(localCardsKeys.list());
      const previousVideo = queryClient.getQueryData<UserVideoStateWithVideo[]>(
        youtubeSyncKeys.allVideoStates
      );

      // Optimistic: update local cards cache (position changes)
      const localItems = items.filter((i) => i.source === 'local');
      if (localItems.length > 0) {
        queryClient.setQueryData<LocalCardsResponse>(localCardsKeys.list(), (prev) => {
          if (!prev) return prev;
          const movedIds = new Set(localItems.map((i) => i.card.id));
          return {
            ...prev,
            cards: prev.cards.map((card) => {
              if (movedIds.has(card.id)) {
                const item = localItems.find((i) => i.card.id === card.id);
                if (!item) return card;
                return {
                  ...card,
                  cell_index: item.cellIndex,
                  level_id: item.levelId,
                  mandala_id: item.mandalaId ?? null,
                };
              }
              return card;
            }),
          };
        });
      }

      // Optimistic: update allVideoStates cache (synced card positions)
      const syncedItems = items.filter((i) => i.source === 'synced');
      if (syncedItems.length > 0) {
        queryClient.setQueryData<UserVideoStateWithVideo[]>(
          youtubeSyncKeys.allVideoStates,
          (prev) =>
            prev?.map((v) => {
              const moved = syncedItems.find((i) => i.card.id === v.id);
              if (moved) {
                return {
                  ...v,
                  is_in_ideation: moved.levelId === 'scratchpad',
                  cell_index: moved.cellIndex,
                  level_id: moved.levelId,
                  mandala_id: moved.mandalaId ?? null,
                };
              }
              return v;
            })
        );
      }

      // Optimistic: add pending cards to local cards cache (will be inserted by API)
      const pendingItems = items.filter((i) => i.source === 'pending');
      if (pendingItems.length > 0) {
        queryClient.setQueryData<LocalCardsResponse>(localCardsKeys.list(), (prev) => {
          if (!prev) return prev;
          const newCards = pendingItems.map((item) => ({
            id: item.card.id,
            user_id: '',
            url: item.card.videoUrl,
            title: item.card.title,
            thumbnail: item.card.thumbnail,
            link_type: (item.card.linkType || 'other') as LinkType,
            user_note: item.card.userNote || null,
            metadata_title: item.card.metadata?.title || null,
            metadata_description: item.card.metadata?.description || null,
            metadata_image: item.card.metadata?.image || null,
            cell_index: item.cellIndex,
            level_id: item.levelId,
            mandala_id: item.mandalaId ?? null,
            sort_order: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }));
          return {
            ...prev,
            cards: [...prev.cards, ...newCards],
          };
        });
      }

      return { previousLocal, previousVideo };
    },

    onError: (err, _vars, context) => {
      console.error('[batchMoveCards] mutation error:', err);
      // Rollback to snapshots
      if (context?.previousLocal) {
        queryClient.setQueryData(localCardsKeys.list(), context.previousLocal);
      }
      if (context?.previousVideo) {
        queryClient.setQueryData(youtubeSyncKeys.allVideoStates, context.previousVideo);
      }
    },

    onSettled: () => {
      // Server reconciliation — replace stale optimistic data with real server state
      queryClient.invalidateQueries({ queryKey: localCardsKeys.list() });
      queryClient.invalidateQueries({ queryKey: youtubeSyncKeys.allVideoStates });
    },
  });
}
