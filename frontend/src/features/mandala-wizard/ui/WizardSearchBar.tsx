import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, ArrowRight, Loader2, X, Lock } from 'lucide-react';

import { apiClient, type TemplateTypeaheadResult } from '@/shared/lib/api-client';
import { DOMAIN_STYLES, type MandalaDomain, getDomainLabel } from '@/shared/config/domain-colors';

// ─── Typeahead constants ───
//
// Step-1 dropdown surfaces matching template titles after the user pauses
// typing. Only active when `enableTypeahead === true` (passed by step-1
// caller). Step-2 (focus tags input) and step-3 (read-only locked bar) do
// NOT receive this prop.
const TYPEAHEAD_DEBOUNCE_MS = 250;
const TYPEAHEAD_MIN_QUERY_LENGTH = 2;
const TYPEAHEAD_MAX_VISIBLE_ROWS = 5;

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
  /** When true, input is non-editable (used in step 3 "lock" state). */
  readOnly?: boolean;
  /** When provided, the submit button shows this text label instead of the
   *  default arrow icon. Used to swap the arrow for "검색하기" in step 3. */
  submitLabel?: string;
  /** When true, submit button is disabled even with non-empty value (e.g.
   *  step 3 requires a selected template before "검색하기"). */
  submitDisabled?: boolean;
  /** Step-2 focus tags shown read-only as chips beneath the goal value when
   *  readOnly is true (step-3 context display). Empty/undefined ⇒ 1-row. */
  focusTagsContext?: string[];
  /**
   * When true, surfaces a typeahead dropdown of matching template titles
   * below the input. Active only on step 1 (passed by `WizardStepGoal`
   * when `!isResultsView`). Click on a row fills the input value but does
   * NOT auto-submit — the user must explicitly press the submit button or
   * Enter to advance. Default: false (no dropdown).
   */
  enableTypeahead?: boolean;
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
  readOnly,
  submitLabel,
  submitDisabled,
  focusTagsContext,
  enableTypeahead = false,
}: WizardSearchBarProps) {
  const { i18n } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  // ─── Typeahead state ───
  // Only ever populated when `enableTypeahead` is true. Other callers
  // short-circuit the effect below.
  const [typeaheadResults, setTypeaheadResults] = useState<TemplateTypeaheadResult[]>([]);
  const [isTypeaheadOpen, setIsTypeaheadOpen] = useState(false);
  const [isTypeaheadLoading, setIsTypeaheadLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  // After the user selects a row, we suppress the dropdown for that exact
  // value so they're not re-prompted with the same suggestion. Cleared as
  // soon as the user edits the value (manual typing).
  const [suppressedValue, setSuppressedValue] = useState<string | null>(null);

  // Debounce + fetch effect. Skipped entirely on the read-only / step-2-3
  // search bar. Aborts the in-flight request when the input changes again
  // before the network resolves so we never show stale rows.
  useEffect(() => {
    if (!enableTypeahead || readOnly) {
      setTypeaheadResults([]);
      setIsTypeaheadOpen(false);
      setIsTypeaheadLoading(false);
      return;
    }
    const trimmed = value.trim();
    if (trimmed.length < TYPEAHEAD_MIN_QUERY_LENGTH) {
      setTypeaheadResults([]);
      setIsTypeaheadOpen(false);
      setIsTypeaheadLoading(false);
      return;
    }
    // Suppress dropdown when value equals the last selected suggestion —
    // the user already chose this one, re-showing it is noise.
    if (suppressedValue !== null && value === suppressedValue) {
      setTypeaheadResults([]);
      setIsTypeaheadOpen(false);
      setIsTypeaheadLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsTypeaheadLoading(true);
      try {
        const rows = await apiClient.searchTemplatesTypeahead(trimmed, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const limited = rows.slice(0, TYPEAHEAD_MAX_VISIBLE_ROWS);
        setTypeaheadResults(limited);
        setIsTypeaheadOpen(limited.length > 0);
        setActiveIdx(-1);
      } catch (err) {
        // Silent fail — typeahead is a non-essential progressive enhancement.
        // The user can still submit the form normally; logging would noisy
        // prod consoles for every aborted/canceled fetch.
        if (!controller.signal.aborted) {
          setTypeaheadResults([]);
          setIsTypeaheadOpen(false);
        }
        void err;
      } finally {
        if (!controller.signal.aborted) setIsTypeaheadLoading(false);
      }
    }, TYPEAHEAD_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [value, enableTypeahead, readOnly, suppressedValue]);

  // Clear suppression as soon as the user edits the value (their typing
  // diverges from the last selected suggestion).
  useEffect(() => {
    if (suppressedValue !== null && value !== suppressedValue) {
      setSuppressedValue(null);
    }
  }, [value, suppressedValue]);

  // Clamp activeIdx whenever the result set shrinks (e.g., narrowing query).
  useEffect(() => {
    if (activeIdx >= typeaheadResults.length) setActiveIdx(-1);
  }, [typeaheadResults.length, activeIdx]);

  const closeTypeahead = () => {
    setIsTypeaheadOpen(false);
    setActiveIdx(-1);
  };

  const handleSelectTypeahead = (result: TemplateTypeaheadResult) => {
    // Fill input value with the chosen template's center_goal. Per spec (1c),
    // this MUST NOT trigger a submit — the user reviews/edits, then presses
    // "검색하기" or Enter to advance.
    onChange(result.center_goal);
    setSuppressedValue(result.center_goal);
    closeTypeahead();
    // Restore focus so keyboard users can immediately continue typing.
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!enableTypeahead || readOnly) return;
    if (!isTypeaheadOpen || typeaheadResults.length === 0) {
      // Allow Esc to close even when momentarily closed (no-op otherwise).
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((prev) => (prev + 1) % typeaheadResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((prev) => (prev <= 0 ? typeaheadResults.length - 1 : prev - 1));
    } else if (e.key === 'Enter') {
      // Enter on highlighted row = select; Enter with no highlight = let
      // form submit handle it normally (don't intercept).
      if (activeIdx >= 0 && activeIdx < typeaheadResults.length) {
        e.preventDefault();
        handleSelectTypeahead(typeaheadResults[activeIdx]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeTypeahead();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) {
      onCancel?.();
      return;
    }
    if (submitDisabled) return;
    if (value.trim()) onSubmit();
  };

  const hasTextSubmit = !!submitLabel && !isBusy;
  // 2-row layout = readOnly + at least one focus tag. Empty/undefined falls
  // back to 1-row.
  const showTwoRow = !!readOnly && Array.isArray(focusTagsContext) && focusTagsContext.length > 0;

  if (showTwoRow) {
    // 2-row read-only layout: top = lock + goal value, divider, bottom = focus tags chips
    return (
      <form
        onSubmit={handleSubmit}
        className="relative mx-auto w-full max-w-[720px] rounded-[28px]"
        style={{
          background: 'hsl(var(--input))',
          border: '1px solid hsl(var(--border) / 0.15)',
        }}
      >
        {/* Row 1: lock + goal value (read-only) */}
        <div className="flex items-center gap-2.5 px-5 pt-3 pb-2.5">
          <Lock
            className="h-[16px] w-[16px] flex-shrink-0"
            style={{ color: 'hsl(var(--muted-foreground) / 0.6)' }}
            strokeWidth={2}
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            readOnly
            className="caret-transparent cursor-default w-full border-none bg-transparent text-[15px] outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
            style={{ color: 'hsl(var(--foreground) / 0.8)' }}
            aria-label={ariaLabel}
            aria-readonly
          />
        </div>
        {/* Row 2: focus tags chips (left, wrap) + submit btn (right, aligned to row 2) */}
        <div className="flex items-center gap-2 pl-5 pr-2 pt-2.5 pb-3">
          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            {focusTagsContext!.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-md px-2 py-1 text-[12px] font-semibold"
                style={{
                  background: 'hsl(var(--primary) / 0.12)',
                  color: 'hsl(var(--primary))',
                }}
              >
                {tag}
              </span>
            ))}
          </div>
          <button
            type="submit"
            disabled={submitDisabled}
            aria-label={ariaSubmitLabel}
            className="ml-auto inline-flex h-10 flex-shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: 'hsl(var(--primary))',
              color: 'hsl(var(--primary-foreground))',
            }}
          >
            {submitLabel ?? ''}
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="relative mx-auto w-full max-w-[720px]"
      onBlur={(e) => {
        // Close the dropdown only when focus leaves the form entirely.
        // Prevents a click on a typeahead row from closing the dropdown
        // before the row's onMouseDown / onClick fires.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          closeTypeahead();
        }
      }}
    >
      {readOnly ? (
        <Lock
          className="pointer-events-none absolute left-[22px] top-1/2 h-[16px] w-[16px] -translate-y-1/2"
          style={{ color: 'hsl(var(--muted-foreground) / 0.6)' }}
          strokeWidth={2}
          aria-hidden="true"
        />
      ) : (
        <Search
          className="pointer-events-none absolute left-[22px] top-1/2 h-[18px] w-[18px] -translate-y-1/2"
          style={{ color: 'hsl(var(--muted-foreground) / 0.6)' }}
          strokeWidth={1.8}
          aria-hidden="true"
        />
      )}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          // Re-open dropdown if user re-focuses with already-cached results.
          if (enableTypeahead && !readOnly && typeaheadResults.length > 0) {
            setIsTypeaheadOpen(true);
          }
        }}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`w-full rounded-[28px] py-[18px] pl-14 text-[15px] outline-none focus-visible:rounded-[28px] focus-visible:ring-0 focus-visible:ring-offset-0 ${
          readOnly ? 'caret-transparent cursor-default' : ''
        }`}
        style={{
          background: 'hsl(var(--input))',
          border: '1px solid hsl(var(--border) / 0.15)',
          color: readOnly ? 'hsl(var(--foreground) / 0.8)' : 'hsl(var(--foreground))',
          paddingRight: hasTextSubmit ? '140px' : '100px',
        }}
        aria-label={ariaLabel}
        aria-readonly={readOnly}
        aria-autocomplete={enableTypeahead && !readOnly ? 'list' : undefined}
        aria-expanded={enableTypeahead && !readOnly ? isTypeaheadOpen : undefined}
        aria-controls={enableTypeahead && !readOnly ? 'wizard-typeahead-listbox' : undefined}
        role={enableTypeahead && !readOnly ? 'combobox' : undefined}
      />
      {!isBusy && !readOnly && value.length > 0 && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-[60px] top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
          aria-label="Clear"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      )}
      {hasTextSubmit ? (
        <button
          type="submit"
          disabled={submitDisabled}
          aria-label={ariaSubmitLabel}
          className="absolute right-2 top-1/2 flex h-10 -translate-y-1/2 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            background: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
          }}
        >
          {submitLabel}
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!isBusy && (submitDisabled || !value.trim())}
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
      )}

      {/* ─── Typeahead dropdown ───
          Absolute below the oval input, same width. mt-2 keeps it visually
          tied to the bar without overlapping the focus ring. The container
          itself is non-focusable; rows use mousedown so focus stays inside
          the form (preserving the input cursor). */}
      {enableTypeahead && !readOnly && isTypeaheadOpen && typeaheadResults.length > 0 && (
        <ul
          id="wizard-typeahead-listbox"
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl"
          style={{
            background: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border) / 0.15)',
            boxShadow:
              '0 10px 15px -3px hsl(var(--foreground) / 0.08), 0 4px 6px -4px hsl(var(--foreground) / 0.05)',
          }}
        >
          {typeaheadResults.map((result, idx) => {
            const isActive = idx === activeIdx;
            const ds =
              result.domain && DOMAIN_STYLES[result.domain as MandalaDomain]
                ? DOMAIN_STYLES[result.domain as MandalaDomain]
                : null;
            const badgeStyle: CSSProperties | undefined = ds
              ? { backgroundColor: ds.dim, color: ds.color }
              : undefined;
            const domainLabel = ds
              ? getDomainLabel(result.domain as MandalaDomain, i18n.language)
              : null;
            return (
              <li
                key={result.mandala_id}
                role="option"
                aria-selected={isActive}
                onMouseDown={(e) => {
                  // mousedown (not click) so the input's blur handler doesn't
                  // close the dropdown before selection registers.
                  e.preventDefault();
                  handleSelectTypeahead(result);
                }}
                onMouseEnter={() => setActiveIdx(idx)}
                className="flex cursor-pointer items-center gap-2.5 px-4 py-2.5 transition-colors"
                style={{
                  background: isActive ? 'hsl(var(--foreground) / 0.04)' : 'transparent',
                }}
              >
                <Search
                  className="h-4 w-4 flex-shrink-0"
                  style={{ color: 'hsl(var(--muted-foreground) / 0.65)' }}
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
                <span
                  className="flex-1 truncate text-[14px]"
                  style={{ color: 'hsl(var(--foreground))' }}
                >
                  {result.center_goal}
                </span>
                {domainLabel && (
                  <span
                    className="inline-flex flex-shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
                    style={badgeStyle}
                  >
                    {domainLabel}
                  </span>
                )}
                {isTypeaheadLoading && idx === 0 && (
                  <Loader2
                    className="h-3.5 w-3.5 flex-shrink-0 animate-spin"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </form>
  );
}
