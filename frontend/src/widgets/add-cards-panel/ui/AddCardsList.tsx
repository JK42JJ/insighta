/**
 * Add Cards result list (CP466 amendment 9, CP489 Phase 4 rounds).
 *
 * Pure presentation component. Card-wide click target — user directive
 * 2026-05-18 "북마크 아이콘 클릭해야 → 카드 전체가 클릭 대상". Each
 * card `<li>` is the single accessible button (role=button + tabIndex
 * + onClick + Enter/Space keydown, mirroring SidebarMandalaSection
 * pattern). Bookmark icon downgrades to a decorative indicator (was a
 * nested <button>; nested buttons are invalid HTML and double-fired
 * on bubble).
 *
 * CP489 Phase 4 (#785): rounds[] shape replaces flat cards[]. Newest-
 * first; oldest entry labelled "1차 검색", every newer round above is
 * "N차 추가 검색" with a hairline separator and (count) badge. Each
 * round renders the same 3-col grid the previous flat layout used.
 *
 * Spec: docs/design/add-cards-2026-05-18.md §6 + issue #785.
 */

import { useTranslation } from 'react-i18next';
import { AlertCircle, Bookmark, Check, Loader2, RotateCw, X } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { formatRelativeDate } from '@/shared/lib/format-date';
import { formatDuration, formatViewCount } from '@/shared/lib/format-number';
import { handleThumbnailError, handleThumbnailLoad } from '@/shared/lib/image-utils';
import type { AddCardCandidate } from '../model/useAddCards';
import type { AddCardsRound } from '../lib/persistence';

interface AddCardsListProps {
  /**
   * Newest-first rounds. `rounds[0]` rendered at the top; the LAST entry
   * is labelled "1차 검색", everything above is "N차 추가 검색" where N
   * counts up from the bottom.
   */
  rounds: AddCardsRound[];
  isLoading: boolean;
  hasSearched: boolean;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  pickedSet: ReadonlySet<string>;
  isPickPending: boolean;
  onPick: (videoId: string, title: string) => void;
}

export function AddCardsList({
  rounds,
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
  const totalCards = rounds.reduce((n, r) => n + r.cards.length, 0);

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

  if (totalCards === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-[13px] text-muted-foreground text-center px-6">
        {t('addCards.panel.empty', 'No matches yet. Please try again in a moment.')}
      </div>
    );
  }

  // Total round count drives the per-round label. "1차 검색" is the
  // OLDEST entry (last in newest-first array); each newer round above
  // increments. With 3 rounds: rounds[0] = "3차 추가", rounds[1] =
  // "2차 추가", rounds[2] = "1차 검색".
  const totalRounds = rounds.length;

  return (
    <div className="flex flex-col">
      {rounds.map((round, idx) => {
        const roundNumber = totalRounds - idx;
        const isFirstRound = roundNumber === 1;
        const label = isFirstRound
          ? t('addCards.round.first', 'Round 1')
          : t('addCards.round.nth', 'Round {{n}} (more)', { n: roundNumber });
        return (
          <section key={round.id} aria-label={label}>
            <RoundSeparator label={label} foundCount={round.cards.length} roundAt={round.at} />
            <ul className="grid grid-cols-3 gap-3 px-5 py-3 sm:px-6">
              {round.cards.map((card) => (
                <CardItem
                  key={card.videoId}
                  card={card}
                  isPicked={pickedSet.has(card.videoId)}
                  isPickPending={isPickPending}
                  onPick={onPick}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function RoundSeparator({
  label,
  foundCount,
  roundAt,
}: {
  label: string;
  foundCount: number;
  roundAt: string;
}) {
  const { t } = useTranslation();
  const age = formatRelativeDate(roundAt);
  return (
    <div className="flex items-center gap-2 px-5 pt-3 pb-1 sm:px-6">
      <span className="h-px flex-1 bg-border/50" aria-hidden="true" />
      <span className="text-[11px] font-medium text-muted-foreground tracking-wide">
        {label}{' '}
        <span className="opacity-60">
          ({t('addCards.round.foundCount', '{{count}} new', { count: foundCount })})
        </span>
        {age && <span className="ml-1 opacity-50">· {age}</span>}
      </span>
      <span className="h-px flex-1 bg-border/50" aria-hidden="true" />
    </div>
  );
}

function CardItem({
  card,
  isPicked,
  isPickPending,
  onPick,
}: {
  card: AddCardCandidate;
  isPicked: boolean;
  isPickPending: boolean;
  onPick: (videoId: string, title: string) => void;
}) {
  const { t } = useTranslation();
  // CP480+ — picked cards are now clickable to unpick (idempotent
  // toggle). Only mid-flight requests are disabled.
  const disabled = isPickPending;
  const labelKey = isPicked ? 'addCards.actions.unpick' : 'addCards.actions.addOne';
  const labelDefault = isPicked ? 'Remove from mandala' : 'Add to mandala';
  return (
    <li
      role="button"
      tabIndex={0}
      aria-pressed={isPicked}
      aria-disabled={disabled || undefined}
      aria-label={`${t(labelKey, labelDefault)}: ${card.title}`}
      onClick={() => {
        if (disabled) return;
        onPick(card.videoId, card.title);
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick(card.videoId, card.title);
        }
      }}
      className={cn(
        'group relative rounded-md overflow-hidden border bg-card transition-colors',
        'border-transparent',
        !disabled && 'cursor-pointer hover:border-border focus-visible:border-border',
        disabled && 'cursor-wait',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30'
      )}
    >
      <div className="relative aspect-video bg-muted">
        {card.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.thumbnail}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            onError={handleThumbnailError}
            onLoad={handleThumbnailLoad}
          />
        )}

        {/* Hover preview (unpicked): uncolored mirror of the
            picked overlay so the click affordance is obvious. */}
        {!isPicked && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/35 backdrop-blur-[1px] gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 pointer-events-none"
            aria-hidden="true"
          >
            <span
              className={cn(
                'flex items-center justify-center w-9 h-9 rounded-full border-2 border-white/80 bg-black/20',
                'transition-transform duration-200 scale-90 group-hover:scale-100'
              )}
            >
              <Check className="w-5 h-5 text-white/80" strokeWidth={2.5} />
            </span>
            <span className="text-[10.5px] font-medium text-white/85 tracking-wide">
              {t('addCards.actions.addOne', 'Add to mandala')}
            </span>
          </div>
        )}

        {/* Picked overlay — post-click dim + center check. */}
        {isPicked && (
          <>
            <div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/55 backdrop-blur-[2px] gap-1"
              aria-hidden="true"
            >
              <span className="flex items-center justify-center w-9 h-9 rounded-full bg-emerald-500 shadow-lg">
                <Check className="w-5 h-5 text-white" strokeWidth={3} />
              </span>
              <span className="text-[10.5px] font-semibold text-white tracking-wide">
                {t('addCards.actions.picked', 'Picked')}
              </span>
            </div>

            <span
              className="absolute top-1 right-1 z-20 inline-flex items-center justify-center h-6 w-6 rounded-full bg-black/60 text-white shadow-md transition-colors group-hover:bg-white/25"
              aria-hidden="true"
            >
              <X className="w-3.5 h-3.5" strokeWidth={2.6} />
            </span>

            <span
              className="absolute bottom-1 right-1 z-10 w-6 h-6 flex items-center justify-center opacity-100"
              aria-hidden="true"
            >
              <Bookmark
                className="w-[18px] h-[18px] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]"
                fill="currentColor"
                strokeWidth={2.2}
              />
            </span>
          </>
        )}
      </div>
      <div className="px-1.5 py-1 space-y-0">
        <h4
          className={cn(
            'text-[11px] font-medium line-clamp-2 leading-snug',
            isPicked && 'text-muted-foreground'
          )}
        >
          {card.title}
        </h4>
        {card.channel && (
          <p className="text-[9.5px] text-muted-foreground line-clamp-1">{card.channel}</p>
        )}
        <CardMeta
          viewCount={card.viewCount}
          durationSec={card.durationSec}
          publishedAt={card.publishedAt}
        />
      </div>
    </li>
  );
}

// Compact meta row under the channel — view count · duration · age.
// Skips parts that are null/missing so a card with only one signal
// still reads cleanly.
function CardMeta({
  viewCount,
  durationSec,
  publishedAt,
}: {
  viewCount: number | null;
  durationSec: number | null;
  publishedAt: string | null;
}) {
  const views = formatViewCount(viewCount);
  const duration = formatDuration(durationSec);
  const age = formatRelativeDate(publishedAt);
  const parts = [views, duration, age].filter((s): s is string => !!s);
  if (parts.length === 0) return null;
  return (
    <p className="text-[9.5px] text-muted-foreground line-clamp-1 mt-0.5">{parts.join(' · ')}</p>
  );
}
