import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';

interface LabelFilterPillsProps {
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

export function LabelFilterPills({
  sectors,
  selectedIndex,
  totalCount,
  sectorCounts,
  onSectorClick,
  onAllClick,
}: LabelFilterPillsProps) {
  const { t } = useTranslation();
  const isAllSelected = selectedIndex === null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide pb-1 mb-1.5">
      {/* All pill */}
      <button
        onClick={onAllClick}
        className={cn(
          'shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors',
          isAllSelected
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground hover:bg-muted/80'
        )}
      >
        {t('contextHeader.all', 'All')} {totalCount}
      </button>

      {/* 8 sector pills */}
      {sectors.map((sector, idx) => {
        const isActive = selectedIndex === idx;
        const count = sectorCounts[idx] ?? 0;
        return (
          <button
            key={idx}
            onClick={() => onSectorClick(idx, sector)}
            className={cn(
              'shrink-0 px-2.5 py-0.5 rounded-full text-[11px] transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground font-medium'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            #{sector}
            <span className="ml-1 opacity-70">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
