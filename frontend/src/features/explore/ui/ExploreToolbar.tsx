import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';

type Source = 'all' | 'template' | 'community';
type Sort = 'popular' | 'recent' | 'cloned';

interface ExploreToolbarProps {
  total: number;
  source: Source;
  sort: Sort;
  onSourceChange: (source: Source) => void;
  onSortChange: (sort: Sort) => void;
}

const SOURCES: Source[] = ['all', 'template', 'community'];
const SORTS: Sort[] = ['popular', 'recent', 'cloned'];

export function ExploreToolbar({
  total,
  source,
  sort,
  onSourceChange,
  onSortChange,
}: ExploreToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex justify-between items-center mb-5">
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-muted-foreground/50">
          <strong className="text-muted-foreground font-semibold">{total}</strong>
          {t('explore.toolbar.count')}
        </span>
        {/* Source tabs */}
        <div className="flex gap-0.5 bg-card rounded-lg p-0.5 border border-border/30 ml-3">
          {SOURCES.map((s) => (
            <button
              key={s}
              onClick={() => onSourceChange(s)}
              className={cn(
                'px-3 py-1 rounded-md text-xs font-medium transition-all duration-200',
                source === s
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground/50 hover:text-muted-foreground'
              )}
            >
              {t(`explore.source.${s}`)}
            </button>
          ))}
        </div>
      </div>
      {/* Sort pills */}
      <div className="flex gap-0.5 bg-card rounded-lg p-0.5 border border-border/30">
        {SORTS.map((s) => (
          <button
            key={s}
            onClick={() => onSortChange(s)}
            className={cn(
              'px-3.5 py-1 rounded-md text-xs font-medium transition-all duration-200',
              sort === s
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground/50 hover:text-muted-foreground'
            )}
          >
            {t(`explore.sort.${s}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
