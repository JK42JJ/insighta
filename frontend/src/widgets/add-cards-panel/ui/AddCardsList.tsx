/**
 * Add Cards result list (CP466).
 *
 * Renders up to 40 candidate cards in a 2-col grid, with a checkbox
 * for multi-select bulk add and a Bookmark icon for single-Pick.
 * Single-Pick fires `useLikeCard` (existing endpoint, signal=like).
 *
 * Spec: docs/design/add-cards-2026-05-18.md §6.
 */

import { useTranslation } from 'react-i18next';
import { AlertCircle, Bookmark, Loader2, RotateCw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useLikeCard } from '@/features/card-management/model/useLikeCard';
import { useAddCardsPanelStore } from '../model/useAddCardsPanelStore';
import type { AddCardCandidate } from '../model/useAddCards';

interface AddCardsListProps {
  cards: AddCardCandidate[];
  mandalaId: string;
  isLoading: boolean;
  hasSearched: boolean;
  /** CP466 amendment 5 — error surface so the user sees fetch failures
   *  instead of an indistinguishable empty state. */
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
}

export function AddCardsList({
  cards,
  mandalaId,
  isLoading,
  hasSearched,
  isError = false,
  errorMessage,
  onRetry,
}: AddCardsListProps) {
  const { t } = useTranslation();
  const selectedIds = useAddCardsPanelStore((s) => s.selectedIds);
  const toggleSelected = useAddCardsPanelStore((s) => s.toggleSelected);
  const { like } = useLikeCard();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // CP466 amendment 5 — error state distinct from empty/idle so the
  // user can distinguish "search failed" from "no results".
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 gap-3 text-center">
        <AlertCircle className="h-5 w-5 text-destructive" aria-hidden="true" />
        <p className="text-[13px] text-foreground">
          {t('addCards.panel.searchFailed', 'Search failed. Please try again.')}
        </p>
        {errorMessage && (
          <p className="text-[11px] text-muted-foreground line-clamp-2">{errorMessage}</p>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 h-8 rounded-full border border-border/60 px-3 text-[12px] font-medium hover:bg-foreground/[0.04] transition-colors"
          >
            <RotateCw className="h-3.5 w-3.5" strokeWidth={2.2} />
            <span>{t('common.retry', 'Retry')}</span>
          </button>
        )}
      </div>
    );
  }

  // CP466 amendment 3 — idle state shown before the user has clicked
  // Search even once (auto-fetch removed).
  if (!hasSearched) {
    return (
      <div className="flex items-center justify-center py-16 text-[13px] text-muted-foreground text-center px-6">
        {t('addCards.panel.idle', 'Choose keywords and filters, then press Search.')}
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-[13px] text-muted-foreground">
        {t('addCards.panel.empty', 'No cards found.')}
      </div>
    );
  }

  const handlePickSingle = (videoId: string, title: string) => {
    like.mutate({ videoId, mandalaId, title });
  };

  return (
    <ul className="grid grid-cols-2 gap-3 px-4 py-3 overflow-y-auto scrollbar-pro">
      {cards.map((card) => {
        const isSelected = selectedIds.has(card.videoId);
        return (
          <li
            key={card.videoId}
            className={cn(
              'group relative rounded-lg overflow-hidden border bg-card transition-colors',
              isSelected
                ? 'border-primary ring-2 ring-primary/40'
                : 'border-border/50 hover:border-border'
            )}
          >
            {/* thumbnail */}
            <div className="relative aspect-video bg-muted">
              {card.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={card.thumbnail}
                  alt={card.title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              )}
              {/* TL checkbox */}
              <label className="absolute top-1.5 left-1.5 z-10 flex items-center justify-center w-5 h-5 rounded bg-black/50 backdrop-blur-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelected(card.videoId)}
                  className="h-3.5 w-3.5 accent-primary cursor-pointer"
                  aria-label={t('addCards.panel.selectCard', { defaultValue: 'Select card' })}
                />
              </label>
              {/* BR Pick (single) */}
              <button
                type="button"
                onClick={() => handlePickSingle(card.videoId, card.title)}
                disabled={like.isPending}
                className="absolute bottom-1.5 right-1.5 z-10 w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 ease-out hover:scale-125 hover:rotate-6 active:scale-95 disabled:opacity-50"
                aria-label={t('addCards.actions.addOne', 'Add to mandala')}
              >
                <Bookmark
                  className="w-[22px] h-[22px] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]"
                  fill="none"
                  strokeWidth={2.2}
                  aria-hidden="true"
                />
              </button>
            </div>
            {/* footer */}
            <div className="px-2 py-1.5 space-y-0.5">
              <h4 className="text-[12px] font-medium line-clamp-2 leading-snug">{card.title}</h4>
              {card.channel && (
                <p className="text-[10px] text-muted-foreground line-clamp-1">{card.channel}</p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
