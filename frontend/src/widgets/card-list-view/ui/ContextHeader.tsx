import { useTranslation } from 'react-i18next';
import { ArrowDownUp, Move, Trash2 } from 'lucide-react';
import type { ViewMode } from '@/entities/user/model/types';
import { ViewSwitcher } from '@/features/view-mode';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/shared/ui/dropdown-menu';

export type SortMode = 'latest' | 'oldest' | 'title-asc' | 'title-desc';

interface ContextHeaderProps {
  title: string;
  totalCardCount: number;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  selectedCardIds: string[];
  onDeleteSelected?: () => void;
  sortMode: SortMode;
  onSortModeChange: (mode: SortMode) => void;
  sliderElement?: React.ReactNode;
}

const SORT_OPTIONS: { value: SortMode; labelKey: string }[] = [
  { value: 'latest', labelKey: 'contextHeader.sortLatest' },
  { value: 'oldest', labelKey: 'contextHeader.sortOldest' },
  { value: 'title-asc', labelKey: 'contextHeader.sortTitleAZ' },
  { value: 'title-desc', labelKey: 'contextHeader.sortTitleZA' },
];

export function ContextHeader({
  title,
  totalCardCount,
  viewMode,
  onViewModeChange,
  selectedCardIds,
  onDeleteSelected,
  sortMode,
  onSortModeChange,
  sliderElement,
}: ContextHeaderProps) {
  const { t } = useTranslation();
  const titleInitial = title.charAt(0).toUpperCase();
  const currentSortLabel = SORT_OPTIONS.find((o) => o.value === sortMode);

  return (
    <div data-card-chrome className="flex items-center justify-between mb-1">
      {/* Left: sector badge + title + count + selection */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center justify-center w-6 h-6 rounded bg-primary/10 text-primary text-[11px] font-semibold shrink-0">
          {titleInitial}
        </div>

        <h3 className="text-lg font-semibold leading-tight truncate">{title}</h3>

        <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
          {t('contextHeader.cardCount', '{{count}} cards', { count: totalCardCount })}
        </span>

        {selectedCardIds.length > 0 && (
          <div className="flex items-center gap-1 animate-fade-in shrink-0">
            <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
              {t('cards.selected', { count: selectedCardIds.length })}
            </span>
            <button
              onClick={onDeleteSelected}
              className="p-0.5 rounded text-destructive hover:bg-destructive/10 transition-colors"
              title={t('cards.deleteSelected')}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Right: slider + drag hint + sort + view */}
      <div className="flex items-center gap-1.5 shrink-0">
        {sliderElement}

        {viewMode === 'grid' && (
          <div className="hidden lg:flex items-center gap-0.5 text-[10px] text-muted-foreground">
            <Move className="w-2.5 h-2.5" />
            <span>{t('cards.dragToMove')}</span>
          </div>
        )}

        {/* Sort dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
              <ArrowDownUp className="w-2.5 h-2.5" />
              <span className="hidden sm:inline">
                {currentSortLabel ? t(currentSortLabel.labelKey) : 'Sort'}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuRadioGroup
              value={sortMode}
              onValueChange={(v) => onSortModeChange(v as SortMode)}
            >
              {SORT_OPTIONS.map((opt) => (
                <DropdownMenuRadioItem key={opt.value} value={opt.value} className="text-xs">
                  {t(opt.labelKey)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <ViewSwitcher value={viewMode} onChange={onViewModeChange} />
      </div>
    </div>
  );
}
