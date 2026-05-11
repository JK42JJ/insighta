import { useState, useEffect, useCallback } from 'react';
import { Search, ArrowRight } from 'lucide-react';
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

  const handleSubmit = () => {
    onChange(localValue);
  };

  return (
    <div className="relative max-w-[720px] mx-auto mb-5">
      <Search
        className="absolute left-[22px] top-1/2 -translate-y-1/2 w-[18px] h-[18px] pointer-events-none"
        style={{ color: 'hsl(var(--muted-foreground) / 0.6)' }}
      />
      <input
        type="text"
        value={localValue}
        onChange={handleChange}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
        }}
        placeholder={t('explore.search.placeholder')}
        className="w-full py-[18px] pl-14 pr-[60px] rounded-[28px] focus-visible:rounded-[28px] text-[15px] outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
        style={{
          background: 'hsl(var(--input))',
          border: '1px solid hsl(var(--border) / 0.15)',
          color: 'hsl(var(--foreground))',
        }}
      />
      <button
        type="button"
        onClick={handleSubmit}
        aria-label={t('explore.search.submit')}
        className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center transition hover:brightness-110"
        style={{
          background: 'hsl(var(--primary))',
          color: 'hsl(var(--primary-foreground))',
        }}
      >
        <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
      </button>
    </div>
  );
}
