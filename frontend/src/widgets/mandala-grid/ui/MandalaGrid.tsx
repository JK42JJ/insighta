import { useState, useRef, useEffect, memo } from 'react';
import { cn } from '@/shared/lib/utils';
import { MandalaCell } from './MandalaCell';
import { MandalaDashboard } from './MandalaDashboard';
import { MandalaLevel, InsightCard } from '@/entities/card/model/types';
import { Sparkles, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface MandalaGridProps {
  level: MandalaLevel;
  cardsByCell: Record<number, InsightCard[]>;
  selectedCellIndex: number | null;
  onCellClick: (cellIndex: number, subject: string) => void;
  onCardDrop: (
    cellIndex: number,
    url?: string,
    cardId?: string,
    multiCardIds?: string[],
    files?: FileList
  ) => void;
  onCardClick: (card: InsightCard) => void;
  onCardDragStart: (card: InsightCard) => void;
  onSubjectsReorder: (newSubjects: string[], swappedIndices?: { from: number; to: number }) => void;
  onCellDragging?: (isDragging: boolean) => void;
  isGridDropZone: boolean;
  // dnd-kit active drag state (from DndContext)
  activeDragCellIndex?: number | null;
  activeDragOverCellIndex?: number | null;
  hasSubLevel?: (subject: string) => boolean;
  onNavigateToSubLevel?: (subject: string, entryGridIndex: number) => void;
  onNavigateBack?: () => void;
  canGoBack?: boolean;
  entryGridIndex?: number | null;
  showHint?: boolean;
  hideHeader?: boolean;
  /** True when any card is being dragged (internal dnd-kit) */
  isCardDragActive?: boolean;
}

export type MandalaSizeMode = 'compact' | 'standard' | 'spacious';

export const MandalaGrid = memo(function MandalaGrid({
  level,
  cardsByCell,
  selectedCellIndex,
  onCellClick,
  onCardDrop,
  onCardClick,
  onCardDragStart,
  onSubjectsReorder,
  isGridDropZone,
  activeDragCellIndex = null,
  activeDragOverCellIndex = null,
  onNavigateToSubLevel,
  onNavigateBack,
  canGoBack = false,
  entryGridIndex = null,
  showHint = true,
  hideHeader = false,
  isCardDragActive = false,
}: MandalaGridProps) {
  const { t } = useTranslation();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionDirection, setTransitionDirection] = useState<'in' | 'out'>('in');
  const [rippleOrigin, setRippleOrigin] = useState<{ x: number; y: number } | null>(null);
  const [swappingCells, setSwappingCells] = useState<{ from: number; to: number } | null>(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const swapTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [sizeMode, setSizeMode] = useState<MandalaSizeMode>('standard');

  // Detect container size and derive sizeMode based on grid size (min dimension)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect ?? { width: 0, height: 0 };
      const minDim = Math.min(width, height);
      if (minDim < 280) setSizeMode('compact');
      else if (minDim > 420) setSizeMode('spacious');
      else setSizeMode('standard');
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const gridToSubjectIndex: Record<number, number> = {
    0: 0,
    1: 1,
    2: 2,
    3: 3,
    5: 4,
    6: 5,
    7: 6,
    8: 7,
  };

  const getCellData = (gridIndex: number) => {
    if (gridIndex === 4) {
      return { label: level.centerGoal, isCenter: true, subjectIndex: -1 };
    }

    const subjectIndex = gridToSubjectIndex[gridIndex];
    return {
      label: level.subjects[subjectIndex] || '',
      isCenter: false,
      subjectIndex,
    };
  };

  const handleCellSwap = (fromGridIndex: number, toGridIndex: number) => {
    if (fromGridIndex === toGridIndex || fromGridIndex === 4 || toGridIndex === 4) return;

    setSwappingCells({ from: fromGridIndex, to: toGridIndex });

    if (swapTimeoutRef.current) {
      clearTimeout(swapTimeoutRef.current);
    }

    swapTimeoutRef.current = setTimeout(() => {
      const fromSubjectIndex = gridToSubjectIndex[fromGridIndex];
      const toSubjectIndex = gridToSubjectIndex[toGridIndex];

      const newSubjects = [...level.subjects];
      [newSubjects[fromSubjectIndex], newSubjects[toSubjectIndex]] = [
        newSubjects[toSubjectIndex],
        newSubjects[fromSubjectIndex],
      ];

      onSubjectsReorder(newSubjects, { from: fromSubjectIndex, to: toSubjectIndex });

      setTimeout(() => {
        setSwappingCells(null);
      }, 150);
    }, 50);
  };

  const handleDrop = (
    index: number,
    url?: string,
    cardId?: string,
    multiCardIds?: string[],
    files?: FileList
  ) => {
    const cellData = getCellData(index);
    onCardDrop(cellData.subjectIndex, url, cardId, multiCardIds, files);
  };

  const handleCellClick = (gridIndex: number) => {
    const cellData = getCellData(gridIndex);
    onCellClick(cellData.subjectIndex, cellData.label);
  };

  const totalCards = Object.values(cardsByCell).reduce((sum, cards) => sum + cards.length, 0);

  const getRippleOrigin = (gridIndex: number): { x: number; y: number } => {
    const positions: Record<number, { x: number; y: number }> = {
      0: { x: 0, y: 0 },
      1: { x: 50, y: 0 },
      2: { x: 100, y: 0 },
      3: { x: 0, y: 50 },
      5: { x: 100, y: 50 },
      6: { x: 0, y: 100 },
      7: { x: 50, y: 100 },
      8: { x: 100, y: 100 },
    };
    return positions[gridIndex] || { x: 50, y: 50 };
  };

  const handleNavigateToSubLevel = (gridIndex: number) => {
    const cellData = getCellData(gridIndex);
    if (cellData.isCenter) return;

    setRippleOrigin(getRippleOrigin(gridIndex));
    setTransitionDirection('out');
    setIsTransitioning(true);
    setTimeout(() => {
      onNavigateToSubLevel?.(cellData.label, gridIndex);
      setTransitionDirection('in');
      setTimeout(() => {
        setIsTransitioning(false);
        setRippleOrigin(null);
      }, 50);
    }, 700);
  };

  const handleNavigateBack = () => {
    if (!canGoBack || entryGridIndex === null) return;

    setTransitionDirection('out');
    setIsTransitioning(true);
    setTimeout(() => {
      onNavigateBack?.();
      setTransitionDirection('in');
      setTimeout(() => {
        setIsTransitioning(false);
      }, 50);
    }, 700);
  };

  const cellHasSubLevel = (gridIndex: number) => {
    if (canGoBack) return false;
    const cellData = getCellData(gridIndex);
    return !cellData.isCenter;
  };

  const arrowPositions = [
    { gridIndex: 0, style: 'top-2 left-2', rotation: -135, opposite: 8 },
    { gridIndex: 1, style: 'top-1 left-1/2 -translate-x-1/2', rotation: -90, opposite: 7 },
    { gridIndex: 2, style: 'top-2 right-2', rotation: -45, opposite: 6 },
    { gridIndex: 3, style: 'top-1/2 left-1 -translate-y-1/2', rotation: 180, opposite: 5 },
    { gridIndex: 5, style: 'top-1/2 right-1 -translate-y-1/2', rotation: 0, opposite: 3 },
    { gridIndex: 6, style: 'bottom-2 left-2', rotation: 135, opposite: 2 },
    { gridIndex: 7, style: 'bottom-1 left-1/2 -translate-x-1/2', rotation: 90, opposite: 1 },
    { gridIndex: 8, style: 'bottom-2 right-2', rotation: 45, opposite: 0 },
  ];

  const getBackArrowConfig = () => {
    if (!canGoBack || entryGridIndex === null) return null;
    const entryArrow = arrowPositions.find((a) => a.gridIndex === entryGridIndex);
    if (!entryArrow) return null;
    return arrowPositions.find((a) => a.gridIndex === entryArrow.opposite);
  };

  const backArrowConfig = getBackArrowConfig();

  const handleCenterDoubleClick = () => {
    setIsFlipped(!isFlipped);
  };

  return (
    <div className="w-full h-full flex flex-col">
      {/* Header with stats - hidden in floating mode */}
      {!hideHeader && (
        <div className="flex items-center justify-between px-1 pb-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">{t('mandala.title')}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
              {t('common.cards', { count: totalCards })}
            </span>
          </div>
        </div>
      )}

      {/* Grid Container */}
      <div
        ref={containerRef}
        className="relative overflow-visible flex-1"
        style={{ perspective: '1000px' }}
      >
        {/* Flip Container */}
        <div
          ref={gridRef}
          className="relative mx-auto transition-transform duration-700 ease-in-out"
          style={{
            width: '98cqmin',
            height: '98cqmin',
            transformStyle: 'preserve-3d',
            transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          {/* Ripple effect overlay */}
          {isTransitioning && rippleOrigin && (
            <div
              className="absolute inset-0 z-50 pointer-events-none overflow-hidden rounded-2xl"
              style={{ backfaceVisibility: 'hidden' }}
            >
              <div
                className={cn(
                  'absolute rounded-full bg-primary/20',
                  transitionDirection === 'out'
                    ? 'animate-[ripple-expand_700ms_ease-out_forwards]'
                    : 'animate-[ripple-contract_700ms_ease-out_forwards]'
                )}
                style={{
                  left: `${rippleOrigin.x}%`,
                  top: `${rippleOrigin.y}%`,
                  transform: 'translate(-50%, -50%)',
                  width: '300%',
                  height: '300%',
                }}
              />
            </div>
          )}

          {/* Front - Grid */}
          <div
            className={cn(
              'grid grid-cols-3 rounded-2xl relative w-full h-full',
              'bg-[hsl(var(--bg-sunken))] border border-border/20',
              'transition-[box-shadow,opacity] duration-300 ease-out',
              sizeMode === 'compact' && 'gap-[1%] p-[1.5%]',
              sizeMode === 'standard' && 'gap-[1.5%] p-[2%]',
              sizeMode === 'spacious' && 'gap-[2%] p-[2.5%]',
              isGridDropZone && 'ring-2 ring-primary/20',
              isCardDragActive &&
                !isGridDropZone &&
                'ring-1 ring-primary/30 shadow-[0_0_20px_-4px_hsl(var(--primary)/0.15)]'
            )}
            style={{
              boxShadow: isGridDropZone
                ? 'var(--shadow-xl)'
                : isCardDragActive
                  ? '0 0 24px -4px hsl(var(--primary) / 0.2), var(--shadow-inset-sunken)'
                  : 'var(--shadow-inset-sunken)',
              backfaceVisibility: 'hidden',
              transform: isTransitioning
                ? transitionDirection === 'out'
                  ? 'scale(0.8)'
                  : 'scale(1.1)'
                : 'scale(1)',
              opacity: isTransitioning && transitionDirection === 'out' ? 0 : 1,
              transformOrigin: rippleOrigin ? `${rippleOrigin.x}% ${rippleOrigin.y}%` : 'center',
            }}
          >
            {/* Back button - inside grid */}
            {backArrowConfig && !isFlipped && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleNavigateBack();
                }}
                aria-label={t('mandala.back')}
                className={cn(
                  'absolute z-40 group transition-all duration-300',
                  'hover:scale-110 active:scale-95',
                  backArrowConfig.style
                )}
              >
                <div className="relative flex items-center gap-1 px-2 py-0.5 rounded-full bg-card/95 backdrop-blur-md border border-border/50 shadow-md hover:shadow-lg hover:border-primary/30 transition-all duration-300">
                  <ChevronRight
                    className="w-2.5 h-2.5 text-muted-foreground group-hover:text-primary transition-colors"
                    style={{ transform: `rotate(${backArrowConfig.rotation}deg)` }}
                  />
                  <span className="text-[8px] font-medium text-muted-foreground group-hover:text-primary transition-colors">
                    {t('mandala.back')}
                  </span>
                </div>
              </button>
            )}
            {Array.from({ length: 9 }).map((_, gridIndex) => {
              const cellData = getCellData(gridIndex);
              const cellCards = cellData.isCenter ? [] : cardsByCell[cellData.subjectIndex] || [];
              const hasNav = cellHasSubLevel(gridIndex);

              return (
                <MandalaCell
                  key={gridIndex}
                  index={gridIndex}
                  label={cellData.label}
                  isCenter={cellData.isCenter}
                  cards={cellCards}
                  sizeMode={sizeMode}
                  isDropTarget={activeDragOverCellIndex === gridIndex}
                  isCellSwapTarget={
                    activeDragCellIndex !== null &&
                    activeDragOverCellIndex === gridIndex &&
                    activeDragCellIndex !== gridIndex
                  }
                  isSelected={selectedCellIndex === cellData.subjectIndex}
                  isSwapping={
                    swappingCells !== null &&
                    (swappingCells.from === gridIndex || swappingCells.to === gridIndex)
                  }
                  swapDirection={
                    swappingCells?.from === gridIndex
                      ? 'from'
                      : swappingCells?.to === gridIndex
                        ? 'to'
                        : null
                  }
                  onDrop={handleDrop}
                  onCellSwap={handleCellSwap}
                  onClick={() => handleCellClick(gridIndex)}
                  onDoubleClick={
                    cellData.isCenter
                      ? handleCenterDoubleClick
                      : hasNav
                        ? () => handleNavigateToSubLevel(gridIndex)
                        : undefined
                  }
                  onCardClick={onCardClick}
                  onCardDragStart={onCardDragStart}
                  hasSubLevel={hasNav}
                  onNavigateToSubLevel={() => handleNavigateToSubLevel(gridIndex)}
                />
              );
            })}
          </div>

          {/* Back - Statistics Dashboard */}
          <div
            className={cn(
              'absolute inset-0 p-4 rounded-2xl',
              'bg-gradient-to-br from-card/90 via-card to-card/80',
              'border border-border/20 shadow-lg'
            )}
            style={{
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}
          >
            <MandalaDashboard
              centerGoal={level.centerGoal}
              subjects={level.subjects}
              cardsByCell={cardsByCell}
              onFlipBack={handleCenterDoubleClick}
            />
          </div>
        </div>
      </div>

      {/* Hint */}
      {showHint && (
        <p className="text-xs text-center text-muted-foreground/60 flex-shrink-0 pt-1">
          {isFlipped ? t('mandala.hintFlipped') : t('mandala.hintDefault')}
        </p>
      )}
    </div>
  );
});
