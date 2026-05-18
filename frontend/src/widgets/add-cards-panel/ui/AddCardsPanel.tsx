/**
 * Add Cards slide-in panel (CP466).
 *
 * Notion-style right-side slide-in (45% desktop width). Open via
 * `useAddCardsPanelStore.openPanel(mandalaId)`. The panel mounts in
 * IndexPage so the surrounding grid stays visible on the left
 * ("발견한 영상이 내 큐레이션으로 흡수" mental model).
 *
 * CP466 amendment 8 — multi-select retired (Bookmark = pick). Input
 * zone auto-collapses on first search success (user directive
 * 2026-05-18 "검색 결과 출력되면서 검색 옵션 창은 폴딩되어 줄어들어야
 * 함") and can be re-expanded with the chevron toggle in the header.
 *
 * Spec: docs/design/add-cards-2026-05-18.md §2 + §6.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMandalaQuery } from '@/features/mandala';
import { ChevronDown, ChevronUp, Loader2, Lock, Search, X } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useLikeCard } from '@/features/card-management/model/useLikeCard';
import { useAddCardsPanelStore } from '../model/useAddCardsPanelStore';
import { useAddCards } from '../model/useAddCards';
import { KeywordChipInput } from './KeywordChipInput';
import { AddCardsFilters } from './AddCardsFilters';
import { TargetLevelChips } from './TargetLevelChips';
import { AddCardsList } from './AddCardsList';

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

  const { mandalaLevels } = useMandalaQuery(open ? mandalaId : null);
  const centerGoal = mandalaLevels?.root?.centerGoal ?? '';

  const mutation = useAddCards();
  const cards = mutation.data?.cards ?? [];

  // CP466 amendment 8 — pick set tracked locally per panel session.
  // BE excludes already-liked videos from subsequent searches, so this
  // local set only needs to cover the current result batch; resets on
  // panel close-then-reopen automatically via mount.
  const [pickedSet, setPickedSet] = useState<Set<string>>(() => new Set());
  const { like } = useLikeCard();

  const handlePick = useCallback(
    (videoId: string, title: string) => {
      if (!mandalaId) return;
      if (pickedSet.has(videoId)) return;
      // Optimistic local mark so the card disables immediately;
      // BE persistence proceeds in the background. like.mutate
      // rolls back on error via onError below.
      setPickedSet((prev) => {
        const next = new Set(prev);
        next.add(videoId);
        return next;
      });
      like.mutate(
        { videoId, mandalaId, title },
        {
          onError: () => {
            setPickedSet((prev) => {
              const next = new Set(prev);
              next.delete(videoId);
              return next;
            });
          },
        }
      );
    },
    [mandalaId, pickedSet, like]
  );

  // CP466 amendment 2 — seed wizard meta on first response.
  useEffect(() => {
    const meta = mutation.data?.mandalaMeta;
    if (!meta) return;
    seedFromWizardMeta(meta.focusTags, meta.targetLevel);
  }, [mutation.data, seedFromWizardMeta]);

  // CP466 amendment 8 — input zone collapses automatically on first
  // success result; user can toggle back via the chevron in the header.
  const [inputCollapsed, setInputCollapsed] = useState(false);
  const autoCollapsedFor = useRef<string | null>(null);
  useEffect(() => {
    if (mutation.isSuccess && cards.length > 0 && mandalaId) {
      // Only auto-collapse once per (mandala open + first successful
      // search). Subsequent searches don't re-collapse if user has
      // expanded manually.
      if (autoCollapsedFor.current !== mandalaId) {
        autoCollapsedFor.current = mandalaId;
        setInputCollapsed(true);
      }
    }
  }, [mutation.isSuccess, cards.length, mandalaId]);
  // Reset auto-collapse memory when panel closes.
  useEffect(() => {
    if (!open) {
      autoCollapsedFor.current = null;
      setInputCollapsed(false);
      setPickedSet(new Set());
    }
  }, [open]);

  // CP466 amendment 3 — explicit search button (no auto-fetch).
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

  // CP466 amendment 4 — race-free close animation.
  const [isClosingLocal, setIsClosingLocal] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClose = useCallback(() => {
    if (isClosingLocal) return;
    setIsClosingLocal(true);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closePanel();
      setIsClosingLocal(false);
      closeTimerRef.current = null;
    }, CLOSE_ANIMATION_MS);
  }, [closePanel, isClosingLocal]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, handleClose]);

  const shouldRender = (open || isClosingLocal) && mandalaId;
  if (!shouldRender) return null;
  const isClosing = isClosingLocal && !open ? true : isClosingLocal;

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-30 bg-black/20 transition-opacity duration-200 ease-in-out',
          isClosing ? 'opacity-0' : 'opacity-100'
        )}
        onClick={handleClose}
        aria-hidden="true"
      />
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
        {/* Header — title + collapse toggle (when results visible) + close. */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-border/40">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-[14px] font-semibold truncate">
              {t('addCards.panel.title', 'Find more videos')}
            </h2>
            {/* Collapse toggle — visible only after first successful search. */}
            {mutation.isSuccess && cards.length > 0 && (
              <button
                type="button"
                onClick={() => setInputCollapsed((v) => !v)}
                aria-label={
                  inputCollapsed
                    ? t('addCards.panel.expandOptions', 'Expand options')
                    : t('addCards.panel.collapseOptions', 'Collapse options')
                }
                aria-expanded={!inputCollapsed}
                className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
              >
                {inputCollapsed ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronUp className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('common.close', 'Close')}
            className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-foreground/[0.06] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Input zone — collapses on first successful search. The
            transition is height/opacity-based for smooth folding. */}
        <div
          className={cn(
            'border-b border-border/40 overflow-hidden transition-all duration-200 ease-in-out',
            inputCollapsed ? 'max-h-0 opacity-0 border-b-0' : 'max-h-[80vh] opacity-100'
          )}
          aria-hidden={inputCollapsed}
        >
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

          <KeywordChipInput />
          <AddCardsFilters />
          <TargetLevelChips />

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

        {/* Collapsed-state compact bar: show locked base + Search shortcut. */}
        {inputCollapsed && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40 text-[11.5px] text-muted-foreground">
            <Lock className="h-3 w-3 shrink-0" />
            <span className="truncate flex-1 text-foreground/80">{centerGoal || '…'}</span>
            <button
              type="button"
              onClick={triggerSearch}
              disabled={mutation.isPending}
              className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] text-foreground hover:bg-foreground/[0.06] transition-colors"
            >
              {mutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Search className="h-3 w-3" strokeWidth={2.2} />
              )}
              <span>{t('addCards.panel.searchButton', 'Search')}</span>
            </button>
          </div>
        )}

        {/* Result count row */}
        {mutation.isSuccess && cards.length > 0 && (
          <div className="px-4 py-1.5 text-[11px] text-muted-foreground">
            {t('addCards.panel.resultCount', '{{count}} matches', { count: cards.length })}
          </div>
        )}

        {/* Result list */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto scrollbar-pro min-h-0">
            <AddCardsList
              cards={cards}
              isLoading={mutation.isPending}
              hasSearched={mutation.isSuccess || mutation.isError}
              isError={mutation.isError}
              errorMessage={mutation.error?.message}
              onRetry={triggerSearch}
              pickedSet={pickedSet}
              isPickPending={like.isPending}
              onPick={handlePick}
            />
          </div>
        </div>
      </aside>
    </>
  );
}
