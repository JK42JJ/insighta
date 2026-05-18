/**
 * Add Cards result list (CP466 amendment 9).
 *
 * Pure presentation component. Card-wide click target — user directive
 * 2026-05-18 "북마크 아이콘 클릭해야 → 카드 전체가 클릭 대상". Each
 * card `<li>` is the single accessible button (role=button + tabIndex
 * + onClick + Enter/Space keydown, mirroring SidebarMandalaSection
 * pattern). Bookmark icon downgrades to a decorative indicator (was a
 * nested <button>; nested buttons are invalid HTML and double-fired
 * on bubble).
 *
 * Picked visual strengthened — user directive 2026-05-18 "선택 시
 * 구별이 잘 안됨". Layered cue:
 *   - thumbnail dimmed via overlay (bg-black/55)
 *   - centered Check badge (large, white on emerald-500 circle)
 *   - filled Bookmark stays in the corner for state continuity
 *   - card border + opacity dropped to make the overlay the focal point
 *
 * Bezel — user directive 2026-05-18 "카드가 꽉차서 답답함, 좌/우 베젤
 * 확보". ul padding bumped (px-3 → px-4, py-2 → py-3) + gap-2 → gap-3.
 *
 * Spec: docs/design/add-cards-2026-05-18.md §6.
 */

import { useTranslation } from 'react-i18next';
import { AlertCircle, Bookmark, Check, Loader2, RotateCw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { formatRelativeDate } from '@/shared/lib/format-date';
import { formatDuration, formatViewCount } from '@/shared/lib/format-number';
import { handleThumbnailError, handleThumbnailLoad } from '@/shared/lib/image-utils';
import type { AddCardCandidate } from '../model/useAddCards';

interface AddCardsListProps {
  cards: AddCardCandidate[];
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
    <ul className="grid grid-cols-3 gap-3 px-5 py-3 sm:px-6">
      {cards.map((card) => {
        const isPicked = pickedSet.has(card.videoId);
        const disabled = isPicked || isPickPending;
        const labelKey = isPicked ? 'addCards.actions.picked' : 'addCards.actions.addOne';
        const labelDefault = isPicked ? 'Picked' : 'Add to mandala';
        return (
          <li
            key={card.videoId}
            role="button"
            tabIndex={isPicked ? -1 : 0}
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
              !isPicked && 'cursor-pointer hover:border-border focus-visible:border-border',
              isPicked && 'cursor-default',
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

              {/* Picked overlay — strong layered cue (post-click). */}
              {isPicked && (
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
              )}

              {/* Bookmark indicator — picked cards only. Unpicked
                  cards rely on the hover preview overlay above. */}
              {isPicked && (
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
      })}
    </ul>
  );
}

// Compact meta row under the channel — view count · duration · age.
// Mirrors InsightCardItemV2's footer fields but tighter (3-col panel
// grid is narrow). Skips parts that are null/missing so a card with
// only one signal still reads cleanly.
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
