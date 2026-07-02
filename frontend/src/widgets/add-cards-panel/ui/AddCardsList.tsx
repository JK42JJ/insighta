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

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Bookmark, Check, Loader2, RotateCw, X } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { decodeHtmlEntities } from '@/shared/lib/decode-html-entities';
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
  /** Controlled active tab (lifted to the panel so 초기화 can scope to the
   *  selected round). When omitted, the list self-manages (test back-compat). */
  activeRoundId?: string | null;
  onActiveRoundChange?: (id: string) => void;
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
  activeRoundId: controlledActiveId,
  onActiveRoundChange,
}: AddCardsListProps) {
  const { t } = useTranslation();
  const totalCards = rounds.reduce((n, r) => n + r.cards.length, 0);

  // Active tab follows the NEWEST round: initial mount and every newly
  // prepended round auto-activate rounds[0] (the user just searched — show
  // them their result); manual tab clicks win until the next new round.
  // Controlled from the panel when the props are provided (초기화 scoping).
  const newestRoundId = rounds[0]?.id ?? null;
  const [localActiveId, setLocalActiveId] = useState<string | null>(newestRoundId);
  useEffect(() => {
    setLocalActiveId(newestRoundId);
  }, [newestRoundId]);
  const activeRoundId = controlledActiveId !== undefined ? controlledActiveId : localActiveId;
  const setActiveRoundId = onActiveRoundChange ?? setLocalActiveId;
  const activeRound = rounds.find((r) => r.id === activeRoundId) ?? rounds[0] ?? null;

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

  // T2 (CP499+, James 확정 — 드롭 금지) — rounds are TABS, not a vertical
  // stack of separator sections: the cumulative model made users scroll past
  // every earlier round to reach the newest. One tab per round (newest first,
  // newest auto-active — including when a NEW round lands mid-session), only
  // the active round's grid renders. Label semantics unchanged: "1차 검색" is
  // the OLDEST entry (last in the newest-first array).
  const totalRounds = rounds.length;

  return (
    <div className="flex flex-col">
      {/* Sticky tab strip — stays pinned while the results scroll under it
          (2026-07-02 James: 칩이 스크롤에 말려 올라감). bg matches the panel
          surface so cards never bleed through. */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border/30">
        <div
          role="tablist"
          aria-label={t('addCards.round.tablist', 'Search rounds')}
          className="flex items-center gap-1.5 px-5 pt-3 pb-2 sm:px-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {rounds.map((round, idx) => {
            const roundNumber = totalRounds - idx;
            const label =
              roundNumber === 1
                ? t('addCards.round.first', 'Round 1')
                : t('addCards.round.nth', 'Round {{n}} (more)', { n: roundNumber });
            const isActive = round.id === activeRoundId;
            // Picked count per round (2026-07-02 James: 선택 수 병기).
            const pickedInRound = round.cards.reduce(
              (n, c) => n + (pickedSet.has(c.videoId) ? 1 : 0),
              0
            );
            return (
              <button
                key={round.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`add-cards-round-${round.id}`}
                onClick={() => setActiveRoundId(round.id)}
                className={cn(
                  'shrink-0 inline-flex items-center gap-1 h-7 rounded-full border px-3 text-[11.5px] font-medium transition-colors',
                  isActive
                    ? 'bg-foreground text-background border-foreground'
                    : 'bg-transparent text-foreground/80 border-border/50 hover:border-border hover:bg-foreground/[0.04]'
                )}
              >
                {label}
                <span className={cn('text-[10.5px]', isActive ? 'opacity-70' : 'opacity-50')}>
                  {pickedInRound > 0
                    ? `(${pickedInRound}/${round.cards.length})`
                    : `(${round.cards.length})`}
                </span>
              </button>
            );
          })}
        </div>
        {/* Applied-filter summary for the ACTIVE round (rounds searched after
            2026-07-02 carry a snapshot; older rounds show date only). */}
        {activeRound && (
          <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 px-5 pb-2 sm:px-6 text-[11px] text-muted-foreground">
            <span className="opacity-70">{formatRelativeDate(activeRound.at)}</span>
            {formatRoundFilters(activeRound.filters, t).map((part) => (
              <span
                key={part}
                className="inline-flex items-center rounded border border-border/40 bg-foreground/[0.03] px-1.5 py-px"
              >
                {part}
              </span>
            ))}
          </div>
        )}
      </div>
      {activeRound && (
        <section
          key={activeRound.id}
          id={`add-cards-round-${activeRound.id}`}
          role="tabpanel"
          aria-label={t('addCards.round.activePanel', 'Active round results')}
        >
          <ul className="grid grid-cols-2 md:grid-cols-3 gap-3 px-5 py-3 sm:px-6">
            {activeRound.cards.map((card) => (
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
      )}
    </div>
  );
}

/** Human-readable parts for a round's applied-filter snapshot. Only
 *  non-default options render; snapshot-less (old) rounds return []. */
function formatRoundFilters(
  filters: AddCardsRound['filters'],
  t: ReturnType<typeof useTranslation>['t']
): string[] {
  if (!filters) return [];
  const parts: string[] = [];
  if (filters.language)
    parts.push(
      filters.language === 'en'
        ? t('addCards.round.filterEn', 'English')
        : t('addCards.round.filterKo', '한국어')
    );
  if (filters.minViewCount) {
    const v = filters.minViewCount;
    const label =
      v >= 1_000_000 ? '100만+' : v >= 100_000 ? '10만+' : v >= 10_000 ? '1만+' : '1천+';
    parts.push(t('addCards.round.filterViews', '{{label}} 조회수', { label }));
  }
  if (filters.durationBucket) {
    const map: Record<string, string> = {
      short: t('addCards.round.durShort', '10분 미만'),
      medium: t('addCards.round.durMedium', '10–30분'),
      long: t('addCards.round.durLong', '30–60분'),
      xlong: t('addCards.round.durXlong', '60분 이상'),
    };
    if (map[filters.durationBucket]) parts.push(map[filters.durationBucket]);
  }
  if (filters.publishedAfter) {
    const days = Math.round((Date.now() - new Date(filters.publishedAfter).getTime()) / 86_400_000);
    const label =
      days <= 8
        ? t('addCards.round.pubWeek', '지난 1주')
        : days <= 32
          ? t('addCards.round.pubMonth', '지난 1개월')
          : days <= 190
            ? t('addCards.round.pubHalf', '지난 6개월')
            : t('addCards.round.pubYear', '지난 1년');
    parts.push(label);
  }
  if (filters.difficulty) parts.push(filters.difficulty);
  if (filters.keywords?.length) parts.push(filters.keywords.map((k) => `"${k}"`).join(' '));
  return parts;
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

        {/* Picked overlay — SINGLE control (2026-07-02 James: 두 버튼 분리가
            어색 → 통합). Default = "추가됨" check; hovering the card morphs
            the SAME center badge into the unpick affordance. Colors stay
            neutral (no red — user directive). */}
        {isPicked && (
          <>
            <div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/55 backdrop-blur-[2px] gap-1"
              aria-hidden="true"
            >
              {/* Default state — added */}
              <span className="flex flex-col items-center gap-1 group-hover:hidden">
                <span className="flex items-center justify-center w-9 h-9 rounded-full bg-emerald-500 shadow-lg">
                  <Check className="w-5 h-5 text-white" strokeWidth={3} />
                </span>
                <span className="text-[10.5px] font-semibold text-white tracking-wide">
                  {t('addCards.actions.picked', 'Picked')}
                </span>
              </span>
              {/* Hover state — same spot becomes the unpick control */}
              <span className="hidden flex-col items-center gap-1 group-hover:flex">
                <span className="flex items-center justify-center w-9 h-9 rounded-full border-2 border-white/80 bg-black/30">
                  <X className="w-5 h-5 text-white/90" strokeWidth={2.6} />
                </span>
                <span className="text-[10.5px] font-semibold text-white/90 tracking-wide">
                  {t('addCards.actions.unpick', 'Remove from mandala')}
                </span>
              </span>
            </div>

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
      {/* Meta block — James feedback 2026-07-02: the old 11px/9.5px cramped
          stack read like scribbles. Match the dashboard card hierarchy:
          semibold title, breathing room, one quiet meta line. */}
      <div className="px-2.5 pt-2 pb-2.5 space-y-1">
        <h4
          className={cn(
            'text-[13px] font-semibold leading-snug tracking-tight line-clamp-2',
            isPicked && 'text-muted-foreground'
          )}
        >
          {decodeHtmlEntities(card.title)}
        </h4>
        {card.channel && (
          <p className="text-[11px] text-muted-foreground line-clamp-1">{card.channel}</p>
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
  return <p className="text-[11px] text-muted-foreground/80 line-clamp-1">{parts.join(' · ')}</p>;
}
