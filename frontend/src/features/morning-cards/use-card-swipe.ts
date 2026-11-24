import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import type { MorningCardVerdict } from '@/features/morning-cards/api';

/** Horizontal drag distance (px) a swipe must pass to count. */
export const SWIPE_DISTANCE_THRESHOLD_PX = 80;

interface UseCardSwipeOptions {
  onSwipe: (verdict: MorningCardVerdict) => void;
  threshold?: number;
}

/** Pointer-based swipe: right = useful, left = skip. No undo, short drags report nothing. */
export function useCardSwipe({
  onSwipe,
  threshold = SWIPE_DISTANCE_THRESHOLD_PX,
}: UseCardSwipeOptions) {
  const startX = useRef<number | null>(null);
  const [dragX, setDragX] = useState(0);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    startX.current = e.clientX;
    setDragX(0);
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    if (startX.current === null) return;
    setDragX(e.clientX - startX.current);
  }, []);

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      if (startX.current === null) return;
      const delta = e.clientX - startX.current;
      startX.current = null;
      setDragX(0);
      if (delta >= threshold) onSwipe('useful');
      else if (delta <= -threshold) onSwipe('skip');
    },
    [onSwipe, threshold]
  );

  const onPointerCancel = useCallback(() => {
    startX.current = null;
    setDragX(0);
  }, []);

  return { dragX, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } };
}
