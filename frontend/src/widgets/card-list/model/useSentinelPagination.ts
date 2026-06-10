import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * CP499+ — infinite-scroll pagination whose IntersectionObserver attachment
 * follows the sentinel NODE lifecycle, not a data dependency.
 *
 * The previous CardList implementation attached the observer in a
 * `useEffect(..., [sortedCards.length])`. That effect never re-ran when the
 * sentinel unmounted (visibleCount reached the end → hasMore false) and later
 * REMOUNTED on a same-length list (visibleCount reset on cell/mandala switch)
 * — the observer stayed bound to the detached old node, so infinite scroll
 * died and the tail skeletons never resolved (2026-06-10 prod repro:
 * 25 cards rendered vs 34 placed, stuck across refresh).
 *
 * A callback ref attaches/detaches exactly on mount/unmount of the sentinel.
 * `totalCountRef` keeps the grow-cap fresh inside the observer callback
 * without re-creating the observer on every data change (also kills the
 * stale-closure cap: the old callback could clamp to an outdated length).
 */
export function useSentinelPagination(totalCount: number, pageSize: number) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const totalCountRef = useRef(totalCount);
  totalCountRef.current = totalCount;

  const sentinelRef = useCallback(
    (node: Element | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node) return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            setVisibleCount((prev) => Math.min(prev + pageSize, totalCountRef.current));
          }
        },
        { rootMargin: '200px' }
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [pageSize]
  );

  // Component unmount: the callback ref already fired with null for the
  // sentinel itself; this is a safety net for unmounts that skip it
  // (e.g. an early-return branch replacing the whole grid).
  useEffect(() => () => observerRef.current?.disconnect(), []);

  /** Collapse the window back to the first page (card-set change). */
  const resetVisibleCount = useCallback(() => setVisibleCount(pageSize), [pageSize]);

  return { visibleCount, sentinelRef, resetVisibleCount };
}
