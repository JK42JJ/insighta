import { useState, useRef } from 'react';
import { Search, X as XIcon } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

interface ChipOption {
  id: string;
  label: string;
}

interface SearchWithChipsProps {
  query: string;
  onQueryChange: (q: string) => void;
  placeholder?: string;
  filterOptions: ChipOption[];
  activeFilter: string;
  onFilterChange: (id: string) => void;
  sortOptions: ChipOption[];
  activeSort: string;
  onSortChange: (id: string) => void;
}

export function SearchWithChips({
  query,
  onQueryChange,
  placeholder = 'Search...',
  filterOptions,
  activeFilter,
  onFilterChange,
  sortOptions,
  activeSort,
  onSortChange,
}: SearchWithChipsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const handleFocus = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsOpen(true);
  };

  const handleBlur = () => {
    timeoutRef.current = setTimeout(() => setIsOpen(false), 200);
  };

  return (
    <div className="relative flex-1">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-[15px] h-[15px] text-muted-foreground/50" />
      <input
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        className="w-full bg-surface-light border border-border rounded-[7px] py-[9px] pl-[38px] pr-8 text-[13px] text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-primary"
      />
      {query && (
        <button
          onClick={() => onQueryChange('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        >
          <XIcon className="w-3.5 h-3.5" />
        </button>
      )}
      {isOpen && (
        <div className="absolute top-[calc(100%+2px)] left-0 right-0 bg-surface-base border border-border rounded-b-[7px] px-2 py-[5px] flex flex-wrap items-center gap-1 z-20 shadow-xl">
          {filterOptions.map((opt) => (
            <button
              key={opt.id}
              onMouseDown={(e) => {
                e.preventDefault();
                onFilterChange(opt.id);
              }}
              className={cn(
                'text-[11px] px-2.5 py-1 rounded cursor-pointer transition-all select-none',
                activeFilter === opt.id
                  ? 'text-primary bg-primary/10 font-semibold'
                  : 'text-muted-foreground hover:text-muted-foreground/80 hover:bg-white/[.04]'
              )}
            >
              {opt.label}
            </button>
          ))}
          <span className="text-muted-foreground/40 text-[10px] mx-0.5">|</span>
          {sortOptions.map((opt) => (
            <button
              key={opt.id}
              onMouseDown={(e) => {
                e.preventDefault();
                onSortChange(opt.id);
              }}
              className={cn(
                'text-[11px] px-2.5 py-1 rounded cursor-pointer transition-all select-none',
                activeSort === opt.id
                  ? 'text-primary bg-primary/10 font-semibold'
                  : 'text-muted-foreground hover:text-muted-foreground/80 hover:bg-white/[.04]'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
