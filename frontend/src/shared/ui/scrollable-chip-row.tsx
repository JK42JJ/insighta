/**
 * ScrollableChipRow — single-line chip lane with edge-fade + chevron paging.
 *
 * Same affordance as the sector filter bar (LabelFilterPillsV2, James
 * 2026-07-02 "동일한 처리"): chevrons render ONLY while that side actually
 * overflows, over a gradient fade so clipped chips read as "more here".
 * Built for use INSIDE clickable cards — chevron clicks stop propagation.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { pageScroll } from '@/shared/lib/page-scroll';

interface Props {
  children: React.ReactNode;
  /** Classes for the inner scroll lane (flex row). */
  laneClassName?: string;
  /** Tailwind gradient-from color matching the surface behind the row
   *  (e.g. 'from-card' inside cards, 'from-background' on the page). */
  fadeFrom?: string;
  className?: string;
}

export function ScrollableChipRow({
  children,
  laneClassName,
  fadeFrom = 'from-card',
  className,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      setCanLeft(el.scrollLeft > 8);
      setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [children]);

  // One full visible page per click (2026-07-02 James: "찔끔" 금지,
  // 시원시원하게) — the lane's own clientWidth IS the page size.
  // One full visible page per click (2026-07-02 James: "찔끔" 금지,
  // 시원시원하게). rAF-based — see shared/lib/page-scroll.ts for why
  // options-form smooth scrollBy can't be used here.
  const scrollByPage = (dir: 1 | -1) => pageScroll(scrollRef.current, dir);

  return (
    <div className={cn('relative', className)}>
      <div
        ref={scrollRef}
        className={cn(
          'flex flex-nowrap items-center overflow-x-auto scrollbar-none',
          laneClassName
        )}
      >
        {children}
      </div>

      {canLeft && (
        <div
          className={cn(
            'absolute left-0 inset-y-0 z-10 flex items-center pr-2 bg-gradient-to-r via-card/95 to-transparent pointer-events-none',
            fadeFrom
          )}
        >
          <button
            type="button"
            aria-label="scroll left"
            onClick={(e) => {
              e.stopPropagation();
              scrollByPage(-1);
            }}
            className="pointer-events-auto inline-flex items-center justify-center w-5 h-5 rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors duration-150"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {canRight && (
        <div
          className={cn(
            'absolute right-0 inset-y-0 z-10 flex items-center pl-2 bg-gradient-to-l via-card/95 to-transparent pointer-events-none',
            fadeFrom
          )}
        >
          <button
            type="button"
            aria-label="scroll right"
            onClick={(e) => {
              e.stopPropagation();
              scrollByPage(1);
            }}
            className="pointer-events-auto inline-flex items-center justify-center w-5 h-5 rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors duration-150"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
