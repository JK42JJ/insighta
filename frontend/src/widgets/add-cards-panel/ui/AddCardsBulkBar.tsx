/**
 * Add Cards bulk add bar (CP466).
 *
 * Sticky bottom bar shown when selectedIds.size > 0. Click → bulk
 * `POST /cards/:videoId/like` for each selected videoId (mandalaId
 * passed so v2 enrichment fires per card per spec).
 *
 * Spec: docs/design/add-cards-2026-05-18.md §6 (bulk add row).
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useLikeCard } from '@/features/card-management/model/useLikeCard';
import { useAddCardsPanelStore } from '../model/useAddCardsPanelStore';
import type { AddCardCandidate } from '../model/useAddCards';

interface AddCardsBulkBarProps {
  cards: AddCardCandidate[];
  mandalaId: string;
}

export function AddCardsBulkBar({ cards, mandalaId }: AddCardsBulkBarProps) {
  const { t } = useTranslation();
  const selectedIds = useAddCardsPanelStore((s) => s.selectedIds);
  const clearSelected = useAddCardsPanelStore((s) => s.clearSelected);
  const { like } = useLikeCard();

  const handleBulkAdd = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const selected = cards.filter((c) => selectedIds.has(c.videoId));
    let success = 0;
    let failed = 0;
    // Sequential to avoid hammering the BE; pg-boss enqueue is cheap but
    // we keep ordering predictable (animation may be added later).
    for (const card of selected) {
      try {
        await like.mutateAsync({ videoId: card.videoId, mandalaId, title: card.title });
        success += 1;
      } catch {
        failed += 1;
      }
    }
    if (success > 0) {
      toast.success(
        t('addCards.toast.addedMany', { count: success, defaultValue: '{{count}} cards added.' })
      );
    }
    if (failed > 0) {
      toast.error(
        t('addCards.toast.partialFailed', {
          count: failed,
          defaultValue: '{{count}} cards failed.',
        })
      );
    }
    clearSelected();
  }, [cards, clearSelected, like, mandalaId, selectedIds, t]);

  if (selectedIds.size === 0) return null;

  return (
    <div className="sticky bottom-0 left-0 right-0 z-10 px-4 py-3 border-t border-border/40 bg-background/95 backdrop-blur-sm">
      <button
        type="button"
        onClick={handleBulkAdd}
        disabled={like.isPending}
        className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-full bg-primary text-primary-foreground text-[13px] font-medium transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {like.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        <span>
          {t('addCards.actions.addMany', {
            count: selectedIds.size,
            defaultValue: 'Add {{count}} cards',
          })}
        </span>
      </button>
    </div>
  );
}
