import { useState, useRef, useEffect, useCallback, forwardRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useDroppable } from '@dnd-kit/core';
import { useSortable, SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { InsightCard } from '@/entities/card/model/types';
import { type DragData, type DropData, cardDragId } from '@/shared/lib/dnd';
import { extractUrlFromDragData, extractUrlFromHtml } from '@/shared/data/mockData';
import {
  Lightbulb,
  Plus,
  ExternalLink,
  Minimize2,
  Maximize2,
  GripHorizontal,
  GripVertical,
  X,
  Move,
  Check,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Play,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import {
  format,
  differenceInHours,
  differenceInDays,
  differenceInWeeks,
  differenceInMonths,
} from 'date-fns';
import { Button } from '@/shared/ui/button';
import { useDragSelect } from '@/features/drag-select/model/useDragSelect';
import { useTranslation } from 'react-i18next';

export type DockPosition = 'top' | 'bottom' | 'left' | 'right';

interface FloatingScratchPadProps {
  cards: InsightCard[];
  isDropTarget: boolean;
  onDrop: (url: string) => void;
  onCardDrop: (cardId: string) => void;
  onMultiCardDrop?: (cardIds: string[]) => void;
  onCardClick: (card: InsightCard) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDeleteCards?: (cardIds: string[]) => void;
  onFileDrop?: (files: FileList) => void;
  isFloating: boolean;
  onToggleFloating: () => void;
  dockPosition?: DockPosition;
  onDockPositionChange?: (position: DockPosition) => void;
  initialPosition?: { x: number; y: number };
  onPositionChange?: (x: number, y: number) => void;
}

function getTimeLabel(
  date: Date,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const now = new Date();
  const hours = differenceInHours(now, date);
  const days = differenceInDays(now, date);
  const weeks = differenceInWeeks(now, date);
  const months = differenceInMonths(now, date);

  if (hours < 1) return t('time.justNow');
  if (hours < 24) return t('time.hoursAgo', { count: hours });
  if (days < 7) return t('time.daysAgo', { count: days });
  if (weeks < 4) return t('time.weeksAgo', { count: weeks });
  if (months < 12) return t('time.monthsAgo', { count: months });
  return format(date, 'yy.MM');
}

function SortableScratchCard({
  card,
  selectedCardIds,
  children,
}: {
  card: InsightCard;
  selectedCardIds: Set<string>;
  children: (props: {
    isDragging: boolean;
    dragRef: (node: HTMLElement | null) => void;
    dragListeners: ReturnType<typeof useSortable>['listeners'];
    dragAttributes: ReturnType<typeof useSortable>['attributes'];
    style: React.CSSProperties;
  }) => React.ReactNode;
}) {
  const multiIds =
    selectedCardIds.has(card.id) && selectedCardIds.size > 1
      ? Array.from(selectedCardIds)
      : undefined;
  const dragData: DragData = { type: 'card', card, selectedCardIds: multiIds, source: 'scratchpad' };
  const { attributes, listeners, setNodeRef, isDragging, transform, transition } = useSortable({
    id: cardDragId(card.id),
    data: dragData,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <>
      {children({
        isDragging,
        dragRef: setNodeRef,
        dragListeners: listeners,
        dragAttributes: attributes,
        style,
      })}
    </>
  );
}

const DOCK_THRESHOLD = 80;
const SIDE_DOCK_THRESHOLD = 100;

const STORAGE_KEY_SIZE = 'insighta:ideation:size';
const STORAGE_KEY_POS = 'insighta:ideation:position';
const STORAGE_KEY_DOCK_H_HEIGHT = 'insighta:ideation:dock-h-height';
const STORAGE_KEY_DOCK_V_WIDTH = 'insighta:ideation:dock-v-width';

const DEFAULT_DOCK_H_HEIGHT = 64;
const MIN_DOCK_H_HEIGHT = 48;
const MAX_DOCK_H_HEIGHT = 300;
const DEFAULT_DOCK_V_WIDTH = 90;
const MIN_DOCK_V_WIDTH = 60;
const MAX_DOCK_V_WIDTH = 300;

function loadDockedHeight(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_DOCK_H_HEIGHT);
    if (saved) {
      const n = parseInt(saved, 10);
      if (!isNaN(n)) return Math.max(MIN_DOCK_H_HEIGHT, Math.min(MAX_DOCK_H_HEIGHT, n));
    }
  } catch { /* ignore */ }
  return DEFAULT_DOCK_H_HEIGHT;
}

function loadDockedWidth(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_DOCK_V_WIDTH);
    if (saved) {
      const n = parseInt(saved, 10);
      if (!isNaN(n)) return Math.max(MIN_DOCK_V_WIDTH, Math.min(MAX_DOCK_V_WIDTH, n));
    }
  } catch { /* ignore */ }
  return DEFAULT_DOCK_V_WIDTH;
}

function loadPersistedSize(): { width: number; height: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SIZE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
        return parsed;
      }
    }
  } catch {
    /* ignore */
  }
  return { width: 320, height: 320 };
}

function loadPersistedPosition(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return parsed;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export const FloatingScratchPad = forwardRef<HTMLDivElement, FloatingScratchPadProps>(
  function FloatingScratchPad(
    {
      cards,
      isDropTarget,
      onDrop,
      onCardDrop,
      onMultiCardDrop,
      onCardClick,
      onDragOver,
      onDragLeave,
      onDeleteCards,
      onFileDrop,
      isFloating,
      onToggleFloating,
      dockPosition = 'top',
      onDockPositionChange,
      initialPosition,
      onPositionChange,
    }: FloatingScratchPadProps,
    forwardedRef
  ) {
    const { t } = useTranslation();
    const [position, setPosition] = useState(
      () => initialPosition ?? loadPersistedPosition() ?? { x: 100, y: 100 }
    );
    useEffect(() => {
      if (initialPosition && !isDragging) {
        setPosition(initialPosition);
      }
    }, [initialPosition?.x, initialPosition?.y]); // eslint-disable-line react-hooks/exhaustive-deps
    const [size, setSize] = useState(loadPersistedSize);
    const [dockHHeight, setDockHHeight] = useState(loadDockedHeight);
    const [dockVWidth, setDockVWidth] = useState(loadDockedWidth);
    const [isMinimized, setIsMinimized] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [isDockedDragging, setIsDockedDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [_isDockResizing, setIsDockResizing] = useState(false);
    const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
    const selectedCardIdsRef = useRef<Set<string>>(new Set());
    const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

    // Keep ref in sync for use in native event handlers (capture phase)
    useEffect(() => {
      selectedCardIdsRef.current = selectedCardIds;
    }, [selectedCardIds]);
    const [pendingDock, setPendingDock] = useState<DockPosition | null>(null);
    const [isAnimating, setIsAnimating] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const dockedRef = useRef<HTMLDivElement | null>(null);
    const floatingContentRef = useRef<HTMLDivElement | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const dragStartRef = useRef({ x: 0, y: 0 });
    const initialPosRef = useRef({ x: 0, y: 0 });
    const initialSizeRef = useRef({ width: 0, height: 0 });
    const rafRef = useRef<number | null>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);
    const [canScrollUp, setCanScrollUp] = useState(false);
    const [canScrollDown, setCanScrollDown] = useState(false);
    const verticalScrollRef = useRef<HTMLDivElement | null>(null);

    // dnd-kit droppable for receiving cards from CardList/MandalaGrid
    const scratchpadDropData: DropData = { type: 'scratchpad' };
    const { setNodeRef: setDndDropRef, isOver: isDndDropOver } = useDroppable({
      id: 'drop-scratchpad',
      data: scratchpadDropData,
    });

    const setForwardedRef = useCallback(
      (node: HTMLDivElement | null) => {
        if (!forwardedRef) return;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else forwardedRef.current = node;
      },
      [forwardedRef]
    );

    const setDockedElRef = useCallback(
      (node: HTMLDivElement | null) => {
        dockedRef.current = node;
        setForwardedRef(node);
        setDndDropRef(node);
      },
      [setForwardedRef, setDndDropRef]
    );

    const setFloatingElRef = useCallback(
      (node: HTMLDivElement | null) => {
        containerRef.current = node;
        setForwardedRef(node);
        setDndDropRef(node);
      },
      [setForwardedRef, setDndDropRef]
    );

    const lastScrollTimeRef = useRef<number>(0);
    const consecutiveClicksRef = useRef<number>(0);
    const CLICK_TIMEOUT = 400;
    const MAX_ACCELERATION = 3;

    const sortedCards = useMemo(
      () =>
        [...cards].sort((a, b) => {
          if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
          if (a.sortOrder != null) return -1;
          if (b.sortOrder != null) return 1;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }),
      [cards]
    );

    const sortableIds = useMemo(
      () => sortedCards.map((c) => cardDragId(c.id)),
      [sortedCards]
    );

    const handleDragSelectChange = useCallback(
      (selectedIndices: number[]) => {
        const newSelectedIds = new Set(
          selectedIndices.map((idx) => sortedCards[idx]?.id).filter(Boolean)
        );
        setSelectedCardIds(newSelectedIds);
      },
      [sortedCards]
    );

    const { selectionStyle, justFinishedDrag: justFinishedLasso } = useDragSelect({
      containerRef: floatingContentRef,
      itemSelector: '[data-card-item]',
      onSelectionChange: handleDragSelectChange,
      enabled: isFloating,
    });

    const isHorizontalDock = dockPosition === 'top' || dockPosition === 'bottom';
    const isVerticalDock = dockPosition === 'left' || dockPosition === 'right';

    // Combine HTML5 isDropTarget with dnd-kit isOver for visual feedback
    const isActiveDropTarget = isDropTarget || isDndDropOver;

    const detectDockPosition = useCallback(
      (clientX: number, clientY: number): DockPosition | null => {
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        if (clientX < SIDE_DOCK_THRESHOLD) return 'left';
        if (clientX > windowWidth - SIDE_DOCK_THRESHOLD) return 'right';
        if (clientY < DOCK_THRESHOLD) return 'top';
        if (clientY > windowHeight - DOCK_THRESHOLD) return 'bottom';
        return null;
      },
      []
    );

    const handleDragMouseDown = (e: React.MouseEvent) => {
      if (!isFloating) return;
      e.preventDefault();
      e.stopPropagation();
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      initialPosRef.current = { ...position };
      setIsDragging(true);
      setPendingDock(null);
    };

    const handleDockedDragMouseDown = (e: React.MouseEvent) => {
      if (isFloating) return;
      e.preventDefault();
      e.stopPropagation();
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      setIsDockedDragging(true);
      setPendingDock(null);
    };

    const handleDockResizeStart = useCallback((e: React.MouseEvent, axis: 'height' | 'width') => {
      e.preventDefault();
      e.stopPropagation();
      const startPos = axis === 'height' ? e.clientY : e.clientX;
      const container = (e.currentTarget as HTMLElement).closest('[data-dock-container]') as HTMLElement | null;
      if (!container) return;
      const startSize = axis === 'height'
        ? container.getBoundingClientRect().height
        : container.getBoundingClientRect().width;

      container.style.transition = 'none';
      setIsDockResizing(true);

      const onMouseMove = (ev: MouseEvent) => {
        const delta = (axis === 'height' ? ev.clientY : ev.clientX) - startPos;
        const min = axis === 'height' ? MIN_DOCK_H_HEIGHT : MIN_DOCK_V_WIDTH;
        const max = axis === 'height' ? MAX_DOCK_H_HEIGHT : MAX_DOCK_V_WIDTH;
        const newSize = Math.max(min, Math.min(max, startSize + delta));
        if (axis === 'height') {
          container.style.height = `${newSize}px`;
        } else {
          container.style.width = `${newSize}px`;
        }
      };

      const onMouseUp = (ev: MouseEvent) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        container.style.transition = '';
        setIsDockResizing(false);

        const delta = (axis === 'height' ? ev.clientY : ev.clientX) - startPos;
        const min = axis === 'height' ? MIN_DOCK_H_HEIGHT : MIN_DOCK_V_WIDTH;
        const max = axis === 'height' ? MAX_DOCK_H_HEIGHT : MAX_DOCK_V_WIDTH;
        const finalSize = Math.max(min, Math.min(max, startSize + delta));

        if (axis === 'height') {
          setDockHHeight(finalSize);
          try { localStorage.setItem(STORAGE_KEY_DOCK_H_HEIGHT, String(finalSize)); } catch { /* ignore */ }
        } else {
          setDockVWidth(finalSize);
          try { localStorage.setItem(STORAGE_KEY_DOCK_V_WIDTH, String(finalSize)); } catch { /* ignore */ }
        }
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = axis === 'height' ? 'row-resize' : 'col-resize';
      document.body.style.userSelect = 'none';
    }, []);

    const handleDockResizeDoubleClick = useCallback((axis: 'height' | 'width') => {
      if (axis === 'height') {
        setDockHHeight(DEFAULT_DOCK_H_HEIGHT);
        try { localStorage.setItem(STORAGE_KEY_DOCK_H_HEIGHT, String(DEFAULT_DOCK_H_HEIGHT)); } catch { /* ignore */ }
      } else {
        setDockVWidth(DEFAULT_DOCK_V_WIDTH);
        try { localStorage.setItem(STORAGE_KEY_DOCK_V_WIDTH, String(DEFAULT_DOCK_V_WIDTH)); } catch { /* ignore */ }
      }
    }, []);

    const handleResizeMouseDown = (e: React.MouseEvent) => {
      if (!isFloating) return;
      e.preventDefault();
      e.stopPropagation();
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      initialSizeRef.current = { ...size };
      setIsResizing(true);
    };

    useEffect(() => {
      if (!isDragging && !isResizing) return;

      const handleMouseMove = (e: MouseEvent) => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          if (isDragging) {
            const dx = e.clientX - dragStartRef.current.x;
            const dy = e.clientY - dragStartRef.current.y;
            const newX = Math.max(
              0,
              Math.min(window.innerWidth - 100, initialPosRef.current.x + dx)
            );
            const newY = Math.max(
              0,
              Math.min(window.innerHeight - 50, initialPosRef.current.y + dy)
            );
            setPosition({ x: newX, y: newY });
            const dock = detectDockPosition(e.clientX, e.clientY);
            setPendingDock(dock);
          }
          if (isResizing) {
            const dx = e.clientX - dragStartRef.current.x;
            const dy = e.clientY - dragStartRef.current.y;
            const newWidth = Math.max(320, Math.min(800, initialSizeRef.current.width + dx));
            const newHeight = Math.max(140, Math.min(500, initialSizeRef.current.height + dy));
            setSize({ width: newWidth, height: newHeight });
          }
        });
      };

      const handleMouseUp = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        if (isDragging && pendingDock) {
          setIsAnimating(true);
          onDockPositionChange?.(pendingDock);
          onToggleFloating();
          setTimeout(() => setIsAnimating(false), 300);
        } else if (isDragging) {
          onPositionChange?.(position.x, position.y);
          try {
            localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(position));
          } catch { /* ignore */ }
        }
        if (isResizing) {
          try {
            localStorage.setItem(STORAGE_KEY_SIZE, JSON.stringify(size));
          } catch { /* ignore */ }
        }
        setIsDragging(false);
        setIsResizing(false);
        setPendingDock(null);
      };

      document.addEventListener('mousemove', handleMouseMove, { passive: true });
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }, [
      isDragging,
      isResizing,
      pendingDock,
      detectDockPosition,
      onDockPositionChange,
      onToggleFloating,
      position.x,
      position.y,
      onPositionChange,
    ]);

    useEffect(() => {
      if (!isDockedDragging) return;
      const handleMouseMove = (e: MouseEvent) => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          const dock = detectDockPosition(e.clientX, e.clientY);
          setPendingDock(dock);
        });
      };
      const handleMouseUp = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        if (pendingDock && pendingDock !== dockPosition) {
          setIsAnimating(true);
          onDockPositionChange?.(pendingDock);
          setTimeout(() => setIsAnimating(false), 300);
        }
        setIsDockedDragging(false);
        setPendingDock(null);
      };
      document.addEventListener('mousemove', handleMouseMove, { passive: true });
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }, [isDockedDragging, pendingDock, dockPosition, detectDockPosition, onDockPositionChange]);

    useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as Node;
        const activeRef = isFloating ? containerRef.current : dockedRef.current;
        if (!activeRef) return;
        if (!activeRef.contains(target)) {
          // Finder pattern: if cards are selected, consume the click (deselect only, no action)
          if (selectedCardIdsRef.current.size > 0) {
            e.stopPropagation();
            e.preventDefault();
          }
          setSelectedCardIds(new Set());
          setLastSelectedIndex(null);
        }
      };
      // Capture phase — fires BEFORE grid card onClick
      document.addEventListener('click', handleClickOutside, true);
      return () => document.removeEventListener('click', handleClickOutside, true);
    }, [isFloating]);

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      onDragOver(e);
    };

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onFileDrop?.(e.dataTransfer.files);
        return;
      }
      const multiCardIdsData = e.dataTransfer.getData('application/multi-card-ids');
      if (multiCardIdsData) {
        try {
          const multiCardIds = JSON.parse(multiCardIdsData) as string[];
          onMultiCardDrop?.(multiCardIds);
          return;
        } catch (_err) {
          // Fall through
        }
      }
      const cardId = e.dataTransfer.getData('application/card-id');
      if (cardId) {
        onCardDrop(cardId);
        return;
      }
      const rawUrl =
        e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      let url = rawUrl ? extractUrlFromDragData(rawUrl) : null;
      // Fallback: text/html에서 href 추출
      if (!url) {
        const html = e.dataTransfer.getData('text/html');
        if (html) url = extractUrlFromHtml(html);
      }
      if (url) {
        onDrop(url);
      }
    };

    const handleCardClick = (e: React.MouseEvent, card: InsightCard, cardIndex: number) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        // Ctrl+Shift+Click: range selection
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
        // Ctrl+Click: toggle selection
        e.preventDefault();
        e.stopPropagation();
        setSelectedCardIds((prev) => {
          const next = new Set(prev);
          if (next.has(card.id)) next.delete(card.id);
          else next.add(card.id);
          return next;
        });
        setLastSelectedIndex(cardIndex);
      } else {
        // Plain click — Finder/Photos selection model
        e.stopPropagation();
        const hasSelection = selectedCardIds.size > 0;
        const isCurrentlySelected = selectedCardIds.has(card.id);

        if (hasSelection) {
          if (isCurrentlySelected) {
            // Clicking a selected card while in selection mode → no-op
            return;
          }
          // Clicking an unselected card while in selection mode → deselect all, wait
          setSelectedCardIds(new Set());
          setLastSelectedIndex(null);
        } else {
          // No selection → normal card open
          onCardClick(card);
        }
      }
    };

    const handleContainerClick = (e: React.MouseEvent) => {
      if (justFinishedLasso) return;
      if (e.target === e.currentTarget) {
        setSelectedCardIds(new Set());
      }
    };

    const checkScrollPosition = useCallback(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const { scrollLeft, scrollWidth, clientWidth } = container;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1);
    }, []);

    const checkVerticalScrollPosition = useCallback(() => {
      const container = verticalScrollRef.current;
      if (!container) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      setCanScrollUp(scrollTop > 0);
      setCanScrollDown(scrollTop < scrollHeight - clientHeight - 1);
    }, []);

    const getAccelerationMultiplier = useCallback(() => {
      const now = Date.now();
      const timeSinceLastClick = now - lastScrollTimeRef.current;
      if (timeSinceLastClick < CLICK_TIMEOUT) {
        consecutiveClicksRef.current = Math.min(consecutiveClicksRef.current + 1, MAX_ACCELERATION);
      } else {
        consecutiveClicksRef.current = 1;
      }
      lastScrollTimeRef.current = now;
      return consecutiveClicksRef.current;
    }, []);

    const scrollByAmount = useCallback(
      (direction: 'left' | 'right') => {
        const container = scrollContainerRef.current;
        if (!container) return;
        const multiplier = getAccelerationMultiplier();
        const baseScrollAmount = container.clientWidth / 3;
        const scrollAmount = baseScrollAmount * multiplier;
        container.scrollBy({
          left: direction === 'left' ? -scrollAmount : scrollAmount,
          behavior: 'smooth',
        });
      },
      [getAccelerationMultiplier]
    );

    const scrollVerticalByAmount = useCallback(
      (direction: 'up' | 'down') => {
        const container = verticalScrollRef.current;
        if (!container) return;
        const multiplier = getAccelerationMultiplier();
        const baseScrollAmount = container.clientHeight / 3;
        const scrollAmount = baseScrollAmount * multiplier;
        container.scrollBy({
          top: direction === 'up' ? -scrollAmount : scrollAmount,
          behavior: 'smooth',
        });
      },
      [getAccelerationMultiplier]
    );

    useEffect(() => {
      checkScrollPosition();
      const container = scrollContainerRef.current;
      if (container) {
        container.addEventListener('scroll', checkScrollPosition);
        return () => container.removeEventListener('scroll', checkScrollPosition);
      }
    }, [cards.length, checkScrollPosition, isFloating, dockPosition]);

    useEffect(() => {
      checkVerticalScrollPosition();
      const container = verticalScrollRef.current;
      if (container) {
        container.addEventListener('scroll', checkVerticalScrollPosition);
        return () => container.removeEventListener('scroll', checkVerticalScrollPosition);
      }
    }, [cards.length, checkVerticalScrollPosition, isFloating, dockPosition]);

    const HEADER_HEIGHT = 72;

    const DockZoneIndicators = forwardRef<HTMLDivElement>(function DockZoneIndicators(_props, ref) {
      if (!pendingDock) return null;
      const indicators = (
        <div
          ref={ref}
          className="dock-zone-indicators"
          style={{ position: 'fixed', inset: 0, zIndex: 99999, pointerEvents: 'none' }}
        >
          <div
            className={cn(
              'absolute left-0 right-0 transition-all duration-300 ease-out',
              pendingDock === 'top' ? 'opacity-100' : 'opacity-0'
            )}
            style={{ top: `${HEADER_HEIGHT}px`, height: '2px' }}
          >
            <div
              className="h-full w-full"
              style={{
                background: 'hsl(var(--primary) / 0.35)',
                boxShadow: '0 1px 6px 0 hsl(var(--primary) / 0.15)',
              }}
            />
          </div>
          <div
            className={cn(
              'absolute bottom-0 left-0 right-0 transition-all duration-300 ease-out',
              pendingDock === 'bottom' ? 'opacity-100' : 'opacity-0'
            )}
            style={{ height: '2px' }}
          >
            <div
              className="h-full w-full"
              style={{
                background: 'hsl(var(--primary) / 0.35)',
                boxShadow: '0 -1px 6px 0 hsl(var(--primary) / 0.15)',
              }}
            />
          </div>
          <div
            className={cn(
              'absolute left-0 transition-all duration-300 ease-out',
              pendingDock === 'left' ? 'opacity-100' : 'opacity-0'
            )}
            style={{ top: `${HEADER_HEIGHT}px`, bottom: 0, width: '2px' }}
          >
            <div
              className="h-full w-full"
              style={{
                background: 'hsl(var(--primary) / 0.35)',
                boxShadow: '1px 0 6px 0 hsl(var(--primary) / 0.15)',
              }}
            />
          </div>
          <div
            className={cn(
              'absolute right-0 transition-all duration-300 ease-out',
              pendingDock === 'right' ? 'opacity-100' : 'opacity-0'
            )}
            style={{ top: `${HEADER_HEIGHT}px`, bottom: 0, width: '2px' }}
          >
            <div
              className="h-full w-full"
              style={{
                background: 'hsl(var(--primary) / 0.35)',
                boxShadow: '-1px 0 6px 0 hsl(var(--primary) / 0.15)',
              }}
            />
          </div>
        </div>
      );
      return createPortal(indicators, document.body);
    });

    const renderCardItem = (card: InsightCard, idx: number, isCompact: boolean = false) => {
      const isSelected = selectedCardIds.has(card.id);
      const cardSize = isCompact ? 'w-14 h-8' : 'w-20 h-[45px]';
      const timeSize = isCompact ? 'text-[6px]' : 'text-[8px]';
      const checkSize = isCompact ? 'w-2 h-2' : 'w-2.5 h-2.5';

      return (
        <SortableScratchCard key={card.id} card={card} selectedCardIds={selectedCardIds}>
          {({ isDragging: isDragActive, dragRef, dragListeners, dragAttributes, style: sortableStyle }) => {
            // ScratchPad cards: entire card is always draggable (cards are small,
            // grip handle is impractical at 56x32px). PointerSensor distance:5
            // ensures clicks still work (no movement = click, 5px+ = drag).
            return (
            <div
              ref={dragRef}
              style={sortableStyle}
              {...dragAttributes}
              {...dragListeners}
              data-card-item
              data-dnd-draggable=""
              data-selected={isSelected || undefined}
              onClick={(e) => handleCardClick(e, card, idx)}
              className={cn(
                'group relative flex-shrink-0 transition-transform hover:-translate-y-0.5 rounded-sm cursor-grab active:cursor-grabbing',
                isSelected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
                isDragActive && 'opacity-30'
              )}
            >
              <div
                className={cn('relative overflow-hidden bg-muted rounded-sm', cardSize)}
                style={{ boxShadow: 'var(--shadow-sm)' }}
              >
                <img
                  src={card.thumbnail}
                  alt={card.title}
                  draggable={false}
                  className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                  loading="lazy"
                />
                <span
                  className={cn(
                    'absolute bottom-0 right-0 bg-background/90 text-foreground px-0.5 font-medium',
                    timeSize
                  )}
                >
                  {getTimeLabel(new Date(card.createdAt), t)}
                </span>
                {isSelected && (
                  <div
                    className="absolute top-0.5 left-0.5 bg-primary rounded-full p-0.5 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCardIds((prev) => {
                        const next = new Set(prev);
                        next.delete(card.id);
                        return next;
                      });
                    }}
                  >
                    <Check
                      className={checkSize}
                      style={{ color: 'hsl(var(--primary-foreground))' }}
                    />
                  </div>
                )}
                {!isCompact && (
                  <a
                    href={card.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-0.5 right-0.5 z-10 bg-background/90 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity text-primary"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
            </div>
          );
          }}
        </SortableScratchCard>
      );
    };

    // Non-floating (docked) mode - Horizontal layout (top, bottom)
    if (!isFloating && isHorizontalDock) {
      const isTop = dockPosition === 'top';
      return (
        <>
          {isDockedDragging && <DockZoneIndicators />}
          <div
            className={cn(
              'flex w-full transition-all duration-300 justify-center',
              isAnimating && 'animate-fade-in'
            )}
          >
            <div
              ref={setDockedElRef}
              data-dock-container
              className={cn(
                'relative transition-all duration-300 w-full rounded-md',
                'bg-surface-mid/95 backdrop-blur-sm',
                isTop ? 'border-b border-border/50' : 'border-t border-border/50',
                isActiveDropTarget && 'border-2 border-dashed border-primary bg-primary/5',
                isDockedDragging && 'opacity-50'
              )}
              style={{ height: `${dockHHeight}px`, boxShadow: isActiveDropTarget ? 'var(--shadow-sm)' : 'none' }}
              onDragOver={handleDragOver}
              onDragLeave={onDragLeave}
              onDrop={handleDrop}
            >
              {isActiveDropTarget && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-primary/10 backdrop-blur-[1px] pointer-events-none z-10 gap-1">
                  <div
                    className="rounded-md border border-dashed border-primary/40 bg-primary/10 flex items-center justify-center"
                    style={{ width: '52px', aspectRatio: '16/9', animation: 'card-silhouette-pulse 1.5s ease-in-out infinite' }}
                  >
                    <Play className="w-3 h-3 text-primary/40" />
                  </div>
                  <span className="text-primary-foreground/80 font-medium text-[9px]">
                    {t('ideation.dropToAdd')}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-3 px-3 py-1.5">
                <div
                  className="flex items-center gap-2 flex-shrink-0 cursor-grab active:cursor-grabbing select-none"
                  onMouseDown={handleDockedDragMouseDown}
                >
                  <GripHorizontal className="w-3 h-3 text-muted-foreground/40" />
                  <div className="flex items-center gap-1.5">
                    <Lightbulb className="w-3.5 h-3.5 text-primary/80" />
                    <span className="text-xs font-medium text-foreground/80">
                      {t('ideation.title')}
                    </span>
                    {cards.length > 0 && (
                      <span className="text-[10px] text-primary/70 font-medium bg-primary/10 px-1.5 py-0.5 rounded-full">
                        {cards.length}
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-4 w-px bg-border/40 flex-shrink-0" />
                <button
                  onClick={() => scrollByAmount('left')}
                  className={cn(
                    'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200',
                    'bg-surface-base/80 hover:bg-surface-base border border-border/50',
                    'text-muted-foreground hover:text-foreground',
                    canScrollLeft ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  )}
                  style={{ boxShadow: 'var(--shadow-sm)' }}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div
                  ref={scrollContainerRef}
                  className="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 scroll-smooth"
                  onClick={handleContainerClick}
                >
                  <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
                    {cards.length === 0 ? (
                      <div className="flex items-center gap-1.5 text-muted-foreground/60">
                        <Plus className="w-3 h-3" />
                        <span className="text-xs">{t('ideation.emptyHint')}</span>
                      </div>
                    ) : (
                      sortedCards.map((card, idx) => renderCardItem(card, idx, true))
                    )}
                  </SortableContext>
                </div>
                <button
                  onClick={() => scrollByAmount('right')}
                  className={cn(
                    'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200',
                    'bg-surface-base/80 hover:bg-surface-base border border-border/50',
                    'text-muted-foreground hover:text-foreground',
                    canScrollRight ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  )}
                  style={{ boxShadow: 'var(--shadow-sm)' }}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 flex-shrink-0"
                  onClick={onToggleFloating}
                  title={t('mandala.switchToFloating')}
                >
                  <Move className="w-3 h-3" />
                </Button>
              </div>
              {/* Resize handle — bottom edge */}
              <div
                className="absolute bottom-0 left-0 w-full h-1 cursor-row-resize hover:bg-primary/20 active:bg-primary/30 transition-colors z-50"
                onMouseDown={(e) => handleDockResizeStart(e, 'height')}
                onDoubleClick={() => handleDockResizeDoubleClick('height')}
              />
            </div>
          </div>
        </>
      );
    }

    // Non-floating (docked) mode - Vertical layout (left, right)
    if (!isFloating && isVerticalDock) {
      return (
        <>
          {isDockedDragging && <DockZoneIndicators />}
          <div
            ref={setDockedElRef}
            className={cn(
              'relative transition-all duration-300 h-full',
              'bg-surface-light/80',
              dockPosition === 'left' ? 'border-r border-border/40' : 'border-l border-border/40',
              isActiveDropTarget && 'border-2 border-dashed border-primary bg-primary/5',
              isDockedDragging && 'opacity-50',
              isAnimating && 'animate-fade-in'
            )}
            data-dock-container
            style={{ boxShadow: isActiveDropTarget ? 'var(--shadow-md)' : 'none', width: `${dockVWidth}px` }}
            onDragOver={handleDragOver}
            onDragLeave={onDragLeave}
            onDrop={handleDrop}
          >
            {isActiveDropTarget && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-primary/15 backdrop-blur-[2px] pointer-events-none z-10 gap-1">
                <div
                  className="rounded-md border border-dashed border-primary/40 bg-primary/10 flex items-center justify-center"
                  style={{ width: '40px', aspectRatio: '16/9', animation: 'card-silhouette-pulse 1.5s ease-in-out infinite' }}
                >
                  <Play className="w-2.5 h-2.5 text-primary/40" />
                </div>
                <span className="text-primary-foreground/80 font-medium text-[8px]">
                  {t('ideation.dropToAdd')}
                </span>
              </div>
            )}
            <div className="flex flex-col h-full py-1.5 px-1.5 gap-1.5">
              <div
                className="flex items-center justify-center gap-1 flex-shrink-0 cursor-grab active:cursor-grabbing select-none py-1"
                onMouseDown={handleDockedDragMouseDown}
              >
                <GripVertical className="w-3 h-3 text-muted-foreground/50" />
                <div className="p-0.5 rounded bg-primary/10">
                  <Lightbulb className="w-2.5 h-2.5 text-primary" />
                </div>
                {cards.length > 0 && (
                  <span className="text-[9px] text-primary font-medium">{cards.length}</span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 text-muted-foreground hover:text-foreground ml-auto"
                  onClick={onToggleFloating}
                  title={t('mandala.switchToFloating')}
                >
                  <Move className="w-2.5 h-2.5" />
                </Button>
              </div>
              <button
                onClick={() => scrollVerticalByAmount('up')}
                className={cn(
                  'flex-shrink-0 w-full h-6 rounded flex items-center justify-center transition-all duration-200',
                  'bg-surface-base/80 hover:bg-surface-base border border-border/50',
                  'text-muted-foreground hover:text-foreground',
                  canScrollUp ? 'opacity-100' : 'opacity-0 pointer-events-none'
                )}
                style={{ boxShadow: 'var(--shadow-sm)' }}
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <div
                ref={verticalScrollRef}
                className="flex-1 flex flex-col gap-1 overflow-y-auto scrollbar-none scroll-smooth"
                onClick={handleContainerClick}
              >
                {cards.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-1 text-muted-foreground py-3 flex-1">
                    <Plus className="w-3 h-3 opacity-50" />
                    <span className="text-[9px] text-center leading-tight whitespace-pre-line">
                      {t('ideation.emptyHintVertical')}
                    </span>
                  </div>
                ) : (
                  <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
                  {sortedCards.map((card, idx) => {
                    const isSelected = selectedCardIds.has(card.id);
                    return (
                      <SortableScratchCard
                        key={card.id}
                        card={card}
                        selectedCardIds={selectedCardIds}
                      >
                        {({ isDragging: isDragActive, dragRef, dragListeners, dragAttributes, style: sortableStyle }) => {
                          return (
                          <div
                            ref={dragRef}
                            style={sortableStyle}
                            {...dragAttributes}
                            {...dragListeners}
                            data-card-item
                            data-dnd-draggable=""
                            data-selected={isSelected || undefined}
                            onClick={(e) => handleCardClick(e, card, idx)}
                            className={cn(
                              'group relative flex-shrink-0 cursor-grab active:cursor-grabbing transition-transform hover:scale-[1.02]',
                              isSelected && 'ring-1 ring-primary',
                              isDragActive && 'opacity-30'
                            )}
                          >
                            <div
                              className="relative w-full aspect-video overflow-hidden bg-muted rounded"
                              style={{ boxShadow: 'var(--shadow-xs)' }}
                            >
                              <img
                                src={card.thumbnail}
                                alt={card.title}
                                draggable={false}
                                className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                                loading="lazy"
                              />
                              <span className="absolute bottom-0 right-0 text-[7px] bg-background/80 text-foreground px-0.5 font-medium rounded-tl">
                                {getTimeLabel(new Date(card.createdAt), t)}
                              </span>
                              {isSelected && (
                                <div
                                  className="absolute top-0 left-0 bg-primary rounded-br p-0.5 cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedCardIds((prev) => {
                                      const next = new Set(prev);
                                      next.delete(card.id);
                                      return next;
                                    });
                                  }}
                                >
                                  <Check
                                    className="w-2 h-2"
                                    style={{ color: 'hsl(var(--primary-foreground))' }}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                        }}
                      </SortableScratchCard>
                    );
                  })}
                  </SortableContext>
                )}
              </div>
              <button
                onClick={() => scrollVerticalByAmount('down')}
                className={cn(
                  'flex-shrink-0 w-full h-6 rounded flex items-center justify-center transition-all duration-200',
                  'bg-surface-base/80 hover:bg-surface-base border border-border/50',
                  'text-muted-foreground hover:text-foreground',
                  canScrollDown ? 'opacity-100' : 'opacity-0 pointer-events-none'
                )}
                style={{ boxShadow: 'var(--shadow-sm)' }}
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
            {/* Resize handle — side edge */}
            <div
              className={cn(
                'absolute top-0 h-full w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors z-50',
                dockPosition === 'left' ? 'right-0' : 'left-0'
              )}
              onMouseDown={(e) => handleDockResizeStart(e, 'width')}
              onDoubleClick={() => handleDockResizeDoubleClick('width')}
            />
          </div>
        </>
      );
    }

    // Floating mode
    return (
      <>
        {isDragging && <DockZoneIndicators />}
        <div
          ref={setFloatingElRef}
          className={cn(
            'fixed rounded-xl transition-shadow duration-200',
            'bg-surface-mid/98 backdrop-blur-xl border border-border/60',
            isActiveDropTarget && 'border-2 border-dashed border-primary bg-primary/5',
            isDragging && 'cursor-grabbing',
            isResizing && 'cursor-se-resize'
          )}
          style={{
            left: position.x,
            top: position.y,
            width: size.width,
            height: isMinimized ? 44 : size.height,
            zIndex: 1000,
            boxShadow: '0 20px 40px -12px rgba(0, 0, 0, 0.4), 0 8px 16px -8px rgba(0, 0, 0, 0.3)',
          }}
          onDragOver={handleDragOver}
          onDragLeave={onDragLeave}
          onDrop={handleDrop}
        >
          <div
            className={cn(
              'flex items-center justify-between px-3 py-2 border-b border-border/30 cursor-grab select-none',
              isDragging && 'cursor-grabbing'
            )}
            onMouseDown={handleDragMouseDown}
          >
            <div className="flex items-center gap-2">
              <GripHorizontal className="w-4 h-4 text-muted-foreground/40" />
              <div className="p-1 rounded-md bg-primary/10">
                <Lightbulb className="w-3.5 h-3.5 text-primary" />
              </div>
              <span className="text-xs font-semibold text-foreground">{t('ideation.title')}</span>
              {cards.length > 0 && (
                <span className="text-[10px] text-primary font-medium bg-primary/10 px-1.5 py-0.5 rounded">
                  {t('common.items', { count: cards.length })}
                </span>
              )}
              {selectedCardIds.size > 0 && (
                <>
                  <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
                    {t('common.selected', { count: selectedCardIds.size })}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteCards?.([...selectedCardIds]);
                      setSelectedCardIds(new Set());
                      setLastSelectedIndex(null);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="p-1 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                    title={t('cards.deleteSelected')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
            <div className="flex items-center gap-0.5" onMouseDown={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => setIsMinimized(!isMinimized)}
              >
                {isMinimized ? (
                  <Maximize2 className="w-3 h-3" />
                ) : (
                  <Minimize2 className="w-3 h-3" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={onToggleFloating}
                title={t('mandala.switchToDock')}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
          {!isMinimized && (
            <div
              ref={floatingContentRef}
              className="p-3 overflow-y-auto relative"
              style={{ height: 'calc(100% - 44px)' }}
              onClick={handleContainerClick}
            >
              {isActiveDropTarget && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-primary/15 backdrop-blur-[2px] rounded-xl pointer-events-none z-10 gap-2">
                  <div
                    className="rounded-lg border border-dashed border-primary/40 bg-primary/10 flex items-center justify-center shadow-sm"
                    style={{ width: '72px', aspectRatio: '16/9', animation: 'card-silhouette-pulse 1.5s ease-in-out infinite' }}
                  >
                    <Play className="w-4 h-4 text-primary/40" />
                  </div>
                  <span className="text-primary-foreground/80 font-medium text-xs">
                    {t('ideation.dropHere')}
                  </span>
                </div>
              )}
              {selectionStyle && <div style={selectionStyle} />}
              {cards.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <Plus className="w-4 h-4 mr-2 opacity-50" />
                  <span className="text-sm">{t('ideation.emptyHint')}</span>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 content-start">
                  <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
                    {sortedCards.map((card, idx) => renderCardItem(card, idx, false))}
                  </SortableContext>
                </div>
              )}
            </div>
          )}
          {!isMinimized && (
            <div
              className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize flex items-center justify-center"
              onMouseDown={handleResizeMouseDown}
            >
              <svg
                className="w-3 h-3 text-muted-foreground/50"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M22 22H20V20H22V22ZM22 18H20V16H22V18ZM18 22H16V20H18V22ZM22 14H20V12H22V14ZM18 18H16V16H18V18ZM14 22H12V20H14V22Z" />
              </svg>
            </div>
          )}
        </div>
      </>
    );
  }
);

FloatingScratchPad.displayName = 'FloatingScratchPad';
