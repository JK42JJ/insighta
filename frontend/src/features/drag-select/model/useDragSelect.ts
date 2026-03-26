import { useState, useRef, useEffect, useMemo } from 'react';

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
  onSelectionChange: (selectedIndices: number[], additive: boolean) => void;
  enabled?: boolean;
}

export function useDragSelect({
  containerRef,
  itemSelector,
  onSelectionChange,
  enabled = true,
}: UseDragSelectOptions) {
  const [isDragging, setIsDragging] = useState(false);
  // Viewport coordinates for visual rendering (converted to container-relative in useMemo)
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [justFinishedDrag, setJustFinishedDrag] = useState(false);
  const isPendingRef = useRef(false);
  const startClientRef = useRef({ x: 0, y: 0 });
  const endClientRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const shiftKeyRef = useRef(false);
  // Stable refs for use in native event handlers (avoid stale closures)
  const containerRefStable = useRef(containerRef);
  containerRefStable.current = containerRef;
  const itemSelectorRef = useRef(itemSelector);
  itemSelectorRef.current = itemSelector;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const DRAG_THRESHOLD = 5;

  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  useEffect(() => {
    if (!enabled) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (e.ctrlKey || e.metaKey) return;
      shiftKeyRef.current = e.shiftKey;

      const container = containerRefStable.current.current;
      if (!container) return;
      if (!container.contains(e.target as Node)) return;

      const target = e.target as HTMLElement;
      if (isDndActivator(target)) return;

      startClientRef.current = { x: e.clientX, y: e.clientY };
      endClientRef.current = { x: e.clientX, y: e.clientY };
      isPendingRef.current = true;
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (isPendingRef.current && !isDraggingRef.current) {
        const dx = Math.abs(e.clientX - startClientRef.current.x);
        const dy = Math.abs(e.clientY - startClientRef.current.y);

        if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
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
          document.body.style.userSelect = 'none';

          setSelectionBox({
            startX: startClientRef.current.x,
            startY: startClientRef.current.y,
            endX: startClientRef.current.x,
            endY: startClientRef.current.y,
          });
          setIsDragging(true);
        }
      }

      if (!isDraggingRef.current) return;

      endClientRef.current = { x: e.clientX, y: e.clientY };
      setSelectionBox((prev) =>
        prev ? { ...prev, endX: e.clientX, endY: e.clientY } : null
      );
    };

    const handlePointerUp = () => {
      if (isDraggingRef.current) {
        // Perform intersection IMMEDIATELY using refs (no React state timing issues)
        const container = containerRefStable.current.current;
        if (container) {
          const start = startClientRef.current;
          const end = endClientRef.current;
          const minX = Math.min(start.x, end.x);
          const maxX = Math.max(start.x, end.x);
          const minY = Math.min(start.y, end.y);
          const maxY = Math.max(start.y, end.y);

          const items = container.querySelectorAll(itemSelectorRef.current);
          const selectedIndices: number[] = [];

          items.forEach((item, index) => {
            const r = item.getBoundingClientRect();
            if (r.left < maxX && r.right > minX && r.top < maxY && r.bottom > minY) {
              selectedIndices.push(index);
            }
          });

          onSelectionChangeRef.current(selectedIndices, shiftKeyRef.current);
        }

        setIsDragging(false);
        setSelectionBox(null);
        setJustFinishedDrag(true);
        setTimeout(() => setJustFinishedDrag(false), 100);
      }
      isPendingRef.current = false;
      isDraggingRef.current = false;
      document.body.style.userSelect = '';
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.body.style.userSelect = '';
    };
  }, [enabled]);

  // Convert viewport coordinates to container-relative for absolute-positioned visual rect
  const selectionStyle = useMemo(() => {
    if (!selectionBox || !isDragging || !containerRef.current) return null;

    const rect = containerRef.current.getBoundingClientRect();
    const scrollLeft = containerRef.current.scrollLeft;
    const scrollTop = containerRef.current.scrollTop;

    const startRelX = selectionBox.startX - rect.left + scrollLeft;
    const startRelY = selectionBox.startY - rect.top + scrollTop;
    const endRelX = selectionBox.endX - rect.left + scrollLeft;
    const endRelY = selectionBox.endY - rect.top + scrollTop;

    return {
      position: 'absolute' as const,
      left: Math.min(startRelX, endRelX),
      top: Math.min(startRelY, endRelY),
      width: Math.abs(endRelX - startRelX),
      height: Math.abs(endRelY - startRelY),
      backgroundColor: 'rgba(255, 107, 61, 0.15)',
      border: '1px solid rgba(255, 107, 61, 0.5)',
      borderRadius: '4px',
      pointerEvents: 'none' as const,
      zIndex: 50,
    };
  }, [selectionBox, isDragging, containerRef]);

  return {
    isDragging,
    selectionBox,
    selectionStyle,
    justFinishedDrag,
  };
}
