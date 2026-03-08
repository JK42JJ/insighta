import { useState, useRef, useCallback, useEffect } from 'react';

/** Check if the target element (or an ancestor) is a dnd-kit draggable */
function isDndDraggable(el: HTMLElement): boolean {
  return !!(
    el.closest('[aria-roledescription="draggable"]') ||
    el.closest('[draggable="true"]') ||
    el.closest('[data-dnd-draggable]')
  );
}

interface SelectionBox {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface UseDragSelectOptions {
  containerRef: React.RefObject<HTMLElement>;
  itemSelector: string;
  onSelectionChange: (selectedIndices: number[]) => void;
  enabled?: boolean;
}

export function useDragSelect({
  containerRef,
  itemSelector,
  onSelectionChange,
  enabled = true,
}: UseDragSelectOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [justFinishedDrag, setJustFinishedDrag] = useState(false);
  const startPosRef = useRef({ x: 0, y: 0 });
  const isPendingRef = useRef(false);
  const startClientRef = useRef({ x: 0, y: 0 });
  const DRAG_THRESHOLD = 5; // Minimum pixels to move before starting drag selection

  const getRelativePosition = useCallback(
    (e: MouseEvent) => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      return {
        x: e.clientX - rect.left + containerRef.current.scrollLeft,
        y: e.clientY - rect.top + containerRef.current.scrollTop,
      };
    },
    [containerRef]
  );

  const getSelectedIndices = useCallback(() => {
    if (!containerRef.current || !selectionBox) return [];

    const items = containerRef.current.querySelectorAll(itemSelector);
    const containerRect = containerRef.current.getBoundingClientRect();
    const selectedIndices: number[] = [];

    const minX = Math.min(selectionBox.startX, selectionBox.endX);
    const maxX = Math.max(selectionBox.startX, selectionBox.endX);
    const minY = Math.min(selectionBox.startY, selectionBox.endY);
    const maxY = Math.max(selectionBox.startY, selectionBox.endY);

    items.forEach((item, index) => {
      const itemRect = item.getBoundingClientRect();
      const itemX = itemRect.left - containerRect.left + containerRef.current!.scrollLeft;
      const itemY = itemRect.top - containerRect.top + containerRef.current!.scrollTop;
      const itemRight = itemX + itemRect.width;
      const itemBottom = itemY + itemRect.height;

      // Check if item intersects with selection box
      if (itemX < maxX && itemRight > minX && itemY < maxY && itemBottom > minY) {
        selectedIndices.push(index);
      }
    });

    return selectedIndices;
  }, [containerRef, itemSelector, selectionBox]);

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (!enabled) return;
      // Only start drag selection on left click
      if (e.button !== 0) return;
      // Don't start if Ctrl/Meta key is pressed (for individual selection)
      if (e.ctrlKey || e.metaKey) return;

      // If the mousedown started on a dnd-kit draggable element, let dnd-kit handle it
      const target = e.target as HTMLElement | null;
      if (target && isDndDraggable(target)) {
        isPendingRef.current = false;
        return;
      }

      // Store start position and mark as pending
      const pos = getRelativePosition(e);
      startPosRef.current = pos;
      startClientRef.current = { x: e.clientX, y: e.clientY };
      isPendingRef.current = true;

      // Prevent text selection during drag-select
      e.preventDefault();
    },
    [enabled, getRelativePosition]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      // Check if we should start dragging (threshold check)
      if (isPendingRef.current && !isDragging) {
        const dx = Math.abs(e.clientX - startClientRef.current.x);
        const dy = Math.abs(e.clientY - startClientRef.current.y);

        if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
          // Check if we started on a card that is actually draggable
          const target = document.elementFromPoint(
            startClientRef.current.x,
            startClientRef.current.y
          ) as HTMLElement;
          const cardItem = target?.closest('[data-card-item]');
          if (cardItem && target && isDndDraggable(target)) {
            isPendingRef.current = false;
            return;
          }

          setSelectionBox({
            startX: startPosRef.current.x,
            startY: startPosRef.current.y,
            endX: startPosRef.current.x,
            endY: startPosRef.current.y,
          });
          setIsDragging(true);
          isPendingRef.current = false;
        }
      }

      if (!isDragging) return;

      const pos = getRelativePosition(e);
      setSelectionBox((prev) =>
        prev
          ? {
              ...prev,
              endX: pos.x,
              endY: pos.y,
            }
          : null
      );
    },
    [isDragging, getRelativePosition]
  );

  const handleMouseUp = useCallback(() => {
    if (isDragging && selectionBox) {
      const selectedIndices = getSelectedIndices();
      onSelectionChange(selectedIndices);
      // Prevent click event from clearing selection
      setJustFinishedDrag(true);
      setTimeout(() => setJustFinishedDrag(false), 100);
    }
    setIsDragging(false);
    setSelectionBox(null);
    isPendingRef.current = false;
  }, [isDragging, selectionBox, getSelectedIndices, onSelectionChange]);

  // Prevent text selection during drag
  useEffect(() => {
    if (isDragging) {
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
    } else {
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
    }
    return () => {
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
    };
  }, [isDragging]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    container.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [containerRef, enabled, handleMouseDown, handleMouseMove, handleMouseUp]);

  const selectionStyle =
    selectionBox && isDragging
      ? {
          position: 'absolute' as const,
          left: Math.min(selectionBox.startX, selectionBox.endX),
          top: Math.min(selectionBox.startY, selectionBox.endY),
          width: Math.abs(selectionBox.endX - selectionBox.startX),
          height: Math.abs(selectionBox.endY - selectionBox.startY),
          backgroundColor: 'rgba(255, 107, 61, 0.15)',
          border: '1px solid rgba(255, 107, 61, 0.5)',
          borderRadius: '4px',
          pointerEvents: 'none' as const,
          zIndex: 50,
        }
      : null;

  return {
    isDragging,
    selectionBox,
    selectionStyle,
    justFinishedDrag,
  };
}
