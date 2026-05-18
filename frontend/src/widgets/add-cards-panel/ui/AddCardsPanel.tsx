/**
 * Add Cards slide-in panel (CP466).
 *
 * Notion-style right-side slide-in (45% desktop width). Open via
 * `useAddCardsPanelStore.openPanel(mandalaId)`. The panel mounts in
 * IndexPage so the surrounding grid stays visible on the left
 * ("발견한 영상이 내 큐레이션으로 흡수" mental model).
 *
 * Composes:
 *   - Locked base header (center_goal, readonly)
 *   - KeywordChipInput (chip-based refine)
 *   - AddCardsList (40 candidates with Bookmark + checkbox)
 *   - AddCardsBulkBar (sticky bottom, conditional)
 *
 * Spec: docs/design/add-cards-2026-05-18.md §2 + §6.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMandalaQuery } from '@/features/mandala';
import { Loader2, Lock, Search, X } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useAddCardsPanelStore } from '../model/useAddCardsPanelStore';
import { useAddCards } from '../model/useAddCards';
import { KeywordChipInput } from './KeywordChipInput';
import { AddCardsFilters } from './AddCardsFilters';
import { AddCardsList } from './AddCardsList';
import { AddCardsBulkBar } from './AddCardsBulkBar';

const PANEL_WIDTH_CLASS = 'w-full md:w-[45vw] md:max-w-[720px]';

export function AddCardsPanel() {
  const { t } = useTranslation();
  const open = useAddCardsPanelStore((s) => s.open);
  const mandalaId = useAddCardsPanelStore((s) => s.mandalaId);
  const extraKeywords = useAddCardsPanelStore((s) => s.extraKeywords);
  const filters = useAddCardsPanelStore((s) => s.filters);
  const closePanel = useAddCardsPanelStore((s) => s.closePanel);

  // Resolve center_goal (locked base, readonly) — same hook the dashboard
  // already uses; falls back to '' when the query is loading.
  const { mandalaLevels } = useMandalaQuery(open ? mandalaId : null);
  const centerGoal = mandalaLevels?.root?.centerGoal ?? '';

  const mutation = useAddCards();
  const cards = mutation.data?.cards ?? [];

  // CP466 amendment — explicit search button. Initial open triggers 1
  // auto-fetch (backlog); subsequent keyword/filter changes do NOT
  // auto-refetch — user clicks the Search button explicitly.
  const triggerSearch = useCallback(() => {
    if (!mandalaId) return;
    mutation.mutate({
      mandalaId,
      extraKeywords,
      excludeVideoIds: [],
      filters,
    });
  }, [mandalaId, extraKeywords, filters, mutation]);

  // Initial-open one-shot fetch — refs guard against re-fire on
  // mandala-id same-value re-open.
  const initialFetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !mandalaId) return;
    if (initialFetchedFor.current === mandalaId) return;
    initialFetchedFor.current = mandalaId;
    triggerSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mandalaId]);
  useEffect(() => {
    if (!open) initialFetchedFor.current = null;
  }, [open]);

  // Esc closes the panel.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, closePanel]);

  if (!open || !mandalaId) return null;

  return (
    <>
      {/* Backdrop — click closes. z-index below dialog/modal stack
          so VideoPlayerModal can stack above when a panel card is clicked. */}
      <div className="fixed inset-0 z-30 bg-black/20" onClick={closePanel} aria-hidden="true" />
      {/* Slide-in panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t('addCards.panel.title', 'Find more videos')}
        className={cn(
          'fixed top-0 right-0 bottom-0 z-40 flex flex-col bg-background border-l border-border/60 shadow-2xl',
          PANEL_WIDTH_CLASS,
          'animate-in slide-in-from-right duration-200 ease-out'
        )}
      >
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-border/40">
          <h2 className="text-[14px] font-semibold">
            {t('addCards.panel.title', 'Find more videos')}
          </h2>
          <button
            type="button"
            onClick={closePanel}
            aria-label={t('common.close', 'Close')}
            className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-foreground/[0.06] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Locked base */}
        <div className="px-4 py-3 border-b border-border/40">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-1">
              <span className="opacity-70">
                {t('addCards.panel.lockedBaseLabel', 'Searching within')}:
              </span>{' '}
              <span className="text-foreground">{centerGoal || '…'}</span>
            </span>
          </div>
        </div>

        {/* Keyword chips */}
        <KeywordChipInput />

        {/* CP466 amendment — 3 filter dropdowns (조회수/길이/기간) */}
        <AddCardsFilters />

        {/* CP466 amendment — explicit Search button (auto-refetch removed,
            initial open auto-fetches once). */}
        <div className="px-4 py-2 border-b border-border/40">
          <button
            type="button"
            onClick={triggerSearch}
            disabled={mutation.isPending}
            className="w-full inline-flex items-center justify-center gap-2 h-9 rounded-full bg-primary text-primary-foreground text-[12px] font-medium transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" strokeWidth={2.2} />
            )}
            <span>{t('addCards.panel.searchButton', 'Search')}</span>
          </button>
        </div>

        {/* Result list — flex-1 fills remaining vertical space; bulk bar
            sticks to bottom inside the same flex container. */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-hidden">
            <AddCardsList cards={cards} mandalaId={mandalaId} isLoading={mutation.isPending} />
          </div>
          <AddCardsBulkBar cards={cards} mandalaId={mandalaId} />
        </div>
      </aside>
    </>
  );
}
