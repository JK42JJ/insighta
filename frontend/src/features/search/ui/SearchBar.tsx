import { useRef, useEffect, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  isLoading: boolean;
  resultCount: number;
  isSearchActive: boolean;
}

export function SearchBar({
  value,
  onChange,
  onClear,
  isLoading,
  resultCount,
  isSearchActive,
}: SearchBarProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClear();
        inputRef.current?.blur();
      }
    },
    [onClear]
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

  return (
    <div className="relative w-full max-w-md">
      <div className="relative flex items-center">
        <Search className="absolute left-3 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('search.placeholder', 'Search cards...')}
          className="w-full h-9 pl-9 pr-9 rounded-lg border border-border/50 bg-surface-mid/50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors"
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
      {isSearchActive && !isLoading && (
        <div className="absolute right-0 top-full mt-1 text-xs text-muted-foreground">
          {resultCount === 0
            ? t('search.noResults', 'No results')
            : t('search.resultCount', '{{count}} results', { count: resultCount })}
        </div>
      )}
    </div>
  );
}
