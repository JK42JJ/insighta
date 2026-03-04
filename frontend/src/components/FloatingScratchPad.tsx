import { useState, useRef, useEffect, useCallback, forwardRef } from "react";
import { createPortal } from "react-dom";
import { InsightCard } from "@/types/mandala";
import { Lightbulb, Plus, ExternalLink, Minimize2, Maximize2, GripHorizontal, GripVertical, X, Move, Check, Trash2, ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, differenceInHours, differenceInDays, differenceInWeeks, differenceInMonths } from "date-fns";
import { Button } from "@/components/ui/button";
import { useDragSelect } from "@/hooks/useDragSelect";

export type DockPosition = "top" | "bottom" | "left" | "right";

interface FloatingScratchPadProps {
  cards: InsightCard[];
  isDropTarget: boolean;
  onDrop: (url: string) => void;
  onCardDrop: (cardId: string) => void;
  onMultiCardDrop?: (cardIds: string[]) => void;
  onCardClick: (card: InsightCard) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onCardDragStart: (card: InsightCard) => void;
  onMultiCardDragStart?: (cards: InsightCard[]) => void;
  onDeleteCards?: (cardIds: string[]) => void;
  onFileDrop?: (files: FileList) => void;
  isFloating: boolean;
  onToggleFloating: () => void;
  dockPosition?: DockPosition;
  onDockPositionChange?: (position: DockPosition) => void;
  initialPosition?: { x: number; y: number };
  onPositionChange?: (x: number, y: number) => void;
}

function getTimeLabel(date: Date): string {
  const now = new Date();
  const hours = differenceInHours(now, date);
  const days = differenceInDays(now, date);
  const weeks = differenceInWeeks(now, date);
  const months = differenceInMonths(now, date);

  if (hours < 1) return "방금";
  if (hours < 24) return `${hours}시간`;
  if (days < 7) return `${days}일`;
  if (weeks < 4) return `${weeks}주`;
  if (months < 12) return `${months}개월`;
  return format(date, "yy.MM");
}

const DOCK_THRESHOLD = 80;
const SIDE_DOCK_THRESHOLD = 100;

export const FloatingScratchPad = forwardRef<HTMLDivElement, FloatingScratchPadProps>(function FloatingScratchPad({
  cards,
  isDropTarget,
  onDrop,
  onCardDrop,
  onMultiCardDrop,
  onCardClick,
  onDragOver,
  onDragLeave,
  onCardDragStart,
  onMultiCardDragStart,
  onDeleteCards,
  onFileDrop,
  isFloating,
  onToggleFloating,
  dockPosition = "top",
  onDockPositionChange,
  initialPosition,
  onPositionChange,
}: FloatingScratchPadProps, forwardedRef) {
  const [position, setPosition] = useState(() => initialPosition ?? { x: 100, y: 100 });
  const [size, setSize] = useState({ width: 320, height: 320 });
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isDockedDragging, setIsDockedDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
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

  const setForwardedRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!forwardedRef) return;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else forwardedRef.current = node;
    },
    [forwardedRef]
  );

  const setDockedElRef = useCallback(
    (node: HTMLDivElement | null) => {
      dockedRef.current = node;
      setForwardedRef(node);
    },
    [setForwardedRef]
  );

  const setFloatingElRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      setForwardedRef(node);
    },
    [setForwardedRef]
  );
  
  // Acceleration tracking for navigation buttons
  const lastScrollTimeRef = useRef<number>(0);
  const consecutiveClicksRef = useRef<number>(0);
  const CLICK_TIMEOUT = 400; // ms - time window for consecutive clicks
  const MAX_ACCELERATION = 3; // maximum multiplier

  const sortedCards = [...cards].sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const handleDragSelectChange = useCallback((selectedIndices: number[]) => {
    const newSelectedIds = new Set(selectedIndices.map(idx => sortedCards[idx]?.id).filter(Boolean));
    setSelectedCardIds(prev => {
      const combined = new Set([...prev, ...newSelectedIds]);
      return combined;
    });
  }, [sortedCards]);

  const { selectionStyle } = useDragSelect({
    containerRef: floatingContentRef,
    itemSelector: '[data-card-item]',
    onSelectionChange: handleDragSelectChange,
    enabled: isFloating,
  });

  const isHorizontalDock = dockPosition === "top" || dockPosition === "bottom";
  const isVerticalDock = dockPosition === "left" || dockPosition === "right";

  const detectDockPosition = useCallback((clientX: number, clientY: number): DockPosition | null => {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    // Check left edge first (priority for side docking)
    if (clientX < SIDE_DOCK_THRESHOLD) {
      return "left";
    }
    
    // Check right edge
    if (clientX > windowWidth - SIDE_DOCK_THRESHOLD) {
      return "right";
    }
    
    // Check top edge (only center area, not corners)
    if (clientY < DOCK_THRESHOLD) {
      return "top";
    }
    
    // Check bottom edge
    if (clientY > windowHeight - DOCK_THRESHOLD) {
      return "bottom";
    }
    
    return null;
  }, []);

  // Handle drag (floating mode) with RAF optimization
  const handleDragMouseDown = (e: React.MouseEvent) => {
    if (!isFloating) return;
    e.preventDefault();
    e.stopPropagation();
    
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    initialPosRef.current = { ...position };
    setIsDragging(true);
    setPendingDock(null);
  };

  // Handle drag from docked mode
  const handleDockedDragMouseDown = (e: React.MouseEvent) => {
    if (isFloating) return;
    e.preventDefault();
    e.stopPropagation();
    
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setIsDockedDragging(true);
    setPendingDock(null);
  };

  // Handle resize
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
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      
      rafRef.current = requestAnimationFrame(() => {
        if (isDragging) {
          const dx = e.clientX - dragStartRef.current.x;
          const dy = e.clientY - dragStartRef.current.y;
          const newX = Math.max(0, Math.min(window.innerWidth - 100, initialPosRef.current.x + dx));
          const newY = Math.max(0, Math.min(window.innerHeight - 50, initialPosRef.current.y + dy));
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
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (isDragging && pendingDock) {
        setIsAnimating(true);
        onDockPositionChange?.(pendingDock);
        onToggleFloating();
        setTimeout(() => setIsAnimating(false), 300);
      } else if (isDragging) {
        // 플로팅 상태로 드래그 종료 - 위치 저장
        onPositionChange?.(position.x, position.y);
      }
      setIsDragging(false);
      setIsResizing(false);
      setPendingDock(null);
    };

    document.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, isResizing, pendingDock, detectDockPosition, onDockPositionChange, onToggleFloating, position.x, position.y, onPositionChange]);

  // Handle docked dragging with RAF optimization
  useEffect(() => {
    if (!isDockedDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      
      rafRef.current = requestAnimationFrame(() => {
        const dock = detectDockPosition(e.clientX, e.clientY);
        setPendingDock(dock);
      });
    };

    const handleMouseUp = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (pendingDock && pendingDock !== dockPosition) {
        setIsAnimating(true);
        onDockPositionChange?.(pendingDock);
        setTimeout(() => setIsAnimating(false), 300);
      }
      setIsDockedDragging(false);
      setPendingDock(null);
    };

    document.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseup", handleMouseUp);
    
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDockedDragging, pendingDock, dockPosition, detectDockPosition, onDockPositionChange]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const activeRef = isFloating ? containerRef.current : dockedRef.current;
      if (!activeRef) return;
      if (!activeRef.contains(target)) {
        setSelectedCardIds(new Set());
        setLastSelectedIndex(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isFloating]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    onDragOver(e);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    
    // Check for file drops first
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFileDrop?.(e.dataTransfer.files);
      return;
    }
    
    const multiCardIdsData = e.dataTransfer.getData("application/multi-card-ids");
    if (multiCardIdsData) {
      try {
        const multiCardIds = JSON.parse(multiCardIdsData) as string[];
        onMultiCardDrop?.(multiCardIds);
        return;
      } catch (err) {
        // Fall through
      }
    }
    
    const cardId = e.dataTransfer.getData("application/card-id");
    if (cardId) {
      onCardDrop(cardId);
      return;
    }
    
    const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (url && (url.includes("youtube") || url.includes("youtu.be") || url.includes("linkedin.com") || url.includes("notion.so") || url.includes("notion.site") || url.endsWith('.txt') || url.endsWith('.md') || url.endsWith('.pdf'))) {
      onDrop(url);
    }
  };

  const handleCardDragStart = (e: React.DragEvent, card: InsightCard) => {
    if (selectedCardIds.has(card.id) && selectedCardIds.size > 1) {
      const selectedCards = cards.filter(c => selectedCardIds.has(c.id));
      const cardIds = selectedCards.map(c => c.id);
      e.dataTransfer.setData("application/multi-card-ids", JSON.stringify(cardIds));
      e.dataTransfer.setData("application/card-id", card.id);
      e.dataTransfer.setData("text/plain", selectedCards.map(c => c.videoUrl).join('\n'));
      e.dataTransfer.effectAllowed = "move";
      
      const dragImage = document.createElement('div');
      dragImage.style.cssText = `position: absolute; left: -9999px; display: flex; align-items: center; justify-content: center; width: 120px; height: 90px;`;
      
      const stackContainer = document.createElement('div');
      stackContainer.style.cssText = `position: relative; width: 80px; height: 56px; transform-style: preserve-3d; perspective: 400px;`;
      
      const maxThumbs = Math.min(selectedCards.length, 3);
      for (let i = maxThumbs - 1; i >= 0; i--) {
        const cardWrapper = document.createElement('div');
        const offset = i * 5;
        const rotation = (i - 1) * -3;
        const scale = 1 - (i * 0.02);
        
        cardWrapper.style.cssText = `
          position: absolute; left: ${offset}px; top: ${offset}px; width: 72px; height: 46px;
          border-radius: 6px; overflow: hidden;
          box-shadow: 0 ${3 + i * 2}px ${10 + i * 3}px rgba(0,0,0,${0.3 - i * 0.05});
          transform: rotate(${rotation}deg) scale(${scale});
          border: 2px solid rgba(255,255,255,0.15);
          background: linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%);
          z-index: ${maxThumbs - i};
        `;
        
        if (selectedCards[i]) {
          const thumb = document.createElement('img');
          thumb.src = selectedCards[i].thumbnail;
          thumb.style.cssText = `width: 100%; height: 100%; object-fit: cover; filter: brightness(0.95);`;
          cardWrapper.appendChild(thumb);
        }
        
        stackContainer.appendChild(cardWrapper);
      }
      
      const badge = document.createElement('div');
      badge.style.cssText = `
        position: absolute; right: -6px; top: -8px; min-width: 24px; height: 24px;
        background: linear-gradient(135deg, #FF6B3D 0%, #FF8F6B 100%);
        color: white; font-size: 11px; font-weight: 700;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        padding: 0 6px; border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 3px 10px rgba(255,107,61,0.4);
        border: 2px solid rgba(255,255,255,0.2);
        z-index: 100;
      `;
      badge.textContent = `${selectedCards.length}`;
      stackContainer.appendChild(badge);
      
      dragImage.appendChild(stackContainer);
      document.body.appendChild(dragImage);
      e.dataTransfer.setDragImage(dragImage, 50, 38);
      setTimeout(() => document.body.removeChild(dragImage), 0);
      
      onMultiCardDragStart?.(selectedCards);
    } else {
      if (!selectedCardIds.has(card.id)) {
        setSelectedCardIds(new Set());
      }
      e.dataTransfer.setData("application/card-id", card.id);
      e.dataTransfer.setData("text/plain", card.videoUrl);
      e.dataTransfer.effectAllowed = "move";
      
      // Create single card drag image
      const dragImage = document.createElement('div');
      dragImage.style.cssText = `
        position: absolute; 
        left: -9999px; 
        display: flex; 
        align-items: center;
        justify-content: center;
        width: 100px;
        height: 70px;
      `;
      
      const cardWrapper = document.createElement('div');
      cardWrapper.style.cssText = `
        width: 80px;
        height: 52px;
        border-radius: 6px;
        overflow: hidden;
        box-shadow: 0 6px 20px rgba(0,0,0,0.35),
                    0 3px 6px rgba(0,0,0,0.2),
                    inset 0 1px 0 rgba(255,255,255,0.1);
        border: 2px solid rgba(255,255,255,0.15);
        background: linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%);
        transform: rotate(-2deg);
      `;
      
      if (card.thumbnail) {
        const thumb = document.createElement('img');
        thumb.src = card.thumbnail;
        thumb.style.cssText = `
          width: 100%; 
          height: 100%; 
          object-fit: cover;
          filter: brightness(0.95);
        `;
        cardWrapper.appendChild(thumb);
        
        // Add subtle gradient overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.4) 100%);
        `;
        cardWrapper.appendChild(overlay);
      }
      
      dragImage.appendChild(cardWrapper);
      document.body.appendChild(dragImage);
      e.dataTransfer.setDragImage(dragImage, 40, 26);
      setTimeout(() => document.body.removeChild(dragImage), 0);
      
      onCardDragStart(card);
    }
  };

  const handleCardClick = (e: React.MouseEvent, card: InsightCard, cardIndex: number) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      
      if (lastSelectedIndex !== null) {
        const start = Math.min(lastSelectedIndex, cardIndex);
        const end = Math.max(lastSelectedIndex, cardIndex);
        const rangeCardIds = sortedCards.slice(start, end + 1).map(c => c.id);
        
        setSelectedCardIds(prev => {
          const next = new Set(prev);
          rangeCardIds.forEach(id => next.add(id));
          return next;
        });
      } else {
        setSelectedCardIds(new Set([card.id]));
        setLastSelectedIndex(cardIndex);
      }
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      setSelectedCardIds(prev => {
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
      onCardClick(card);
    }
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setSelectedCardIds(new Set());
    }
  };

  // Check scroll position for navigation arrows (horizontal)
  const checkScrollPosition = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    const { scrollLeft, scrollWidth, clientWidth } = container;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1);
  }, []);

  // Check scroll position for navigation arrows (vertical)
  const checkVerticalScrollPosition = useCallback(() => {
    const container = verticalScrollRef.current;
    if (!container) return;
    
    const { scrollTop, scrollHeight, clientHeight } = container;
    setCanScrollUp(scrollTop > 0);
    setCanScrollDown(scrollTop < scrollHeight - clientHeight - 1);
  }, []);

  // Calculate acceleration multiplier based on consecutive clicks
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

  // Scroll by 1/3 of container width (horizontal) with acceleration
  const scrollByAmount = useCallback((direction: 'left' | 'right') => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    const multiplier = getAccelerationMultiplier();
    const baseScrollAmount = container.clientWidth / 3;
    const scrollAmount = baseScrollAmount * multiplier;
    
    container.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  }, [getAccelerationMultiplier]);

  // Scroll by 1/3 of container height (vertical) with acceleration
  const scrollVerticalByAmount = useCallback((direction: 'up' | 'down') => {
    const container = verticalScrollRef.current;
    if (!container) return;
    
    const multiplier = getAccelerationMultiplier();
    const baseScrollAmount = container.clientHeight / 3;
    const scrollAmount = baseScrollAmount * multiplier;
    
    container.scrollBy({
      top: direction === 'up' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  }, [getAccelerationMultiplier]);

  // Update scroll state when cards change or container mounts (horizontal)
  useEffect(() => {
    checkScrollPosition();
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', checkScrollPosition);
      return () => container.removeEventListener('scroll', checkScrollPosition);
    }
  }, [cards.length, checkScrollPosition, isFloating, dockPosition]);

  // Update scroll state when cards change or container mounts (vertical)
  useEffect(() => {
    checkVerticalScrollPosition();
    const container = verticalScrollRef.current;
    if (container) {
      container.addEventListener('scroll', checkVerticalScrollPosition);
      return () => container.removeEventListener('scroll', checkVerticalScrollPosition);
    }
  }, [cards.length, checkVerticalScrollPosition, isFloating, dockPosition]);

  // Dock zone indicators - rendered via portal to body for proper z-index stacking
  // Indicators appear at actual docking positions (header bottom for top, etc.)
  const HEADER_HEIGHT = 72; // Header height in pixels (py-3 padding + content)
  
  const DockZoneIndicators = forwardRef<HTMLDivElement>(function DockZoneIndicators(_props, ref) {
    if (!pendingDock) return null;

    const indicators = (
      <div
        ref={ref}
        className="dock-zone-indicators"
        style={{ position: "fixed", inset: 0, zIndex: 99999, pointerEvents: "none" }}
      >
        {/* Top zone - appears exactly at header bottom boundary */}
        <div
          className={cn(
            "absolute left-0 right-0 transition-all duration-300 ease-out",
            pendingDock === "top" ? "opacity-100" : "opacity-0"
          )}
          style={{ top: `${HEADER_HEIGHT}px`, height: "2px" }}
        >
          <div
            className="h-full w-full"
            style={{
              background: "hsl(var(--primary) / 0.35)",
              boxShadow: "0 1px 6px 0 hsl(var(--primary) / 0.15)",
            }}
          />
        </div>

        {/* Bottom zone */}
        <div
          className={cn(
            "absolute bottom-0 left-0 right-0 transition-all duration-300 ease-out",
            pendingDock === "bottom" ? "opacity-100" : "opacity-0"
          )}
          style={{ height: "2px" }}
        >
          <div
            className="h-full w-full"
            style={{
              background: "hsl(var(--primary) / 0.35)",
              boxShadow: "0 -1px 6px 0 hsl(var(--primary) / 0.15)",
            }}
          />
        </div>

        {/* Left zone - starts from header bottom */}
        <div
          className={cn(
            "absolute left-0 transition-all duration-300 ease-out",
            pendingDock === "left" ? "opacity-100" : "opacity-0"
          )}
          style={{ top: `${HEADER_HEIGHT}px`, bottom: 0, width: "2px" }}
        >
          <div
            className="h-full w-full"
            style={{
              background: "hsl(var(--primary) / 0.35)",
              boxShadow: "1px 0 6px 0 hsl(var(--primary) / 0.15)",
            }}
          />
        </div>

        {/* Right zone - starts from header bottom */}
        <div
          className={cn(
            "absolute right-0 transition-all duration-300 ease-out",
            pendingDock === "right" ? "opacity-100" : "opacity-0"
          )}
          style={{ top: `${HEADER_HEIGHT}px`, bottom: 0, width: "2px" }}
        >
          <div
            className="h-full w-full"
            style={{
              background: "hsl(var(--primary) / 0.35)",
              boxShadow: "-1px 0 6px 0 hsl(var(--primary) / 0.15)",
            }}
          />
        </div>
      </div>
    );

    return createPortal(indicators, document.body);
  });

  // Render card item
  const renderCardItem = (card: InsightCard, idx: number, isCompact: boolean = false) => {
    const isSelected = selectedCardIds.has(card.id);
    const cardSize = isCompact ? "w-14 h-8" : "w-20 h-[45px]";
    const timeSize = isCompact ? "text-[6px]" : "text-[8px]";
    const checkSize = isCompact ? "w-2 h-2" : "w-2.5 h-2.5";
    
    return (
      <div
        key={card.id}
        data-card-item
        draggable
        onDragStart={(e) => handleCardDragStart(e, card)}
        onClick={(e) => handleCardClick(e, card, idx)}
        className="group relative flex-shrink-0 cursor-grab active:cursor-grabbing transition-transform hover:-translate-y-0.5 rounded-sm"
      >
        <div 
          className={cn("relative overflow-hidden bg-muted rounded-sm", cardSize)}
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          <img
            src={card.thumbnail}
            alt={card.title}
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
            loading="lazy"
          />
          <span className={cn("absolute bottom-0 right-0 bg-background/90 text-foreground px-0.5 font-medium", timeSize)}>
            {getTimeLabel(new Date(card.createdAt))}
          </span>
          {isSelected && (
            <div 
              className="absolute top-0.5 left-0.5 bg-primary rounded-full p-0.5 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedCardIds(prev => {
                  const next = new Set(prev);
                  next.delete(card.id);
                  return next;
                });
              }}
            >
              <Check className={checkSize} style={{ color: 'hsl(var(--primary-foreground))' }} />
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
  };

  // Non-floating (docked) mode - Horizontal layout (top, bottom)
  if (!isFloating && isHorizontalDock) {
    const isTop = dockPosition === "top";
    
    return (
      <>
        {isDockedDragging && <DockZoneIndicators />}
        
        <div className={cn(
          "flex w-full transition-all duration-300 justify-center",
          isAnimating && "animate-fade-in"
        )}>
          <div
            ref={setDockedElRef}
            className={cn(
              "relative transition-all duration-300 w-full",
              "bg-surface-mid/95 backdrop-blur-sm",
              isTop ? "border-b border-border/50" : "border-t border-border/50",
              isDropTarget && "border-primary/60 bg-primary/5",
              isDockedDragging && "opacity-50"
            )}
            style={{ boxShadow: isDropTarget ? 'var(--shadow-sm)' : 'none' }}
            onDragOver={handleDragOver}
            onDragLeave={onDragLeave}
            onDrop={handleDrop}
          >
            {isDropTarget && (
              <div className="absolute inset-0 flex items-center justify-center bg-primary/10 backdrop-blur-[1px] pointer-events-none z-10">
                <span className="text-primary-foreground font-medium text-xs bg-primary/90 px-3 py-1 rounded-full">
                  드롭하여 추가
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
                  <span className="text-xs font-medium text-foreground/80">아이디에이션</span>
                  {cards.length > 0 && (
                    <span className="text-[10px] text-primary/70 font-medium bg-primary/10 px-1.5 py-0.5 rounded-full">
                      {cards.length}
                    </span>
                  )}
                </div>
              </div>

              <div className="h-4 w-px bg-border/40 flex-shrink-0" />

              {/* Left Navigation Arrow */}
              <button
                onClick={() => scrollByAmount('left')}
                className={cn(
                  "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200",
                  "bg-surface-base/80 hover:bg-surface-base border border-border/50",
                  "text-muted-foreground hover:text-foreground",
                  canScrollLeft ? "opacity-100" : "opacity-0 pointer-events-none"
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
                {cards.length === 0 ? (
                  <div className="flex items-center gap-1.5 text-muted-foreground/60">
                    <Plus className="w-3 h-3" />
                    <span className="text-xs">유튜브 링크를 드롭하세요</span>
                  </div>
                ) : (
                  sortedCards.map((card, idx) => renderCardItem(card, idx, true))
                )}
              </div>

              {/* Right Navigation Arrow */}
              <button
                onClick={() => scrollByAmount('right')}
                className={cn(
                  "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200",
                  "bg-surface-base/80 hover:bg-surface-base border border-border/50",
                  "text-muted-foreground hover:text-foreground",
                  canScrollRight ? "opacity-100" : "opacity-0 pointer-events-none"
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
                title="플로팅으로 전환"
              >
                <Move className="w-3 h-3" />
              </Button>
            </div>
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
            "relative transition-all duration-300 h-full",
            "bg-surface-light/80",
            dockPosition === "left" ? "border-r border-border/40" : "border-l border-border/40",
            isDropTarget && "border-primary bg-primary/8",
            isDockedDragging && "opacity-50",
            isAnimating && "animate-fade-in"
          )}
          style={{ 
            boxShadow: isDropTarget ? 'var(--shadow-md)' : 'none',
            width: '90px',
          }}
          onDragOver={handleDragOver}
          onDragLeave={onDragLeave}
          onDrop={handleDrop}
        >
          {isDropTarget && (
            <div className="absolute inset-0 flex items-center justify-center bg-primary/15 backdrop-blur-[2px] pointer-events-none z-10">
              <span className="text-primary-foreground font-semibold text-[10px] bg-primary px-2 py-1 rounded-md whitespace-nowrap">
                드롭
              </span>
            </div>
          )}
          
          <div className="flex flex-col h-full py-1.5 px-1.5 gap-1.5">
            {/* Header */}
            <div
              className="flex items-center justify-center gap-1 flex-shrink-0 cursor-grab active:cursor-grabbing select-none py-1"
              onMouseDown={handleDockedDragMouseDown}
            >
              <GripVertical className="w-3 h-3 text-muted-foreground/50" />
              <div className="p-0.5 rounded bg-primary/10">
                <Lightbulb className="w-2.5 h-2.5 text-primary" />
              </div>
              {cards.length > 0 && (
                <span className="text-[9px] text-primary font-medium">
                  {cards.length}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 text-muted-foreground hover:text-foreground ml-auto"
                onClick={onToggleFloating}
                title="플로팅으로 전환"
              >
                <Move className="w-2.5 h-2.5" />
              </Button>
            </div>

            {/* Up Navigation Arrow */}
            <button
              onClick={() => scrollVerticalByAmount('up')}
              className={cn(
                "flex-shrink-0 w-full h-6 rounded flex items-center justify-center transition-all duration-200",
                "bg-surface-base/80 hover:bg-surface-base border border-border/50",
                "text-muted-foreground hover:text-foreground",
                canScrollUp ? "opacity-100" : "opacity-0 pointer-events-none"
              )}
              style={{ boxShadow: 'var(--shadow-sm)' }}
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>

            {/* Cards - single column, compact */}
            <div 
              ref={verticalScrollRef}
              className="flex-1 flex flex-col gap-1 overflow-y-auto scrollbar-none scroll-smooth" 
              onClick={handleContainerClick}
            >
              {cards.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-1 text-muted-foreground py-3 flex-1">
                  <Plus className="w-3 h-3 opacity-50" />
                  <span className="text-[9px] text-center leading-tight">링크<br/>드롭</span>
                </div>
              ) : (
                sortedCards.map((card, idx) => {
                  const isSelected = selectedCardIds.has(card.id);
                  return (
                    <div
                      key={card.id}
                      data-card-item
                      draggable
                      onDragStart={(e) => handleCardDragStart(e, card)}
                      onClick={(e) => handleCardClick(e, card, idx)}
                      className="group relative flex-shrink-0 cursor-grab active:cursor-grabbing transition-transform hover:scale-[1.02]"
                    >
                      <div 
                        className="relative w-full aspect-video overflow-hidden bg-muted rounded"
                        style={{ boxShadow: 'var(--shadow-xs)' }}
                      >
                        <img
                          src={card.thumbnail}
                          alt={card.title}
                          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                          loading="lazy"
                        />
                        <span className="absolute bottom-0 right-0 text-[7px] bg-background/80 text-foreground px-0.5 font-medium rounded-tl">
                          {getTimeLabel(new Date(card.createdAt))}
                        </span>
                        {isSelected && (
                          <div 
                            className="absolute top-0 left-0 bg-primary rounded-br p-0.5 cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCardIds(prev => {
                                const next = new Set(prev);
                                next.delete(card.id);
                                return next;
                              });
                            }}
                          >
                            <Check className="w-2 h-2" style={{ color: 'hsl(var(--primary-foreground))' }} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Down Navigation Arrow */}
            <button
              onClick={() => scrollVerticalByAmount('down')}
              className={cn(
                "flex-shrink-0 w-full h-6 rounded flex items-center justify-center transition-all duration-200",
                "bg-surface-base/80 hover:bg-surface-base border border-border/50",
                "text-muted-foreground hover:text-foreground",
                canScrollDown ? "opacity-100" : "opacity-0 pointer-events-none"
              )}
              style={{ boxShadow: 'var(--shadow-sm)' }}
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
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
          "fixed rounded-xl transition-shadow duration-200",
          "bg-surface-mid/98 backdrop-blur-xl border border-border/60",
          isDropTarget && "border-primary bg-primary/8",
          isDragging && "cursor-grabbing",
          isResizing && "cursor-se-resize"
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
        {/* Header Bar */}
        <div 
          className={cn(
            "flex items-center justify-between px-3 py-2 border-b border-border/30 cursor-grab select-none",
            isDragging && "cursor-grabbing"
          )}
          onMouseDown={handleDragMouseDown}
        >
          <div className="flex items-center gap-2">
            <GripHorizontal className="w-4 h-4 text-muted-foreground/40" />
            <div className="p-1 rounded-md bg-primary/10">
              <Lightbulb className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="text-xs font-semibold text-foreground">아이디에이션</span>
            {cards.length > 0 && (
              <span className="text-[10px] text-primary font-medium bg-primary/10 px-1.5 py-0.5 rounded">
                {cards.length}개
              </span>
            )}
            {selectedCardIds.size > 0 && (
              <>
                <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
                  {selectedCardIds.size}개 선택됨
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
                  title="선택된 카드 삭제"
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
              {isMinimized ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={onToggleFloating}
              title="도킹하기"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Content */}
        {!isMinimized && (
          <div className="p-3 overflow-hidden" style={{ height: 'calc(100% - 44px)' }}>
            {isDropTarget && (
              <div className="absolute inset-0 flex items-center justify-center bg-primary/15 backdrop-blur-[2px] rounded-xl pointer-events-none z-10">
                <span className="text-primary-foreground font-semibold text-sm bg-primary px-4 py-2 rounded-lg">
                  아이디에이션에 드롭
                </span>
              </div>
            )}

            {cards.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <Plus className="w-4 h-4 mr-2 opacity-50" />
                <span className="text-sm">유튜브 링크를 드롭하세요</span>
              </div>
            ) : (
              <div 
                ref={floatingContentRef}
                className="flex flex-wrap gap-2 overflow-y-auto h-full content-start p-1 relative" 
                onClick={handleContainerClick}
              >
                {selectionStyle && <div style={selectionStyle} />}
                {sortedCards.map((card, idx) => renderCardItem(card, idx, false))}
              </div>
            )}
          </div>
        )}

        {/* Resize Handle */}
        {!isMinimized && (
          <div
            className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize flex items-center justify-center"
            onMouseDown={handleResizeMouseDown}
          >
            <svg className="w-3 h-3 text-muted-foreground/50" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22 22H20V20H22V22ZM22 18H20V16H22V18ZM18 22H16V20H18V22ZM22 14H20V12H22V14ZM18 18H16V16H18V18ZM14 22H12V20H14V22Z" />
            </svg>
          </div>
        )}
      </div>
    </>
  );
});

FloatingScratchPad.displayName = "FloatingScratchPad";
