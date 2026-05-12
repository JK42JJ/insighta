import { useTranslation } from 'react-i18next';
import { LayoutGrid, List, Columns2, Network, BarChart3, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip';
import type { ViewMode } from '@/entities/user/model/types';

interface ViewSwitcherProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const VIEW_OPTIONS = [
  { value: 'grid' as const, icon: LayoutGrid, labelKey: 'view.grid', isBeta: false },
  { value: 'list' as const, icon: List, labelKey: 'view.list', isBeta: true },
  { value: 'list-detail' as const, icon: Columns2, labelKey: 'view.listDetail', isBeta: true },
  { value: 'graph' as const, icon: Network, labelKey: 'view.graph', isBeta: true },
  { value: 'insights' as const, icon: BarChart3, labelKey: 'view.insights', isBeta: true },
];

export function ViewSwitcher({ value, onChange }: ViewSwitcherProps) {
  const { t } = useTranslation();
  const current = VIEW_OPTIONS.find((o) => o.value === value) ?? VIEW_OPTIONS[0];
  const CurrentIcon = current.icon;

  return (
    <DropdownMenu>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('view.switchView', 'Switch view')}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors hover:bg-foreground/[0.04]"
                style={{
                  borderColor: 'hsl(var(--border) / 0.4)',
                  color: 'hsl(var(--foreground))',
                }}
              >
                <CurrentIcon className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {t(current.labelKey)}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="end" className="w-44">
        {VIEW_OPTIONS.map(({ value: v, icon: Icon, labelKey, isBeta }) => {
          const isActive = v === value;
          return (
            <DropdownMenuItem
              key={v}
              onSelect={() => onChange(v)}
              className="flex items-center gap-2 text-[13px] focus:text-foreground"
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">{t(labelKey)}</span>
              {isBeta && (
                <span
                  className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                  style={{
                    background: 'hsl(var(--muted-foreground) / 0.15)',
                    color: 'hsl(var(--muted-foreground))',
                  }}
                >
                  {t('view.beta', 'Beta')}
                </span>
              )}
              {isActive && (
                <Check
                  className="h-3.5 w-3.5 flex-shrink-0"
                  style={{ color: 'hsl(var(--primary))' }}
                />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
