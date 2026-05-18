/**
 * Add Cards result list (CP466 amendment 8).
 *
 * Pure presentation component:
 *   - 3-col grid of candidate cards
 *   - Bookmark click → onPick callback (parent owns mutation state)
 *   - Border on hover only (user directive 2026-05-18)
 *   - Picked cards render disabled with filled Bookmark
 *
 * Branch ordering: isLoading → isError → !hasSearched → empty → grid.
 *
 * Spec: docs/design/add-cards-2026-05-18.md §6.
 */

import { useTranslation } from 'react-i18next';
import { AlertCircle, Bookmark, Loader2, RotateCw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import type { AddCardCandidate } from '../model/useAddCards';

interface AddCardsListProps {
  cards: AddCardCandidate[];
  isLoading: boolean;
  hasSearched: boolean;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  pickedSet: ReadonlySet<string>;
  /** Disables the Bookmark on every card while any pick mutation is in
   *  flight. Owned by the parent so a single mutation instance can be
   *  shared / inspected. */
  isPickPending: boolean;
  onPick: (videoId: string, title: string) => void;
}

export function AddCardsList({
  cards,
  isLoading,
  hasSearched,
  isError = false,
  errorMessage,
  onRetry,
  pickedSet,
  isPickPending,
  onPick,
}: AddCardsListProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

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

  if (!hasSearched) {
    return (
      <div className="flex items-center justify-center py-16 text-[13px] text-muted-foreground text-center px-6">
        {t('addCards.panel.idle', 'Choose keywords and filters, then press Search.')}
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-[13px] text-muted-foreground text-center px-6">
        {t('addCards.panel.empty', 'No matches yet. Please try again in a moment.')}
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-3 gap-2 px-3 py-2">
      {cards.map((card) => {
        const isPicked = pickedSet.has(card.videoId);
        return (
          <li
            key={card.videoId}
            className={cn(
              'group relative rounded-md overflow-hidden border bg-card transition-colors',
              'border-transparent hover:border-border',
              isPicked && 'opacity-50 pointer-events-none hover:border-transparent'
            )}
            aria-disabled={isPicked || undefined}
          >
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
              <button
                type="button"
                onClick={() => !isPicked && onPick(card.videoId, card.title)}
                disabled={isPickPending || isPicked}
                aria-pressed={isPicked}
                aria-label={
                  isPicked
                    ? t('addCards.actions.picked', 'Picked')
                    : t('addCards.actions.addOne', 'Add to mandala')
                }
                className={cn(
                  'absolute bottom-1 right-1 z-10 w-6 h-6 flex items-center justify-center transition-all duration-200 ease-out',
                  isPicked
                    ? 'opacity-100'
                    : 'opacity-0 group-hover:opacity-100 hover:scale-110 active:scale-95',
                  'disabled:cursor-not-allowed'
                )}
              >
                <Bookmark
                  className="w-[18px] h-[18px] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]"
                  fill={isPicked ? 'currentColor' : 'none'}
                  strokeWidth={2.2}
                  aria-hidden="true"
                />
              </button>
            </div>
            <div className="px-1.5 py-1 space-y-0">
              <h4 className="text-[11px] font-medium line-clamp-2 leading-snug">{card.title}</h4>
              {card.channel && (
                <p className="text-[9.5px] text-muted-foreground line-clamp-1">{card.channel}</p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
