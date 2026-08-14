import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import type { ViewMode } from '@/entities/user/model/types';
import { ViewSwitcher } from '@/features/view-mode';

// P3 Stage 2 (CP513, 2026-07-07 James finalize) — restored to the approved
// 3-filter design: [relevance (default) | latest | most-viewed]. relevance is
// re-exposed AND made the default now that the pgvector relevance backfill
// populates coverage (P3 Stage 1 hid it at 5.7% to avoid a NULL-default fraud).
// 'views' keeps its view_count DESC backing and the honest "조회수" label.
export type SortMode = 'latest' | 'views' | 'relevance-desc';

export const SORT_OPTIONS: { value: SortMode; labelKey: string }[] = [
  { value: 'relevance-desc', labelKey: 'contextHeader.sortRelevance' },
  { value: 'latest', labelKey: 'contextHeader.sortLatest' },
  { value: 'views', labelKey: 'contextHeader.sortViews' },
];

interface ContextHeaderProps {
  title: string;
  /** Render title + initial badge as shimmer while mandala detail query is loading. */
  titleLoading?: boolean;
  totalCardCount: number;
  /** Cards are still streaming in (wizard fill) — show a subtle spinner. */
  isFilling?: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  selectedCardIds: string[];
  onDeleteSelected?: () => void;
  sliderElement?: React.ReactNode;
  /** CP442 — slot left of ViewSwitcher (e.g., IdeaSpot trigger button). */
  trailingAction?: React.ReactNode;
}

export function ContextHeader({
  title,
  titleLoading,
  totalCardCount,
  isFilling,
  viewMode,
  onViewModeChange,
  selectedCardIds,
  onDeleteSelected,
  sliderElement,
  trailingAction,
}: ContextHeaderProps) {
  const { t } = useTranslation();
  const titleInitial = title.charAt(0).toUpperCase();

  return (
    <div data-card-chrome className="mb-1">
      {/* Fill indicator (James 2026-07-13): thin indeterminate bar under the
          title row — replaces the arc spinner ("아마추어" feedback). Sits in
          normal flow so nothing overlaps; collapses when idle. */}
      {isFilling && (
        <div
          className="relative h-[2px] w-full overflow-hidden rounded-full bg-primary/10 mb-1 animate-fade-in"
          role="progressbar"
          aria-label={t('contextHeader.filling', '채우는 중')}
        >
          <span
            className="absolute inset-y-0 left-0 w-1/4 rounded-full bg-primary/70 animate-progress-slide motion-reduce:animate-pulse motion-reduce:w-full"
            aria-hidden="true"
          />
        </div>
      )}
      <div className="flex items-center justify-between pr-2">
        {/* Left: sector badge + title + count + selection */}
        <div className="flex items-center gap-2 min-w-0">
          {titleLoading ? (
            <div
              className="w-6 h-6 rounded bg-foreground/[0.06] animate-pulse shrink-0"
              aria-hidden="true"
            />
          ) : (
            <div className="flex items-center justify-center w-6 h-6 rounded bg-primary/10 text-primary text-[11px] font-semibold shrink-0">
              {titleInitial}
            </div>
          )}

          {titleLoading ? (
            <div
              className="h-5 w-32 rounded bg-foreground/[0.06] animate-pulse"
              aria-hidden="true"
            />
          ) : (
            <h3 className="text-lg font-semibold leading-tight truncate">{title}</h3>
          )}

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
          {trailingAction}
          <ViewSwitcher value={viewMode} onChange={onViewModeChange} />
        </div>
      </div>
    </div>
  );
}
