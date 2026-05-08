import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

interface LabelFilterPillsV2Props {
  /** 8 sector names from currentLevel.subjects */
  sectors: string[];
  /** Currently selected sector index (0-7), null = All */
  selectedIndex: number | null;
  /** Total card count (shown on All pill) */
  totalCount: number;
  /** Card count per sector (index 0-7) */
  sectorCounts: number[];
  /** Called when a sector pill is clicked (index 0-7) */
  onSectorClick: (cellIndex: number, subject: string) => void;
  /** Called when All pill is clicked (deselect sector) */
  onAllClick: () => void;
  /**
   * Issue #389: count of synced videos mapped to this mandala but not yet
   * placed into a cell. Pill is hidden entirely when 0.
   */
  newlySyncedCount?: number;
  /** True when the "Newly Synced" pill is the active filter. */
  isNewlySyncedSelected?: boolean;
  /** Called when the "Newly Synced" pill is clicked. */
  onNewlySyncedClick?: () => void;
}

// CP444 — YouTube-style pill chrome. Active = filled, inactive = muted soft;
// underline indicator retired. Edge-fade + chevron buttons surface horizontal
// scroll affordance only when the row actually overflows.
const PILL_BASE =
  'shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150';
const PILL_ACTIVE = 'bg-foreground text-background';
const PILL_INACTIVE = 'bg-muted/40 text-muted-foreground hover:bg-muted/60';
const SCROLL_DELTA = 200;

export function LabelFilterPillsV2({
  sectors,
  selectedIndex,
  totalCount,
  sectorCounts,
  onSectorClick,
  onAllClick,
  newlySyncedCount = 0,
  isNewlySyncedSelected = false,
  onNewlySyncedClick,
}: LabelFilterPillsV2Props) {
  const { t } = useTranslation();
  const isAllSelected = selectedIndex === null && !isNewlySyncedSelected;
  const showNewlySynced = newlySyncedCount > 0 && typeof onNewlySyncedClick === 'function';

  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      setCanScrollLeft(el.scrollLeft > 0);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };

    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);

    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [sectors.length, showNewlySynced]);

  const handleScrollBy = (delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  };

  return (
    <div data-card-chrome className="relative mb-1.5">
      <div ref={scrollRef} className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-1">
        {/* All pill */}
        <button
          onClick={onAllClick}
          className={cn(PILL_BASE, isAllSelected ? PILL_ACTIVE : PILL_INACTIVE)}
        >
          {t('contextHeader.all', 'All')}
          <span className="text-[11px] font-medium opacity-70">{totalCount}</span>
        </button>

        {/* 8 sector pills */}
        {sectors.map((sector, idx) => {
          const isActive = selectedIndex === idx && !isNewlySyncedSelected;
          const count = sectorCounts[idx] ?? 0;
          return (
            <button
              key={idx}
              onClick={() => onSectorClick(idx, sector)}
              className={cn(PILL_BASE, isActive ? PILL_ACTIVE : PILL_INACTIVE)}
            >
              {sector}
              <span className="text-[11px] font-medium opacity-70">{count}</span>
            </button>
          );
        })}

        {/* Issue #389 — Newly Synced pill: primary accent + leading dot
            preserved (data signal); only the underline indicator was removed
            in line with the rest of the row. */}
        {showNewlySynced && (
          <button
            onClick={onNewlySyncedClick}
            className={cn(
              PILL_BASE,
              isNewlySyncedSelected
                ? 'bg-[var(--ind,#818cf8)] text-background'
                : 'bg-[var(--ind,#818cf8)]/15 text-[var(--ind,#818cf8)] hover:bg-[var(--ind,#818cf8)]/25'
            )}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" aria-hidden="true" />
            {t('labelFilter.newlySynced', 'Newly Synced')}
            <span className="text-[11px] font-medium opacity-70">{newlySyncedCount}</span>
          </button>
        )}
      </div>

      {/* Left edge fade + chevron — only when overflow exists on the left */}
      {canScrollLeft && (
        <div className="absolute left-0 inset-y-0 z-10 flex items-center pr-3 pl-1 bg-gradient-to-r from-background via-background/95 to-transparent pointer-events-none">
          <button
            type="button"
            onClick={() => handleScrollBy(-SCROLL_DELTA)}
            aria-label={t('labelFilter.scrollLeft', 'Scroll left')}
            className="pointer-events-auto inline-flex items-center justify-center w-8 h-6 rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors duration-150"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Right edge fade + chevron — only when overflow exists on the right */}
      {canScrollRight && (
        <div className="absolute right-0 inset-y-0 z-10 flex items-center pl-3 pr-1 bg-gradient-to-l from-background via-background/95 to-transparent pointer-events-none">
          <button
            type="button"
            onClick={() => handleScrollBy(SCROLL_DELTA)}
            aria-label={t('labelFilter.scrollRight', 'Scroll right')}
            className="pointer-events-auto inline-flex items-center justify-center w-8 h-6 rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors duration-150"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
