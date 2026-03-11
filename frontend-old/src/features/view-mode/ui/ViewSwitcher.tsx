import { useTranslation } from 'react-i18next';
import { LayoutGrid, List, LayoutDashboard, Grid3X3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VIEW_MODES } from '../model/types';
import type { ViewMode } from '../model/types';

const VIEW_ICONS: Record<ViewMode, typeof LayoutGrid> = {
  mandala: Grid3X3,
  grid: LayoutGrid,
  list: List,
  dashboard: LayoutDashboard,
};

interface ViewSwitcherProps {
  current: ViewMode;
  onChange: (mode: ViewMode) => void;
  className?: string;
}

export function ViewSwitcher({ current, onChange, className }: ViewSwitcherProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn('flex items-center rounded-lg bg-muted p-1 gap-0.5', className)}
      role="tablist"
      aria-label={t('viewMode.label')}
    >
      {VIEW_MODES.map(({ mode, labelKey }) => {
        const Icon = VIEW_ICONS[mode];
        const isActive = current === mode;
        return (
          <button
            key={mode}
            role="tab"
            aria-selected={isActive}
            aria-label={t(labelKey)}
            title={t(labelKey)}
            onClick={() => onChange(mode)}
            className={cn(
              'flex items-center justify-center rounded-md p-1.5 transition-all duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
