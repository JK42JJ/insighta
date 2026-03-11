import { useTranslation } from 'react-i18next';
import { Home, LayoutGrid, List, LayoutDashboard, Grid3X3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ViewMode } from '@/features/view-mode';

interface MobileBottomNavProps {
  currentView: ViewMode;
  onViewChange: (mode: ViewMode) => void;
  onNavigateHome?: () => void;
}

const NAV_ITEMS: { mode: ViewMode; icon: typeof LayoutGrid; labelKey: string }[] = [
  { mode: 'mandala', icon: Grid3X3, labelKey: 'viewMode.mandala' },
  { mode: 'grid', icon: LayoutGrid, labelKey: 'viewMode.grid' },
  { mode: 'list', icon: List, labelKey: 'viewMode.list' },
  { mode: 'dashboard', icon: LayoutDashboard, labelKey: 'viewMode.dashboard' },
];

export function MobileBottomNav({
  currentView,
  onViewChange,
  onNavigateHome,
}: MobileBottomNavProps) {
  const { t } = useTranslation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-surface-mid/95 backdrop-blur-md safe-area-bottom md:hidden">
      <div className="flex items-center justify-around px-2 py-1">
        {/* Home */}
        <button
          type="button"
          onClick={onNavigateHome}
          className="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors min-w-[3rem]"
        >
          <Home className="h-5 w-5" />
          <span className="text-[10px] font-medium">{t('header.home')}</span>
        </button>

        {/* View modes */}
        {NAV_ITEMS.map(({ mode, icon: Icon, labelKey }) => {
          const isActive = currentView === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onViewChange(mode)}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors min-w-[3rem]',
                isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{t(labelKey)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
