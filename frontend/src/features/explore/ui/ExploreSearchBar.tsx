import { useState, useEffect, useCallback } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const SEARCH_DEBOUNCE_MS = 300;

interface ExploreSearchBarProps {
  value: string;
  onChange: (q: string) => void;
}

export function ExploreSearchBar({ value, onChange }: ExploreSearchBarProps) {
  const { t } = useTranslation();
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const debouncedOnChange = useCallback(
    (() => {
      let timer: ReturnType<typeof setTimeout>;
      return (v: string) => {
        clearTimeout(timer);
        timer = setTimeout(() => onChange(v), SEARCH_DEBOUNCE_MS);
      };
    })(),
    [onChange]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setLocalValue(v);
    debouncedOnChange(v);
  };

  return (
    <div className="relative max-w-[540px] mx-auto mb-6">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-muted-foreground pointer-events-none" />
      <input
        type="text"
        value={localValue}
        onChange={handleChange}
        placeholder={t('explore.search.placeholder')}
        className="w-full py-3 pl-11 pr-4 rounded-xl bg-card border border-border/50 text-foreground text-sm outline-none transition-all focus:border-primary/30 focus:ring-4 focus:ring-primary/10 placeholder:text-muted-foreground placeholder:font-light"
      />
    </div>
  );
}
