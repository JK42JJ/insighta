import { useState, useRef, useCallback, useEffect } from 'react';

/** Check if the target element is a dnd-kit drag handle or a selected draggable card */
function isDndActivator(el: HTMLElement): boolean {
  return !!(el.closest('[data-dnd-handle]') || el.closest('[data-dnd-draggable]'));
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
  const isDraggingRef = useRef(false);
  const DRAG_THRESHOLD = 5;

  // Keep ref in sync with state for use in native event handlers
  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  const getRelativePosition = useCallback(
    (clientX: number, clientY: number) => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      return {
        x: clientX - rect.left + containerRef.current.scrollLeft,
        y: clientY - rect.top + containerRef.current.scrollTop,
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

      if (itemX < maxX && itemRight > minX && itemY < maxY && itemBottom > minY) {
        selectedIndices.push(index);
      }
    });

    return selectedIndices;
  }, [containerRef, itemSelector, selectionBox]);

  // Use pointerdown on document (capture phase) to fire BEFORE dnd-kit's handlers
  useEffect(() => {
    if (!enabled) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (e.ctrlKey || e.metaKey) return;

      // Only handle events inside our container
      const container = containerRef.current;
      if (!container) return;
      if (!container.contains(e.target as Node)) return;

      // Skip if started on dnd-kit drag handle
      const target = e.target as HTMLElement;
      if (isDndActivator(target)) return;

      const pos = getRelativePosition(e.clientX, e.clientY);
      startPosRef.current = pos;
      startClientRef.current = { x: e.clientX, y: e.clientY };
      isPendingRef.current = true;
    };

    const handlePointerMove = (e: PointerEvent) => {
      // Threshold check: start drag-select after moving enough pixels
      if (isPendingRef.current && !isDraggingRef.current) {
        const dx = Math.abs(e.clientX - startClientRef.current.x);
        const dy = Math.abs(e.clientY - startClientRef.current.y);

        if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
          // Final check: if the start element was a dnd handle, bail out
          const startTarget = document.elementFromPoint(
            startClientRef.current.x,
            startClientRef.current.y
          ) as HTMLElement | null;
          if (startTarget && isDndActivator(startTarget)) {
            isPendingRef.current = false;
            return;
          }

          isPendingRef.current = false;
          isDraggingRef.current = true;

          // Prevent text selection
          document.body.style.userSelect = 'none';

          setSelectionBox({
            startX: startPosRef.current.x,
            startY: startPosRef.current.y,
            endX: startPosRef.current.x,
            endY: startPosRef.current.y,
          });
          setIsDragging(true);
        }
      }

      if (!isDraggingRef.current) return;

      const pos = getRelativePosition(e.clientX, e.clientY);
      setSelectionBox((prev) =>
        prev
          ? { ...prev, endX: pos.x, endY: pos.y }
          : null
      );
    };

    const handlePointerUp = () => {
      if (isDraggingRef.current) {
        // Use a microtask to read the latest selectionBox state
        setIsDragging(false);
        setJustFinishedDrag(true);
        setTimeout(() => setJustFinishedDrag(false), 100);
      }
      isPendingRef.current = false;
      isDraggingRef.current = false;
      document.body.style.userSelect = '';
    };

    // Capture phase ensures we fire BEFORE any child element handlers (including dnd-kit)
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.body.style.userSelect = '';
    };
  }, [enabled, containerRef, getRelativePosition]);

  // Finalize selection when isDragging transitions from true to false
  const prevDraggingRef = useRef(false);
  useEffect(() => {
    if (prevDraggingRef.current && !isDragging && selectionBox) {
      const selectedIndices = getSelectedIndices();
      onSelectionChange(selectedIndices);
      setSelectionBox(null);
    }
    prevDraggingRef.current = isDragging;
  }, [isDragging, selectionBox, getSelectedIndices, onSelectionChange]);

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
