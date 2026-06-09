import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import type { InsightCard } from '@/entities/card/model/types';
import { cn } from '@/shared/lib/utils';
import { extractUrlFromDragData, extractUrlFromHtml } from '@/shared/data/mockData';
import type { ViewMode } from '@/entities/user/model/types';
import { ViewSwitcher } from '@/features/view-mode';
import { CardList } from '@/widgets/card-list/ui/CardList';
import { ListView } from '@/widgets/list-view';
import { DetailPanel } from '@/widgets/detail-panel';
import { GraphView } from '@/components/graph/GraphView';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/shared/ui/resizable';
import {
  LayoutGrid,
  Grid3X3,
  Plus,
  GripVertical,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  ArrowDownAZ,
  ArrowDownZA,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/shared/ui/dropdown-menu';
import { Slider } from '@/shared/ui/slider';
import { ContextHeader, SORT_OPTIONS, type SortMode } from './ContextHeader';
import { LabelFilterPillsV2 } from './LabelFilterPillsV2';

/**
 * CP498 PR3c — A-stage relevance comparator: DESC, NULLS LAST. `?? -1` sinks
 * null/undefined relevancePct below any real 0-100 score. Pure + exported so
 * the ordering contract (highest-first, unscored-last) is unit-tested against a
 * sign-flip regression. NEVER reads the video-keyed v2MandalaRelevancePct.
 */
export const compareByRelevanceDesc = (a: InsightCard, b: InsightCard): number => {
  // DESC by relevancePct (NULLS LAST via ?? -1) + stable tiebreak by id so the
  // large equal-score band (title-only "70s cluster") does NOT reshuffle on
  // refetch — e.g. after a Heart/like invalidates the cards query. CP498 PR3c.
  const d = (b.relevancePct ?? -1) - (a.relevancePct ?? -1);
  return d !== 0 ? d : a.id.localeCompare(b.id);
};

const SORT_ICON_BY_VALUE: Record<SortMode, typeof ArrowDownWideNarrow> = {
  latest: ArrowDownWideNarrow,
  oldest: ArrowUpWideNarrow,
  'title-asc': ArrowDownAZ,
  'title-desc': ArrowDownZA,
  // CP498 PR3c — reuse the descending icon; a dedicated relevance glyph /
  // numeric badge is deferred (visual signal = later per spec).
  'relevance-desc': ArrowDownWideNarrow,
};

const MIN_GRID_COLUMNS = 2;
const MAX_GRID_COLUMNS = 6;
const COMPACT_THRESHOLD = 5;

// Responsive grid columns by CONTAINER width (auto-calculated, replaces manual slider).
// Reacts to side panel open/close — when main area shrinks, columns auto-reduce.
// Slider component is preserved below for future reuse but hidden via SHOW_GRID_SLIDER flag.
//
// Breakpoints widened so the 2-column layout applies across the full range
// that an open side panel typically leaves behind (~400–1100px of main
// area). Previously cards dropped to 1-col below 600px, which made every
// card read as a thumbnail strip when the video panel was expanded.
const SHOW_GRID_SLIDER = false;
const CONTAINER_5COL = 1600;
const CONTAINER_4COL = 1300;
const CONTAINER_3COL = 1050;
// Minimum legible card width is ~220px (matches user screenshot showing
// 2-col at ~460px container where thumbnails are still readable). Below
// ~460px we collapse to 1 column to keep individual cards usable —
// previously we held 2-col down to 260px which crushed each card to
// ~120px, breaking UX when the video side panel opens wide.
const CONTAINER_2COL = 460;

function getColumnsForWidth(width: number): number {
  if (width >= CONTAINER_5COL) return 5;
  if (width >= CONTAINER_4COL) return 4;
  if (width >= CONTAINER_3COL) return 3;
  if (width >= CONTAINER_2COL) return 2;
  return 1;
}

function useContainerColumns(ref: React.RefObject<HTMLElement>): number {
  const [cols, setCols] = useState(3);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        setCols(getColumnsForWidth(w));
      }
    });
    observer.observe(el);
    // Initial measurement
    setCols(getColumnsForWidth(el.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, [ref]);
  return cols;
}

interface CardListViewProps {
  cards: InsightCard[];
  isLoading?: boolean;
  title: string;
  /** Render title as a shimmer placeholder while mandala detail query is loading. */
  titleLoading?: boolean;
  viewMode: ViewMode;
  listPanelRatio: number;
  mandalaId?: string | null;
  onViewModeChange: (mode: ViewMode) => void;
  onListPanelRatioChange: (ratio: number) => void;
  onCardClick?: (card: InsightCard, sortedList?: InsightCard[]) => void;
  /** Reduce card size by adding +1 column (e.g. when side panel is open) */
  compactMode?: boolean;
  onCardDragStart?: (card: InsightCard) => void;
  onMultiCardDragStart?: (cards: InsightCard[]) => void;
  onSaveNote?: (id: string, note: string) => void;
  onCardsReorder?: (reorderedCards: InsightCard[]) => void;
  onDeleteCards?: (cardIds: string[]) => void;
  onAddCard?: (url: string) => void;
  /** External URL drop (native HTML5 drag from browser) */
  onExternalUrlDrop?: (url: string) => void;
  onExternalFileDrop?: (files: FileList) => void;
  onSaveWatchPosition?: (id: string, positionSeconds: number) => void;
  watchPositionCache?: Map<string, number>;
  panelSizeCache?: Map<string, number>;
  highlightedCardId?: string | null;
  enrichingCardIds?: Set<string>;
  failedEnrichCardIds?: Set<string>;
  onRetryEnrich?: (cardId: string, videoUrl?: string) => void;
  // Sector pills
  sectorSubjects?: string[];
  selectedCellIndex?: number | null;
  onCellClick?: (cellIndex: number, subject: string) => void;
  totalCardCount?: number;
  /** Card count per sector cell (index 0-7) for pill badges */
  cardsByCell?: Record<number, InsightCard[]>;
  /** True when an external card drag is active (from Ideation) */
  isExternalCardDragActive?: boolean;
  /**
   * CP445 — true while an *internal* card drag (handle-driven D&D within the
   * grid) is active. Triggers the same dashed-border + soft-fill guideline
   * overlay as the external case so users see where drops land before they
   * release.
   */
  isInternalCardDragActive?: boolean;
  /** Grid column count (2-6) */
  gridColumns?: number;
  /** Grid column change handler */
  onGridColumnsChange?: (columns: number) => void;
  /**
   * Issue #389: cards synced from a mapped source but not yet placed into
   * a cell (mandala_id set, cell_index<0, is_in_ideation=false). The
   * "Newly Synced" pill is hidden when this list is empty.
   */
  newlySyncedCards?: InsightCard[];
  /** CP442 — slot rendered left of ViewSwitcher (e.g., IdeaSpot trigger). */
  trailingAction?: React.ReactNode;
}

export function CardListView({
  cards,
  isLoading,
  title,
  titleLoading,
  viewMode,
  listPanelRatio,
  mandalaId,
  onViewModeChange,
  onListPanelRatioChange,
  onCardClick,
  onCardDragStart,
  onMultiCardDragStart,
  onSaveNote,
  onCardsReorder,
  onDeleteCards,
  onExternalUrlDrop,
  onExternalFileDrop,
  onSaveWatchPosition,
  watchPositionCache,
  panelSizeCache,
  enrichingCardIds,
  failedEnrichCardIds,
  onRetryEnrich,
  sectorSubjects,
  selectedCellIndex,
  onCellClick,
  totalCardCount,
  cardsByCell,
  isExternalCardDragActive,
  isInternalCardDragActive,
  gridColumns: gridColumnsProp,
  onGridColumnsChange,
  compactMode = false,
  newlySyncedCards,
  trailingAction,
}: CardListViewProps) {
  const { t } = useTranslation();
  // Auto-responsive columns by CONTAINER width (reacts to side panel open/close).
  // Manual gridColumns prop ignored unless SHOW_GRID_SLIDER flag is on.
  // Manual gridColumns prop ignored unless SHOW_GRID_SLIDER flag is on.
  const containerRef = useRef<HTMLDivElement>(null);
  const responsiveColumns = useContainerColumns(containerRef);
  // Side-panel-open `compactMode` used to add +1 column to shrink cards —
  // that made every card a tiny strip when the video panel was open, which
  // was the opposite of what users want (they need to read titles in the
  // narrowed grid). Now the responsive container width is the sole driver,
  // so a narrower main area produces fewer, bigger cards.
  void compactMode;
  const gridColumns = SHOW_GRID_SLIDER && gridColumnsProp ? gridColumnsProp : responsiveColumns;
  const [activeCard, setActiveCard] = useState<InsightCard | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>('latest');
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  // Issue #389: Newly Synced pill is mutually exclusive with All/sector pills.
  // Kept as local state (rather than lifting to parent) because the filter is
  // a pure view concern that doesn't persist across navigations — the pill
  // only appears when the current mandala has mapping-synced unplaced cards.
  const [isNewlySyncedActive, setIsNewlySyncedActive] = useState(false);
  const newlySyncedCount = newlySyncedCards?.length ?? 0;

  // Auto-exit the Newly Synced view when the source list drains to 0 (user
  // placed the last card via D&D). Prevents an empty-with-no-exit state.
  useEffect(() => {
    if (isNewlySyncedActive && newlySyncedCount === 0) {
      setIsNewlySyncedActive(false);
    }
  }, [isNewlySyncedActive, newlySyncedCount]);

  // Exit Newly Synced whenever a sector pill (or a cell-click elsewhere in
  // the app) selects a real cell — keeps the two views mutually exclusive.
  useEffect(() => {
    if (selectedCellIndex !== null && selectedCellIndex >= 0 && isNewlySyncedActive) {
      setIsNewlySyncedActive(false);
    }
  }, [selectedCellIndex, isNewlySyncedActive]);

  // Native HTML5 external drag handlers (YouTube URL from browser etc.)
  const handleExternalDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!onExternalUrlDrop) return;
      e.preventDefault();
      setIsExternalDragOver(true);
    },
    [onExternalUrlDrop]
  );

  const handleExternalDragLeave = useCallback(() => {
    setIsExternalDragOver(false);
  }, []);

  const handleExternalDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsExternalDragOver(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onExternalFileDrop?.(e.dataTransfer.files);
        return;
      }
      const rawUrl =
        e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      let url = rawUrl ? extractUrlFromDragData(rawUrl) : null;
      if (!url) {
        const html = e.dataTransfer.getData('text/html');
        if (html) url = extractUrlFromHtml(html);
      }
      if (url) {
        onExternalUrlDrop?.(url);
      }
    },
    [onExternalUrlDrop, onExternalFileDrop]
  );

  // Grid-area droppable at CardListView level (covers header + pills + grid)
  const { setNodeRef: setGridAreaRef } = useDroppable({
    id: 'drop-grid-area',
    data: { type: 'grid-area' as const },
  });

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const effectiveViewMode = viewMode === 'list-detail' && isMobile ? 'list' : viewMode;

  // Issue #389: when the Newly Synced pill is active, swap the card source
  // to the unplaced mapping-synced cards. Otherwise keep the parent-filtered
  // `cards` flow (All / sector pills / search) intact.
  const effectiveCards = isNewlySyncedActive && newlySyncedCards ? newlySyncedCards : cards;

  // "latest"/"oldest" rank by source publish date (YouTube upload) ONLY.
  // Cards without a publish date sort to the end instead of inheriting
  // `createdAt` — otherwise newly-cached items inherit "today" and leak
  // into the "Latest" band above genuinely-recent uploads.
  const sortedCards = useMemo(() => {
    const arr = [...effectiveCards];
    const getPublishedMs = (c: (typeof cards)[number]): number => {
      const fromField = c.publishedAt ? new Date(c.publishedAt).getTime() : NaN;
      if (Number.isFinite(fromField)) return fromField;
      const metaPublished = (c.metadata as unknown as Record<string, unknown> | undefined)?.[
        'published_at'
      ];
      if (typeof metaPublished === 'string') {
        const t = new Date(metaPublished).getTime();
        if (Number.isFinite(t)) return t;
      }
      return NaN;
    };
    switch (sortMode) {
      case 'latest':
        return arr.sort((a, b) => {
          const ma = getPublishedMs(a);
          const mb = getPublishedMs(b);
          const aHas = Number.isFinite(ma);
          const bHas = Number.isFinite(mb);
          if (aHas && !bHas) return -1;
          if (!aHas && bHas) return 1;
          if (!aHas && !bHas) return 0;
          return mb - ma;
        });
      case 'oldest':
        return arr.sort((a, b) => {
          const ma = getPublishedMs(a);
          const mb = getPublishedMs(b);
          const aHas = Number.isFinite(ma);
          const bHas = Number.isFinite(mb);
          if (aHas && !bHas) return -1;
          if (!aHas && bHas) return 1;
          if (!aHas && !bHas) return 0;
          return ma - mb;
        });
      case 'title-asc':
        return arr.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      case 'title-desc':
        return arr.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
      case 'relevance-desc':
        // CP498 PR3c — A-stage relevance: highest first, unscored cards last
        // (DESC NULLS LAST). Cards are reordered, never removed (reversible).
        return arr.sort(compareByRelevanceDesc);
      default:
        return arr;
    }
  }, [effectiveCards, sortMode]);

  // Sector card counts (0-7)
  const sectorCounts = useMemo(() => {
    if (!sectorSubjects || !cardsByCell) return [];
    return sectorSubjects.map((_, idx) => (cardsByCell[idx] ?? []).length);
  }, [sectorSubjects, cardsByCell]);

  const handleCardSelect = useCallback((card: InsightCard) => {
    setActiveCard(card);
  }, []);

  const handlePanelResize = useCallback(
    (sizes: number[]) => {
      if (sizes[0]) onListPanelRatioChange(Math.round(sizes[0]));
    },
    [onListPanelRatioChange]
  );

  const handleSelectionChange = useCallback((ids: string[]) => {
    setSelectedCardIds(ids);
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (selectedCardIds.length > 0) {
      onDeleteCards?.(selectedCardIds);
    }
  }, [selectedCardIds, onDeleteCards]);

  const handleAllClick = useCallback(() => {
    setIsNewlySyncedActive(false);
    onCellClick?.(-1, '');
  }, [onCellClick]);

  const handleNewlySyncedClick = useCallback(() => {
    setIsNewlySyncedActive(true);
    onCellClick?.(-1, '');
  }, [onCellClick]);

  // Grid column slider element (inline in header).
  // Hidden by default — auto-responsive columns by viewport instead.
  // Slider code preserved for future toggle via SHOW_GRID_SLIDER flag.
  const gridSliderElement =
    SHOW_GRID_SLIDER && onGridColumnsChange && effectiveViewMode === 'grid' ? (
      <div className="hidden md:flex items-center gap-1.5">
        <LayoutGrid className="w-2.5 h-2.5 text-muted-foreground/60" />
        <Slider
          value={[gridColumns]}
          min={MIN_GRID_COLUMNS}
          max={MAX_GRID_COLUMNS}
          step={1}
          onValueChange={([v]) => onGridColumnsChange(v)}
          className="w-20"
        />
        <Grid3X3 className="w-2.5 h-2.5 text-muted-foreground/60" />
      </div>
    ) : null;

  // Context header — count reflects whatever list the view is rendering,
  // so it tracks the Newly Synced pill too.
  const contextHeaderElement = (
    <ContextHeader
      title={title}
      titleLoading={titleLoading}
      totalCardCount={effectiveCards.length}
      viewMode={effectiveViewMode}
      onViewModeChange={onViewModeChange}
      selectedCardIds={selectedCardIds}
      onDeleteSelected={handleDeleteSelected}
      sliderElement={gridSliderElement}
      trailingAction={trailingAction}
    />
  );

  // Drag-to-move hint + sort dropdown — sits inline with the sector pills row
  // (one level below the ContextHeader title row so the toolbar capsules don't
  // compete with the hint text).
  const currentSortLabel = SORT_OPTIONS.find((o) => o.value === sortMode);
  const CurrentSortIcon = SORT_ICON_BY_VALUE[sortMode];
  const dragSortInline = (
    // pb-1 mirrors the LabelFilterPillsV2 inner wrapper's pb-1 so this
    // toolbar sits on the same vertical center as the chips on the left.
    <div className="flex items-center gap-3 shrink-0 pb-1">
      {effectiveViewMode === 'grid' && (
        <div className="hidden lg:flex h-7 items-center gap-1 text-[11px] text-muted-foreground/70">
          <GripVertical className="h-3 w-3" />
          <span>{t('cards.dragToMove')}</span>
        </div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none"
          >
            <CurrentSortIcon className="h-3 w-3" />
            <span className="hidden sm:inline">
              {currentSortLabel ? t(currentSortLabel.labelKey) : t('cards.sort', 'Sort')}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuRadioGroup
            value={sortMode}
            onValueChange={(v) => setSortMode(v as SortMode)}
          >
            {SORT_OPTIONS.map((opt) => {
              const OptIcon = SORT_ICON_BY_VALUE[opt.value];
              return (
                <DropdownMenuRadioItem
                  key={opt.value}
                  value={opt.value}
                  className="text-xs focus:text-foreground"
                >
                  <OptIcon className="mr-2 h-3.5 w-3.5" />
                  {t(opt.labelKey)}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  // Sector pills — row wrapped with drag/sort inline on the right so chips and
  // toolbar hint sit on the same visual level.
  const sectorPillsContent = sectorSubjects && sectorSubjects.length > 0 && (
    <LabelFilterPillsV2
      sectors={sectorSubjects}
      selectedIndex={selectedCellIndex ?? null}
      totalCount={totalCardCount ?? cards.length}
      sectorCounts={sectorCounts}
      onSectorClick={(idx, subject) => onCellClick?.(idx, subject)}
      onAllClick={handleAllClick}
      newlySyncedCount={newlySyncedCount}
      isNewlySyncedSelected={isNewlySyncedActive}
      onNewlySyncedClick={handleNewlySyncedClick}
    />
  );

  // Row wrapper: pills on the left (flex-grow) + drag-hint + sort on the right.
  // pr-2 mirrors the ContextHeader inset so the right-edge visual weight
  // (sort text + capsule buttons above) aligns with the chips on the left.
  const sectorPillsElement = (
    <div className="flex items-center justify-between gap-3 pr-2">
      <div className="flex-1 min-w-0">{sectorPillsContent || null}</div>
      {dragSortInline}
    </div>
  );

  // Graph mode
  if (effectiveViewMode === 'graph') {
    return (
      <div className="h-full flex flex-col animate-fade-in">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold">
            {title} {t('cards.insights')}
          </h3>
          <div className="flex items-center gap-1.5">
            {trailingAction}
            <ViewSwitcher value={viewMode} onChange={onViewModeChange} />
          </div>
        </div>
        <div className="flex-1 min-h-0 relative">
          <GraphView mandalaId={mandalaId} />
        </div>
      </div>
    );
  }

  // Grid mode — CP446 2-layer hit-area split.
  //
  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ DROP HIT AREA (outer) ─ 시각 효과 0, 화면 폭 전체 droppable           ║
  // ║   ╔════════════════════════════════════════════════════════════════╗ ║
  // ║   ║ VISUAL CHROME (inner) ─ 현재 시각 그대로, dashed border 등     ║ ║
  // ║   ║   header / pills / CardList                                     ║ ║
  // ║   ╚════════════════════════════════════════════════════════════════╝ ║
  // ╚══════════════════════════════════════════════════════════════════════╝
  //
  // **Why two layers**: IndexPage main content has `lg:px-[70px]` padding —
  // before this split the droppable id `drop-grid-area` lived inside that
  // padding, leaving ~140px of dead zone on either side where users could
  // not drop cards. The outer wrapper uses negative margin + restored
  // padding to extend the hit area to the full main-content width while
  // keeping the visual position pixel-identical to the pre-CP446 layout.
  //
  // **WHEN MODIFYING D&D**:
  //   - `setGridAreaRef` (dnd-kit useDroppable) → MUST stay on outer.
  //     Native HTML5 handlers (`onDragOver/Leave/Drop`) also stay on outer
  //     so externally-dragged URLs/files anywhere in the main content
  //     register. Moving these to inner shrinks the hit area back.
  //   - `containerRef` (ResizeObserver / `useContainerColumns`) → MUST stay
  //     on inner. It measures the visible grid width to pick a column count;
  //     measuring the outer would let cards bleed into the padding region.
  //   - The `-mx-* px-*` pair on outer is a single trick: cancel padding,
  //     re-add it. Don't separate them.
  //   - Active-drag visual (`border-2 border-dashed border-primary/40
  //     bg-primary/5 rounded-md`) belongs on inner so the dashed outline
  //     traces the card grid, not the screen edge.
  //   - dnd-smoke.spec.ts, D&D Change Guard, and CLAUDE.md "D&D Protection"
  //     still apply — touching anything D&D-related requires `/test-dnd`
  //     before push.
  if (effectiveViewMode === 'grid') {
    return (
      <div
        ref={setGridAreaRef}
        onDragOver={handleExternalDragOver}
        onDragLeave={handleExternalDragLeave}
        onDrop={handleExternalDrop}
        // OUTER: drop hit area only — extend across the lg:px-[70px] padding
        // applied by IndexPage's main content. Visual is intentionally none.
        className="-mx-6 md:-mx-10 lg:-mx-[70px] px-6 md:px-10 lg:px-[70px]"
      >
        <div
          ref={containerRef}
          // INNER: visible chrome — measured for responsive columns and
          // styled with the active-drag dashed outline. Pre-CP446 className
          // preserved verbatim except for the now-unnecessary `-mx-4 px-4`
          // (the outer wrapper handles padding).
          className={cn(
            'animate-fade-in transition-all duration-200 relative',
            (isExternalCardDragActive || isExternalDragOver || isInternalCardDragActive) &&
              'border-2 border-dashed border-primary/40 bg-primary/5 rounded-md'
          )}
        >
          {isExternalDragOver && (
            <div className="absolute inset-0 flex items-center justify-center bg-primary/10 backdrop-blur-[1px] pointer-events-none z-10">
              <div className="flex flex-col items-center gap-2">
                <div
                  className="rounded-md border border-dashed border-primary/40 bg-primary/10 flex items-center justify-center"
                  style={{
                    width: '52px',
                    aspectRatio: '16/9',
                    animation: 'card-silhouette-pulse 1.5s ease-in-out infinite',
                  }}
                >
                  <Plus className="w-4 h-4 text-primary/40" />
                </div>
                <span className="text-primary font-medium text-xs">
                  {t('index.dropToAdd', 'Drop to add card')}
                </span>
              </div>
            </div>
          )}
          {contextHeaderElement}
          {sectorPillsElement}
          <CardList
            cards={sortedCards}
            isLoading={isLoading}
            title={title}
            gridColumns={gridColumns}
            compact={gridColumns >= COMPACT_THRESHOLD}
            sectorSubjects={sectorSubjects}
            onCardClick={onCardClick ? (card) => onCardClick(card, sortedCards) : undefined}
            onCardDragStart={onCardDragStart}
            onMultiCardDragStart={onMultiCardDragStart}
            onSaveNote={onSaveNote}
            onCardsReorder={onCardsReorder}
            onDeleteCards={onDeleteCards}
            onSelectionChange={handleSelectionChange}
            enrichingCardIds={enrichingCardIds}
            failedEnrichCardIds={failedEnrichCardIds}
            onRetryEnrich={onRetryEnrich}
          />
        </div>
      </div>
    );
  }

  // List mode
  if (effectiveViewMode === 'list') {
    return (
      <div
        className="h-full flex flex-col animate-fade-in"
        onDragOver={handleExternalDragOver}
        onDragLeave={handleExternalDragLeave}
        onDrop={handleExternalDrop}
      >
        {contextHeaderElement}
        {sectorPillsElement}
        <div className="flex-1 min-h-0">
          <ListView
            cards={sortedCards}
            activeCardId={activeCard?.id ?? null}
            onCardSelect={handleCardSelect}
            onCardClick={onCardClick ? (card) => onCardClick(card, sortedCards) : undefined}
          />
        </div>
      </div>
    );
  }

  // List-detail mode
  return (
    <div
      className="h-full flex flex-col animate-fade-in"
      onDragOver={handleExternalDragOver}
      onDragLeave={handleExternalDragLeave}
      onDrop={handleExternalDrop}
    >
      {contextHeaderElement}
      {sectorPillsElement}
      <div className="flex-1 min-h-0 rounded-lg border overflow-hidden">
        <ResizablePanelGroup direction="horizontal" onLayout={handlePanelResize}>
          <ResizablePanel defaultSize={listPanelRatio} minSize={25} maxSize={60}>
            <ListView
              cards={sortedCards}
              activeCardId={activeCard?.id ?? null}
              onCardSelect={handleCardSelect}
              onCardClick={onCardClick ? (card) => onCardClick(card, sortedCards) : undefined}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={100 - listPanelRatio} minSize={30}>
            <DetailPanel
              card={activeCard}
              onSaveNote={onSaveNote}
              onSaveWatchPosition={onSaveWatchPosition}
              watchPositionCache={watchPositionCache}
              panelSizeCache={panelSizeCache}
              onClose={() => setActiveCard(null)}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
