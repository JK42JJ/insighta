/**
 * useBatchMoveCards Hook
 *
 * Batches card move operations into at most 2 HTTP requests:
 * - synced cards → batch-update-video-state
 * - local + pending cards → batch-move
 *
 * No onMutate — caller handles optimistic UI via setState.
 * onSuccess reconciles pending cards with server-assigned IDs.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { localCardsKeys } from './useLocalCards';
import { youtubeSyncKeys } from './useYouTubeSync';
import type { InsightCard } from '@/types/mandala';
import type { LocalCardsResponse } from '@/types/local-cards';
import { detectCardSource, type CardSource } from '@/lib/cardUtils';

interface BatchMoveItem {
  card: InsightCard;
  source: CardSource;
  cellIndex: number;
  levelId: string;
}

interface BatchMoveParams {
  items: BatchMoveItem[];
}

function getEdgeFunctionUrl(fn: string, action: string): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  return `${supabaseUrl}/functions/v1/${fn}?action=${action}`;
}

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
    onSuccess: (_data, { items }) => {
      // 1. local-cards 캐시 직접 업데이트 (refetch 없이)
      queryClient.setQueryData<LocalCardsResponse>(localCardsKeys.list(), (prev) => {
        if (!prev) return prev;
        const movedIds = new Set(items.filter((i) => i.source === 'local').map((i) => i.card.id));
        return {
          ...prev,
          cards: prev.cards.map((card) => {
            if (movedIds.has(card.id)) {
              const item = items.find((i) => i.card.id === card.id)!;
              return { ...card, cell_index: item.cellIndex, level_id: item.levelId };
            }
            return card;
          }),
        };
      });

      // 2. 5초 후 백그라운드 리프레시 (데이터 정합성 보장, 시각적 영향 없음)
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: localCardsKeys.list() });
        queryClient.invalidateQueries({ queryKey: youtubeSyncKeys.ideationVideos });
      }, 5000);
    },
  });
}
