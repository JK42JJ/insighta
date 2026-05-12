import { useRef } from 'react';
import { Search, ArrowRight, Loader2, X } from 'lucide-react';

interface WizardSearchBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  onClear?: () => void;
  placeholder?: string;
  isBusy?: boolean;
  ariaLabel?: string;
  ariaSubmitLabel?: string;
}

export function WizardSearchBar({
  value,
  onChange,
  onSubmit,
  onCancel,
  onClear,
  placeholder,
  isBusy,
  ariaLabel,
  ariaSubmitLabel,
}: WizardSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) {
      onCancel?.();
      return;
    }
    if (value.trim()) onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="relative mx-auto w-full max-w-[720px]">
      <Search
        className="pointer-events-none absolute left-[22px] top-1/2 h-[18px] w-[18px] -translate-y-1/2"
        style={{ color: 'hsl(var(--muted-foreground) / 0.6)' }}
        strokeWidth={1.8}
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[28px] py-[18px] pl-14 pr-[100px] text-[15px] outline-none focus-visible:rounded-[28px] focus-visible:ring-0 focus-visible:ring-offset-0"
        style={{
          background: 'hsl(var(--input))',
          border: '1px solid hsl(var(--border) / 0.15)',
          color: 'hsl(var(--foreground))',
        }}
        aria-label={ariaLabel}
      />
      {!isBusy && value.length > 0 && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-[60px] top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
          aria-label="Clear"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      )}
      <button
        type="submit"
        disabled={!isBusy && !value.trim()}
        aria-label={ariaSubmitLabel}
        className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          background: 'hsl(var(--primary))',
          color: 'hsl(var(--primary-foreground))',
        }}
      >
        {isBusy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
        )}
      </button>
    </form>
  );
}
