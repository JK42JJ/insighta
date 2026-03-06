import { useState, useRef, memo } from 'react';
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
  hasSubLevel?: (subject: string) => boolean;
  onNavigateToSubLevel?: (subject: string, entryGridIndex: number) => void;
  onNavigateBack?: () => void;
  canGoBack?: boolean;
  entryGridIndex?: number | null;
  showHint?: boolean;
  hideHeader?: boolean;
  isCompact?: boolean;
}

export const MandalaGrid = memo(function MandalaGrid({
  level,
  cardsByCell,
  selectedCellIndex,
  onCellClick,
  onCardDrop,
  onCardClick,
  onCardDragStart,
  onSubjectsReorder,
  onCellDragging,
  isGridDropZone,
  hasSubLevel,
  onNavigateToSubLevel,
  onNavigateBack,
  canGoBack = false,
  entryGridIndex = null,
  showHint = true,
  hideHeader = false,
  isCompact = false,
}: MandalaGridProps) {
  const { t } = useTranslation();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionDirection, setTransitionDirection] = useState<'in' | 'out'>('in');
  const [rippleOrigin, setRippleOrigin] = useState<{ x: number; y: number } | null>(null);
  const [activeDropCell, setActiveDropCell] = useState<number | null>(null);
  const [activeCellSwapTarget, setActiveCellSwapTarget] = useState<number | null>(null);
  const [draggingCellIndex, setDraggingCellIndex] = useState<number | null>(null);
  const [swappingCells, setSwappingCells] = useState<{ from: number; to: number } | null>(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const swapTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

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

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (index !== 4) {
      setActiveDropCell(index);
    }
  };

  const handleCellDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (index !== 4 && draggingCellIndex !== null && draggingCellIndex !== index) {
      setActiveCellSwapTarget(index);
    }
  };

  const handleDragLeave = () => {
    setActiveDropCell(null);
    setActiveCellSwapTarget(null);
  };

  const handleCellDragStart = (gridIndex: number) => {
    setDraggingCellIndex(gridIndex);
    onCellDragging?.(true);
  };

  const handleCellDragEnd = () => {
    setDraggingCellIndex(null);
    setActiveCellSwapTarget(null);
    onCellDragging?.(false);
  };

  const handleCellSwap = (fromGridIndex: number, toGridIndex: number) => {
    setActiveCellSwapTarget(null);
    setDraggingCellIndex(null);
    onCellDragging?.(false);

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
    setActiveDropCell(null);
    setActiveCellSwapTarget(null);
    setDraggingCellIndex(null);
    const cellData = getCellData(index);
    onCardDrop(cellData.subjectIndex, url, cardId, multiCardIds, files);
  };

  const handleCellClick = (gridIndex: number) => {
    const cellData = getCellData(gridIndex);
    onCellClick(cellData.subjectIndex, cellData.label);
  };

  const totalCards = Object.values(cardsByCell).reduce((sum, cards) => sum + cards.length, 0);

  const [slideDirection, setSlideDirection] = useState<string>('right');

  const getSlideDirection = (gridIndex: number): string => {
    const directions: Record<number, string> = {
      0: 'top-left',
      1: 'top',
      2: 'top-right',
      3: 'left',
      5: 'right',
      6: 'bottom-left',
      7: 'bottom',
      8: 'bottom-right',
    };
    return directions[gridIndex] || 'right';
  };

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

    setSlideDirection(getSlideDirection(gridIndex));
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

    const entryDirection = getSlideDirection(entryGridIndex);
    const oppositeDirections: Record<string, string> = {
      'top-left': 'bottom-right',
      top: 'bottom',
      'top-right': 'bottom-left',
      left: 'right',
      right: 'left',
      'bottom-left': 'top-right',
      bottom: 'top',
      'bottom-right': 'top-left',
    };
    setSlideDirection(oppositeDirections[entryDirection] || 'left');
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
    <div className="space-y-3">
      {/* Header with stats - hidden in floating mode */}
      {!hideHeader && (
        <div className="flex items-center justify-between px-1">
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
      <div className="relative p-4 overflow-visible" style={{ perspective: '1000px' }}>
        {/* Flip Container */}
        <div
          ref={gridRef}
          className={cn(
            'relative w-full mx-auto transition-transform duration-700 ease-in-out',
            isCompact ? 'max-w-[400px]' : 'max-w-[400px]'
          )}
          style={{
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
              'aspect-square w-full grid grid-cols-3 gap-2 md:gap-3 p-4 md:p-5 rounded-2xl relative',
              'bg-surface-mid border border-border/30',
              'transition-all duration-700 ease-in-out',
              isGridDropZone && 'ring-4 ring-primary/30 ring-offset-4 ring-offset-background'
            )}
            style={{
              boxShadow: isGridDropZone ? 'var(--shadow-xl)' : 'var(--shadow-md)',
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
            {/* Navigation Arrows - inside grid */}
            {!isFlipped &&
              arrowPositions.map(({ gridIndex, style, rotation }) => {
                const hasNav = cellHasSubLevel(gridIndex);
                if (!hasNav) return null;
                const cellData = getCellData(gridIndex);

                return (
                  <button
                    key={`arrow-${gridIndex}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNavigateToSubLevel(gridIndex);
                    }}
                    aria-label={`${t('mandala.navigateToSub', { subject: cellData.label })}`}
                    className={cn(
                      'absolute z-40 group transition-all duration-300',
                      'hover:scale-110 active:scale-95',
                      style
                    )}
                  >
                    <div className="relative">
                      <div className="w-2 h-2 rounded-full bg-primary/40 group-hover:bg-transparent transition-all duration-300 group-hover:scale-0 shadow-sm" />
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-card/95 backdrop-blur-md border border-primary/40 shadow-md opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all duration-300 whitespace-nowrap">
                        <span className="text-[8px] font-medium text-primary max-w-[50px] truncate">
                          {cellData.label}
                        </span>
                        <ChevronRight
                          className="w-2.5 h-2.5 text-primary flex-shrink-0"
                          style={{ transform: `rotate(${rotation}deg)` }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}

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
                  isDropTarget={activeDropCell === gridIndex}
                  isCellSwapTarget={activeCellSwapTarget === gridIndex}
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
                  onDoubleClick={cellData.isCenter ? handleCenterDoubleClick : undefined}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onCardClick={onCardClick}
                  onCardDragStart={onCardDragStart}
                  onCellDragStart={handleCellDragStart}
                  onCellDragEnd={handleCellDragEnd}
                  onCellDragOver={handleCellDragOver}
                  hasSubLevel={hasNav}
                  onNavigateToSubLevel={() => handleNavigateToSubLevel(gridIndex)}
                />
              );
            })}
          </div>

          {/* Back - Statistics Dashboard */}
          <div
            className={cn(
              'aspect-square w-full absolute top-0 left-0 p-4 rounded-2xl',
              'bg-gradient-to-br from-card/90 via-card to-card/80',
              'border border-border/30 shadow-lg'
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
        <p className="text-xs text-center text-muted-foreground/60">
          {isFlipped ? t('mandala.hintFlipped') : t('mandala.hintDefault')}
        </p>
      )}
    </div>
  );
});
