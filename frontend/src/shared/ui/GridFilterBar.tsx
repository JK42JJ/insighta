import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SortOption, SourceFilter } from '../lib/useGridFilter';

interface GridFilterBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  sortBy: SortOption;
  onSortChange: (value: SortOption) => void;
  sourceFilter: SourceFilter;
  onSourceFilterChange: (value: SourceFilter) => void;
  resultCount: number;
}

export function GridFilterBar({
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
  sourceFilter,
  onSourceFilterChange,
  resultCount,
}: GridFilterBarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t('gridView.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="flex items-center gap-2">
        <Select value={sourceFilter} onValueChange={(v) => onSourceFilterChange(v as SourceFilter)}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder={t('gridView.filterSource')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('gridView.sourceAll')}</SelectItem>
            <SelectItem value="youtube">{t('gridView.sourceYouTube')}</SelectItem>
            <SelectItem value="local">{t('gridView.sourceLocal')}</SelectItem>
            <SelectItem value="url">{t('gridView.sourceUrl')}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={(v) => onSortChange(v as SortOption)}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder={t('gridView.sortBy')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="latest">{t('gridView.sortLatest')}</SelectItem>
            <SelectItem value="name">{t('gridView.sortName')}</SelectItem>
            <SelectItem value="type">{t('gridView.sortType')}</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {t('common.cards', { count: resultCount })}
        </span>
      </div>
    </div>
  );
}
