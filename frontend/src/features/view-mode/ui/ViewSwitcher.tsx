import { useTranslation } from 'react-i18next';
import { LayoutGrid, List, Columns2, Network, BarChart3 } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip';
import type { ViewMode } from '@/entities/user/model/types';

interface ViewSwitcherProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const VIEW_OPTIONS = [
  { value: 'grid' as const, icon: LayoutGrid, labelKey: 'view.grid' },
  { value: 'list' as const, icon: List, labelKey: 'view.list' },
  { value: 'list-detail' as const, icon: Columns2, labelKey: 'view.listDetail' },
  { value: 'graph' as const, icon: Network, labelKey: 'view.graph' },
  { value: 'insights' as const, icon: BarChart3, labelKey: 'view.insights' },
];

export function ViewSwitcher({ value, onChange }: ViewSwitcherProps) {
  const { t } = useTranslation();

  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => {
        if (v) onChange(v as ViewMode);
      }}
      aria-label={t('view.switchView')}
    >
      {VIEW_OPTIONS.map(({ value: v, icon: Icon, labelKey }) => (
        <TooltipProvider key={v} delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem value={v} aria-label={t(labelKey)} className="px-1.5 py-1">
                <Icon className="h-4 w-4" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {t(labelKey)}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </ToggleGroup>
  );
}
