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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMandalaQuery } from '@/features/mandala';
import { Loader2, Lock, Search, X } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useAddCardsPanelStore } from '../model/useAddCardsPanelStore';
import { useAddCards } from '../model/useAddCards';
import { KeywordChipInput } from './KeywordChipInput';
import { AddCardsFilters } from './AddCardsFilters';
import { TargetLevelChips } from './TargetLevelChips';
import { AddCardsList } from './AddCardsList';
import { AddCardsBulkBar } from './AddCardsBulkBar';

const PANEL_WIDTH_CLASS = 'w-full md:w-[45vw] md:max-w-[720px]';
const CLOSE_ANIMATION_MS = 200;

export function AddCardsPanel() {
  const { t } = useTranslation();
  const open = useAddCardsPanelStore((s) => s.open);
  const mandalaId = useAddCardsPanelStore((s) => s.mandalaId);
  const extraKeywords = useAddCardsPanelStore((s) => s.extraKeywords);
  const filters = useAddCardsPanelStore((s) => s.filters);
  const targetLevel = useAddCardsPanelStore((s) => s.targetLevel);
  const seedFromWizardMeta = useAddCardsPanelStore((s) => s.seedFromWizardMeta);
  const closePanel = useAddCardsPanelStore((s) => s.closePanel);

  // Resolve center_goal (locked base, readonly) — same hook the dashboard
  // already uses; falls back to '' when the query is loading.
  const { mandalaLevels } = useMandalaQuery(open ? mandalaId : null);
  const centerGoal = mandalaLevels?.root?.centerGoal ?? '';

  const mutation = useAddCards();
  const cards = mutation.data?.cards ?? [];

  // CP466 amendment 2 — first response carries `mandalaMeta` (wizard
  // focus_tags + target_level). Seed the store once per panel-open so
  // the chips prepopulate; subsequent fetches don't overwrite user edits.
  useEffect(() => {
    const meta = mutation.data?.mandalaMeta;
    if (!meta) return;
    seedFromWizardMeta(meta.focusTags, meta.targetLevel);
  }, [mutation.data, seedFromWizardMeta]);

  // CP466 amendment 3 — search is fully user-driven. Panel open does
  // NOT auto-fetch (user directive 2026-05-18: "검색창 열리면 자동
  // 검색 X — 검색 버튼 눌러야 시작"). Empty result state below shows
  // the idle empty message until the user clicks Search.
  // targetLevel (난이도) is appended to extraKeywords for the BE embed
  // batch when it diverges from 'standard' (user-tunable wizard meta).
  const triggerSearch = useCallback(() => {
    if (!mandalaId) return;
    const keywords =
      targetLevel && targetLevel !== 'standard' ? [...extraKeywords, targetLevel] : extraKeywords;
    mutation.mutate({
      mandalaId,
      extraKeywords: keywords,
      excludeVideoIds: [],
      filters,
    });
  }, [mandalaId, extraKeywords, filters, mutation, targetLevel]);

  // CP466 amendment 4 — race-free close animation (user-reported
  // grid-card flash on close, 2026-05-18). The previous useEffect-
  // gated approach unmounted for one frame between `open=false` render
  // and the next-tick state catch-up — exposing the grid behind
  // backdrop. Fix: close trigger sets a SYNCHRONOUS local flag in the
  // same render cycle, the store action is deferred 200ms so mount
  // never lapses.
  const [isClosingLocal, setIsClosingLocal] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClose = useCallback(() => {
    if (isClosingLocal) return; // already animating
    setIsClosingLocal(true);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closePanel();
      setIsClosingLocal(false);
      closeTimerRef.current = null;
    }, CLOSE_ANIMATION_MS);
  }, [closePanel, isClosingLocal]);

  // Cleanup pending close timer on unmount to avoid stale store
  // mutations (e.g. user navigates away mid-animation).
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  // Esc closes the panel via the same animation path.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, handleClose]);

  // Mount window = store-open OR mid-close animation. Both phases keep
  // backdrop + panel rendered so the grid never peeks through.
  const shouldRender = (open || isClosingLocal) && mandalaId;
  if (!shouldRender) return null;
  const isClosing = isClosingLocal && !open ? true : isClosingLocal;

  return (
    <>
      {/* Backdrop — click closes. Fades with the panel slide so the
          dim layer doesn't snap-cut when closing. */}
      <div
        className={cn(
          'fixed inset-0 z-30 bg-black/20 transition-opacity duration-200 ease-in-out',
          isClosing ? 'opacity-0' : 'opacity-100'
        )}
        onClick={handleClose}
        aria-hidden="true"
      />
      {/* Slide-in / slide-out panel. Open → animate-in + slide-in-from-
          right. Closing → animate-out + slide-out-to-right. Same 200ms
          ease for both directions (CP466 user directive 2026-05-18). */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t('addCards.panel.title', 'Find more videos')}
        className={cn(
          'fixed top-0 right-0 bottom-0 z-40 flex flex-col bg-background border-l border-border/60 shadow-2xl',
          PANEL_WIDTH_CLASS,
          isClosing
            ? 'animate-out slide-out-to-right duration-200 ease-in fill-mode-forwards'
            : 'animate-in slide-in-from-right duration-200 ease-out'
        )}
      >
        {/* Header — single divider above the entire "input zone".
            CP466 user directive 2026-05-18: 구분선 최소만 사용. */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-border/40">
          <h2 className="text-[14px] font-semibold">
            {t('addCards.panel.title', 'Find more videos')}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('common.close', 'Close')}
            className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-foreground/[0.06] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Input zone — locked base + keyword chips + filter chips +
            level chips + Search row, NO internal dividers. Single
            border below the search button separates input zone from
            result list. */}
        <div className="border-b border-border/40">
          {/* Locked base */}
          <div className="px-4 py-3">
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

          {/* Keyword chips (editable, seeded from wizard focus_tags) */}
          <KeywordChipInput />

          {/* CP466 amendment — 3 filter chip rows (조회수/길이/기간) */}
          <AddCardsFilters />

          {/* CP466 amendment 2 — editable wizard target level (난이도) */}
          <TargetLevelChips />

          {/* Right-aligned compact Search button (CP466 UX directive). */}
          <div className="flex items-center justify-end px-4 py-2.5">
            <button
              type="button"
              onClick={triggerSearch}
              disabled={mutation.isPending}
              className="inline-flex items-center gap-1.5 h-8 rounded-full bg-primary text-primary-foreground text-[12px] font-medium px-3.5 hover:bg-primary/90 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              {mutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" strokeWidth={2.2} />
              )}
              <span>{t('addCards.panel.searchButton', 'Search')}</span>
            </button>
          </div>
        </div>

        {/* Result list — flex-1 fills remaining vertical space; bulk bar
            sticks to bottom inside the same flex container. */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-hidden">
            <AddCardsList
              cards={cards}
              mandalaId={mandalaId}
              isLoading={mutation.isPending}
              hasSearched={mutation.isSuccess || mutation.isError}
            />
          </div>
          <AddCardsBulkBar cards={cards} mandalaId={mandalaId} />
        </div>
      </aside>
    </>
  );
}
