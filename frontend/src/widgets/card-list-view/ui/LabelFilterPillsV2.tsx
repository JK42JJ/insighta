import { useTranslation } from 'react-i18next';
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
}

export function LabelFilterPillsV2({
  sectors,
  selectedIndex,
  totalCount,
  sectorCounts,
  onSectorClick,
  onAllClick,
}: LabelFilterPillsV2Props) {
  const { t } = useTranslation();
  const isAllSelected = selectedIndex === null;

  return (
    <div
      data-card-chrome
      className="flex items-center gap-0 overflow-x-auto scrollbar-hide pb-1 mb-1.5"
    >
      {/* All tab */}
      <button
        onClick={onAllClick}
        className={cn(
          'relative shrink-0 mr-3 pb-1 text-[11px] font-medium transition-colors bg-transparent border-none cursor-pointer',
          isAllSelected
            ? 'text-[var(--t1,#ededf0)] font-bold'
            : 'text-[var(--t3,#5a5b68)] hover:text-[var(--t2,#9394a0)]'
        )}
      >
        {t('contextHeader.all', 'All')}
        <span className="ml-[3px] text-[10px] font-medium text-[var(--t4,#3a3b46)]">
          {totalCount}
        </span>
        {isAllSelected && (
          <span className="absolute bottom-[-2px] left-0 right-0 h-[2px] bg-[var(--ind,#818cf8)] rounded-full" />
        )}
      </button>

      {/* 8 sector tabs */}
      {sectors.map((sector, idx) => {
        const isActive = selectedIndex === idx;
        const count = sectorCounts[idx] ?? 0;
        return (
          <button
            key={idx}
            onClick={() => onSectorClick(idx, sector)}
            className={cn(
              'relative shrink-0 mr-3 pb-1 text-[11px] font-medium transition-colors bg-transparent border-none cursor-pointer',
              isActive
                ? 'text-[var(--t1,#ededf0)] font-bold'
                : 'text-[var(--t3,#5a5b68)] hover:text-[var(--t2,#9394a0)]'
            )}
          >
            {sector}
            <span className="ml-[3px] text-[10px] font-medium text-[var(--t4,#3a3b46)]">
              {count}
            </span>
            {isActive && (
              <span className="absolute bottom-[-2px] left-0 right-0 h-[2px] bg-[var(--ind,#818cf8)] rounded-full" />
            )}
          </button>
        );
      })}
    </div>
  );
}
