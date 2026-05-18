import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { toast } from 'sonner';
import { InsightCard } from '@/entities/card/model/types';
import { InsightCardItemV2 } from './InsightCardItemV2';
import { FileVideo, Check } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useDragSelect } from '@/features/drag-select/model/useDragSelect';
import { cardSlotDropId } from '@/shared/lib/dnd';
import { InsightCardItemSkeleton } from './InsightCardItemSkeleton';
import {
  useSummaryRatings,
  useRateSummary,
} from '@/features/card-management/model/useSummaryRating';
import type { SummaryRating } from '@/features/card-management/model/useSummaryRating';
import { useV2Summaries } from '@/features/card-management/model/useV2Summaries';
import { useArchiveCard } from '@/features/card-management/model/useArchiveCard';
import { extractYouTubeVideoId } from '@/shared/lib/url-normalize';

function safeVideoId(videoUrl: string): string | null {
  try {
    return extractYouTubeVideoId(new URL(videoUrl));
  } catch {
    return null;
  }
}

interface CardListProps {
  cards: InsightCard[];
  isLoading?: boolean;
  /** Server-truth slot count not yet filled — rendered as skeleton tiles
   *  at the end of the grid so the total cell count stays fixed. */
  skeletonCount?: number;
  title: string;
  onCardClick?: (card: InsightCard) => void;
  onCardDragStart?: (card: InsightCard) => void;
  onMultiCardDragStart?: (cards: InsightCard[]) => void;
  onSaveNote?: (id: string, note: string) => void;
  onCardsReorder?: (reorderedCards: InsightCard[]) => void;
  onDeleteCards?: (cardIds: string[]) => void;
  onSelectionChange?: (selectedIds: string[]) => void;
  enrichingCardIds?: Set<string>;
  failedEnrichCardIds?: Set<string>;
  onRetryEnrich?: (cardId: string, videoUrl?: string) => void;
  gridColumns?: number;
  compact?: boolean;
  /** CP463 — 8 sector names from currentLevel.subjects, used to render
   *  the per-card sector label in the new footer row. */
  sectorSubjects?: string[];
}

// Wrapper to make each card slot a droppable for reorder.
// CP446 — `useDroppable` is kept (the parent's `card-slot` drop branch in
// IndexPage.handleDragEnd still routes reorder/move drops through it), but
// the per-card `isOver` outline (dashed indigo border + scale-up) is
// intentionally OFF. User feedback: while moving a card, hovering over
// other cards lit each one up in turn — distracting noise. The
// CardListView grid-area dashed overlay + the mandala-cell isOver
// emphasis already give enough drop-target signal.
function CardSlot({ card, children }: { card: InsightCard; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({
    id: cardSlotDropId(card.id),
    data: { type: 'card-slot' as const, cardId: card.id },
  });

  return (
    <div
      ref={setNodeRef}
      data-card-item
      data-card-id={card.id}
      className="w-full rounded-2xl relative"
    >
      {children}
    </div>
  );
}

const PAGE_SIZE = 24;

export function CardList({
  cards,
  isLoading,
  skeletonCount = 0,
  onCardClick,
  onSaveNote,
  onSelectionChange,
  enrichingCardIds,
  failedEnrichCardIds,
  onRetryEnrich,
  gridColumns = 4,
  compact = false,
  sectorSubjects,
}: CardListProps) {
  const { t } = useTranslation();

  const { data: summaryRatings } = useSummaryRatings();
  const rateSummary = useRateSummary();

  const handleRate = useCallback(
    (cardId: string, rating: SummaryRating) => {
      rateSummary.mutate({ cardId, rating });
    },
    [rateSummary]
  );

  // CP462+ Issue #649 Phase 3 — batch v2 lookup for Heart-only TL badge
  // + footer one_liner. Falls back to empty map when no cards.
  const videoIdsForV2 = useMemo(() => {
    const ids = new Set<string>();
    for (const c of cards) {
      const vid = safeVideoId(c.videoUrl);
      if (vid) ids.add(vid);
    }
    return Array.from(ids);
  }, [cards]);
  const { summariesByVideoId: v2SummariesMap, isFetching: v2IsFetching } =
    useV2Summaries(videoIdsForV2);

  // CP462+ Issue #649 Phase 3 — archive: client-side hide + 5-second
  // undo. The BE archive endpoint only records the signal (it does NOT
  // mutate the card row), so the FE owns the hide. We track hidden
  // videoIds in a Set and `cards.filter()` against it; unarchive fires
  // the BE delete + removes the videoId from the Set so the card
  // re-appears.
  // CP463 — persisted to localStorage scoped by mandalaId so refresh /
  // navigation away-and-back keeps the archive applied. Cross-device
  // sync is the BE list-endpoint LEFT JOIN, deferred to a follow-up PR.
  const { unarchive } = useArchiveCard();
  const archiveStorageKey = useMemo(() => {
    const mandalaId = cards.find((c) => c.mandalaId)?.mandalaId;
    return mandalaId ? `archived_videos:${mandalaId}` : null;
  }, [cards]);
  const [hiddenVideoIds, setHiddenVideoIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined' || !archiveStorageKey) return new Set();
    try {
      const raw = window.localStorage.getItem(archiveStorageKey);
      if (!raw) return new Set();
      const arr = JSON.parse(raw) as unknown;
      return Array.isArray(arr)
        ? new Set(arr.filter((s): s is string => typeof s === 'string'))
        : new Set();
    } catch {
      return new Set();
    }
  });
  // Re-load when the active mandala (storage key) changes — e.g. user
  // switches mandalas without remounting CardList.
  useEffect(() => {
    if (typeof window === 'undefined' || !archiveStorageKey) {
      setHiddenVideoIds(new Set());
      return;
    }
    try {
      const raw = window.localStorage.getItem(archiveStorageKey);
      if (!raw) {
        setHiddenVideoIds(new Set());
        return;
      }
      const arr = JSON.parse(raw) as unknown;
      setHiddenVideoIds(
        Array.isArray(arr)
          ? new Set(arr.filter((s): s is string => typeof s === 'string'))
          : new Set()
      );
    } catch {
      setHiddenVideoIds(new Set());
    }
  }, [archiveStorageKey]);
  const persistHidden = useCallback(
    (next: Set<string>) => {
      if (typeof window === 'undefined' || !archiveStorageKey) return;
      try {
        window.localStorage.setItem(archiveStorageKey, JSON.stringify(Array.from(next)));
      } catch {
        // quota exceeded or storage disabled — non-fatal, in-memory state still works
      }
    },
    [archiveStorageKey]
  );
  const handleArchived = useCallback(
    (videoId: string) => {
      setHiddenVideoIds((prev) => {
        const next = new Set(prev);
        next.add(videoId);
        persistHidden(next);
        return next;
      });
      toast.success(t('cards.archive.toastSuccess', '보관됨'), {
        duration: 5000,
        action: {
          label: t('cards.archive.undoLabel', '되돌리기'),
          onClick: () => {
            unarchive.mutate(videoId);
            setHiddenVideoIds((prev) => {
              const next = new Set(prev);
              next.delete(videoId);
              persistHidden(next);
              return next;
            });
          },
        },
      });
    },
    [persistHidden, t, unarchive]
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Cards arrive already sorted by the host (CardListView applies the user's
  // sortMode chip). Re-sorting here would override publishedAt ranking with
  // sortOrder / createdAt and was the cause of "5d ago in the middle".
  // CP463 — apply the archive hide before downstream slicing / sorting.
  // hiddenVideoIds reflects user "보관" clicks within this session; on
  // unarchive (undo toast or future restore action) the id is removed
  // and the card re-appears on the next render.
  const sortedCards = useMemo(
    () =>
      hiddenVideoIds.size === 0
        ? cards
        : cards.filter((c) => {
            const vid = safeVideoId(c.videoUrl);
            return !vid || !hiddenVideoIds.has(vid);
          }),
    [cards, hiddenVideoIds]
  );

  // Reset infinite-scroll page count when the card list changes
  // (mandala / cell switch). The thumbnail fade-in is handled per-image
  // by image-utils' opacity-0 → 1 onLoad chain — no batch gating here.
  const cardListKey = useMemo(() => cards.map((c) => c.id).join(','), [cards]);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [cardListKey]);

  // Infinite scroll: observe sentinel at bottom of grid
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, sortedCards.length));
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sortedCards.length]);

  const visibleCards = useMemo(
    () => sortedCards.slice(0, visibleCount),
    [sortedCards, visibleCount]
  );
  const hasMore = visibleCount < sortedCards.length;

  // Filter out selection IDs that no longer exist in cards (e.g., after moving cards)
  useEffect(() => {
    setSelectedCardIds((prev) => {
      const cardIdSet = new Set(cards.map((c) => c.id));
      const filtered = new Set([...prev].filter((id) => cardIdSet.has(id)));
      if (filtered.size !== prev.size) {
        setLastSelectedIndex(null);
        return filtered;
      }
      return prev;
    });
  }, [cards]);

  // Notify parent of selection changes
  useEffect(() => {
    onSelectionChange?.([...selectedCardIds]);
  }, [selectedCardIds, onSelectionChange]);

  // ESC key to clear selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedCardIds(new Set());
        setLastSelectedIndex(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Ref to track justFinishedDrag without stale closure
  const justFinishedDragRef = useRef(false);

  // Click anywhere outside card content to clear selection
  useEffect(() => {
    const handleClickAnywhere = (e: MouseEvent) => {
      if (justFinishedDragRef.current) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-card-content]')) return;
      if (target.closest('[data-card-deselect]')) return;
      setSelectedCardIds(new Set());
      setLastSelectedIndex(null);
    };
    document.addEventListener('click', handleClickAnywhere);
    return () => document.removeEventListener('click', handleClickAnywhere);
  }, []);

  // Drag select hook
  const handleDragSelectChange = useCallback(
    (selectedIndices: number[], additive: boolean) => {
      const newSelectedIds = new Set(
        selectedIndices.map((idx) => sortedCards[idx]?.id).filter(Boolean)
      );
      if (additive) {
        setSelectedCardIds((prev) => new Set([...prev, ...newSelectedIds]));
      } else {
        setSelectedCardIds(newSelectedIds);
      }
    },
    [sortedCards]
  );

  const {
    selectionStyle,
    justFinishedDrag,
    isDragging: isDragSelecting,
  } = useDragSelect({
    containerRef: containerRef,
    itemSelector: '[data-card-item]',
    onSelectionChange: handleDragSelectChange,
    enabled: true,
  });

  // Keep ref in sync for document click handler (avoids stale closure)
  useEffect(() => {
    justFinishedDragRef.current = justFinishedDrag;
  }, [justFinishedDrag]);

  const handleCardClick = useCallback(
    (e: React.MouseEvent, card: InsightCard, cardIndex: number) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();

        if (lastSelectedIndex !== null) {
          const start = Math.min(lastSelectedIndex, cardIndex);
          const end = Math.max(lastSelectedIndex, cardIndex);
          const rangeCardIds = sortedCards.slice(start, end + 1).map((c) => c.id);

          setSelectedCardIds((prev) => {
            const next = new Set(prev);
            rangeCardIds.forEach((id) => next.add(id));
            return next;
          });
        } else {
          setSelectedCardIds(new Set([card.id]));
          setLastSelectedIndex(cardIndex);
        }
      } else if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        setSelectedCardIds((prev) => {
          const next = new Set(prev);
          if (next.has(card.id)) {
            next.delete(card.id);
          } else {
            next.add(card.id);
          }
          return next;
        });
        setLastSelectedIndex(cardIndex);
      } else {
        setSelectedCardIds(new Set());
        setLastSelectedIndex(null);
        onCardClick?.(card);
      }
    },
    [lastSelectedIndex, sortedCards, onCardClick]
  );

  // Empty state ONLY when there is genuinely nothing expected to load —
  // not loading AND server says zero AND the local list is empty.
  // Otherwise we mount the real grid (below) so its cells either hold a
  // real card or an inline skeleton tile of the SAME size.
  if (cards.length === 0 && skeletonCount === 0 && !isLoading) {
    return (
      <div
        ref={gridRef}
        className={cn(
          'text-center py-12 text-muted-foreground transition-all duration-200 rounded-lg select-none',
          false
        )}
        style={{ minHeight: 'calc(100vh - 300px)' }}
      >
        <FileVideo className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>{t('cards.noInsights')}</p>
        <p className="text-sm mt-1">{t('cards.dragToAdd')}</p>
      </div>
    );
  }

  // Padding only when the grid is genuinely empty (loading state). Once
  // a single real card lands the grid renders organically — never inject
  // placeholders between/after real cards. Capped at 12 so big mandalas
  // (server cardCount can be 200+) don't paint a full-screen skeleton
  // wall before the first real card arrives.
  const SKELETON_CAP = 12;
  const loadingPaddingCount =
    cards.length === 0 && skeletonCount > 0 ? Math.min(skeletonCount, SKELETON_CAP) : 0;

  return (
    <div className="animate-fade-in -mx-4 px-4 relative select-none" ref={containerRef}>
      {selectionStyle && <div style={selectionStyle} />}
      <div
        ref={gridRef}
        className={cn(
          'grid grid-cols-1 gap-4 p-3 min-h-full flex-1 pb-20 justify-items-center transition-all duration-200',
          false
        )}
        style={{
          minHeight: 'calc(100vh - 200px)',
          gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
        }}
      >
        {visibleCards.map((card, idx) => {
          const isSelected = selectedCardIds.has(card.id);
          return (
            <CardSlot key={card.id} card={card}>
              {isSelected && (
                <div
                  className="absolute top-2 left-2 z-20 bg-primary rounded-full p-1 cursor-pointer hover:bg-primary/80 transition-colors"
                  data-card-deselect
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedCardIds((prev) => {
                      const next = new Set(prev);
                      next.delete(card.id);
                      return next;
                    });
                  }}
                  title={t('cards.deselectCard')}
                >
                  <Check className="w-3 h-3 text-primary-foreground" />
                </div>
              )}
              {/* YouTube pattern: the card renders immediately. The
                  thumbnail fades in via image-utils' opacity-0 → 1
                  onLoad chain inside InsightCardItemV2's <img>. No
                  outer visibility/opacity wrap and no per-card skeleton
                  overlay — those gated already-decoded thumbs behind a
                  Set lookup and made the grid feel broken on mandala
                  switch (CP468 → CP469 sweep). */}
              <InsightCardItemV2
                card={card}
                onCardClick={() => onCardClick?.(card)}
                onCtrlClick={(e) => handleCardClick(e, card, idx)}
                isDraggable={true}
                selectedCardIds={selectedCardIds.size > 0 ? selectedCardIds : undefined}
                isEnriching={enrichingCardIds?.has(card.id)}
                isEnrichFailed={failedEnrichCardIds?.has(card.id)}
                onRetryEnrich={onRetryEnrich}
                mandalaRelevancePct={(() => {
                  const vid = safeVideoId(card.videoUrl);
                  return vid ? (v2SummariesMap.get(vid)?.mandalaRelevancePct ?? null) : null;
                })()}
                oneLiner={(() => {
                  const vid = safeVideoId(card.videoUrl);
                  return vid ? (v2SummariesMap.get(vid)?.oneLiner ?? null) : null;
                })()}
                isV2Loading={v2IsFetching}
                sectorLabel={
                  sectorSubjects && card.cellIndex >= 0 && card.cellIndex < sectorSubjects.length
                    ? sectorSubjects[card.cellIndex]
                    : null
                }
                onArchived={handleArchived}
              />
            </CardSlot>
          );
        })}

        {/* Padding skeletons — ONLY when the grid is genuinely empty
            (initial loading / mandala switch with no data yet). Once
            real cards land we never inject placeholders between or
            after them; the infinite-scroll sentinel below handles
            paging without padding. */}
        {cards.length === 0 &&
          loadingPaddingCount > 0 &&
          Array.from({ length: loadingPaddingCount }).map((_, i) => (
            <div key={`sk-${i}`} className="w-full">
              <InsightCardItemSkeleton />
            </div>
          ))}
      </div>

      {hasMore && <div ref={sentinelRef} aria-hidden className="h-1" />}
    </div>
  );
}
