import { useRef, useEffect, useCallback } from 'react';
import { Search, X, Loader2, Youtube, Link2, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SourceFilter } from '../model/useSearchCards';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  isLoading: boolean;
  resultCount: number;
  filteredCount: number;
  isSearchActive: boolean;
  sourceFilter: SourceFilter;
  onSourceFilterChange: (filter: SourceFilter) => void;
  onArrowDown: () => void;
  onArrowUp: () => void;
  onEnter: () => void;
}

const SOURCE_FILTERS: { value: SourceFilter; icon: typeof Youtube; labelKey: string }[] = [
  { value: 'youtube', icon: Youtube, labelKey: 'search.filterYouTube' },
  { value: 'link', icon: Link2, labelKey: 'search.filterLink' },
  { value: 'file', icon: FileText, labelKey: 'search.filterFile' },
];

export function SearchBar({
  value,
  onChange,
  onClear,
  isLoading,
  resultCount,
  filteredCount,
  isSearchActive,
  sourceFilter,
  onSourceFilterChange,
  onArrowDown,
  onArrowUp,
  onEnter,
}: SearchBarProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClear();
          inputRef.current?.blur();
          break;
        case 'ArrowDown':
          e.preventDefault();
          onArrowDown();
          break;
        case 'ArrowUp':
          e.preventDefault();
          onArrowUp();
          break;
        case 'Enter':
          e.preventDefault();
          onEnter();
          break;
      }
    },
    [onClear, onArrowDown, onArrowUp, onEnter]
  );

  // Cmd/Ctrl+K to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleFilterClick = useCallback(
    (filter: SourceFilter) => {
      onSourceFilterChange(sourceFilter === filter ? 'all' : filter);
    },
    [sourceFilter, onSourceFilterChange]
  );

  return (
    <div className="relative w-full">
      <div className="relative flex items-center">
        <Search className="absolute left-3 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('search.placeholder', 'Search cards... (⌘K)')}
          className="w-full h-9 pl-9 pr-9 rounded-lg border border-border/50 bg-surface-mid/50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors"
          role="combobox"
          aria-expanded={isSearchActive}
          aria-haspopup="listbox"
        />
        {isLoading && (
          <Loader2 className="absolute right-3 w-4 h-4 text-muted-foreground animate-spin" />
        )}
        {!isLoading && value.length > 0 && (
          <button
            onClick={onClear}
            className="absolute right-3 w-4 h-4 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={t('search.clear', 'Clear search')}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Source type filter chips — absolute to avoid pushing header height */}
      {isSearchActive && (
        <div className="absolute left-0 top-full mt-1 z-50 flex items-center gap-1.5 bg-surface-mid/95 backdrop-blur-sm rounded-lg px-2 py-1.5 border border-border/30 shadow-lg">
          {SOURCE_FILTERS.map(({ value: filterValue, icon: Icon, labelKey }) => {
            const isActive = sourceFilter === filterValue;
            return (
              <button
                key={filterValue}
                onClick={() => handleFilterClick(filterValue)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-surface-mid/80 text-muted-foreground hover:text-foreground hover:bg-surface-mid'
                }`}
                aria-pressed={isActive}
              >
                <Icon className="w-3 h-3" />
                {t(labelKey)}
              </button>
            );
          })}
          <span className="ml-auto text-xs text-muted-foreground">
            {filteredCount === resultCount
              ? t('search.resultCount', '{{count}} results', { count: resultCount })
              : t('search.filteredCount', '{{filtered}} of {{total}}', {
                  filtered: filteredCount,
                  total: resultCount,
                })}
          </span>
        </div>
      )}
    </div>
  );
}
