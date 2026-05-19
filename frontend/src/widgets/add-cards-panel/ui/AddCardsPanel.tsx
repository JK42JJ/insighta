/** Slide-in panel for picking video candidates into a mandala. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMandalaQuery } from '@/features/mandala';
import { ChevronDown, ChevronUp, Loader2, Lock, RotateCcw, Search, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/shared/lib/utils';
import { useLikeCard } from '@/features/card-management/model/useLikeCard';
import { localCardsKeys } from '@/features/card-management/model/useLocalCards';
import { useAllVideoStates, youtubeSyncKeys } from '@/features/youtube-sync/model/useYouTubeSync';
import { useAddCardsPanelStore } from '../model/useAddCardsPanelStore';
import { useAddCards, type AddCardCandidate } from '../model/useAddCards';
import {
  clearSessionPicks,
  loadAddCardsState,
  loadSessionPicks,
  mergeSurfacedVideoIds,
  saveAddCardsState,
  saveSessionPicks,
} from '../lib/persistence';
import { KeywordChipInput } from './KeywordChipInput';
import { AddCardsFilters } from './AddCardsFilters';
import { TargetLevelChips } from './TargetLevelChips';
import { AddCardsList } from './AddCardsList';

const PANEL_WIDTH_CLASS = 'w-full md:w-[45vw] md:max-w-[720px]';
const CLOSE_ANIMATION_MS = 200;
const SCROLL_COLLAPSE_THRESHOLD_PX = 32;

export function AddCardsPanel() {
  const { t } = useTranslation();
  const open = useAddCardsPanelStore((s) => s.open);
  const mandalaId = useAddCardsPanelStore((s) => s.mandalaId);
  const extraKeywords = useAddCardsPanelStore((s) => s.extraKeywords);
  const filters = useAddCardsPanelStore((s) => s.filters);
  const targetLevel = useAddCardsPanelStore((s) => s.targetLevel);
  const seedFromWizardMeta = useAddCardsPanelStore((s) => s.seedFromWizardMeta);
  const setVisibleCount = useAddCardsPanelStore((s) => s.setVisibleCount);
  const closePanel = useAddCardsPanelStore((s) => s.closePanel);

  const { mandalaLevels, mandalaMeta: mandalaMetaFromQuery } = useMandalaQuery(
    open ? mandalaId : null
  );
  const centerGoal = mandalaLevels?.root?.centerGoal ?? '';

  const mutation = useAddCards();

  // Hydrate from localStorage on panel open so reload/quit doesn't drop discovery context.
  const [restoredCards, setRestoredCards] = useState<AddCardCandidate[] | null>(null);
  const [surfacedVideoIds, setSurfacedVideoIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !mandalaId) return;
    const stored = loadAddCardsState(mandalaId);
    if (stored) {
      setRestoredCards(stored.cards);
      setSurfacedVideoIds(stored.surfacedVideoIds);
    } else {
      setRestoredCards(null);
      setSurfacedVideoIds([]);
    }
    mutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mandalaId]);

  // Persist + grow surfaced set on each successful search.
  useEffect(() => {
    if (!mutation.isSuccess || !mandalaId) return;
    const freshCards = mutation.data?.cards ?? [];
    const freshIds = freshCards.map((c) => c.videoId);
    const nextSurfaced = mergeSurfacedVideoIds(surfacedVideoIds, freshIds);
    setSurfacedVideoIds(nextSurfaced);
    saveAddCardsState(mandalaId, freshCards, nextSurfaced);
    setRestoredCards(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutation.isSuccess, mutation.data, mandalaId]);

  // This-session picks (drives the "added" overlay). Persisted per mandala
  // in localStorage so panel close/reopen keeps the overlay until the user
  // explicitly resets.
  const [localPicks, setLocalPicks] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!open || !mandalaId) return;
    setLocalPicks(new Set(loadSessionPicks(mandalaId)));
  }, [open, mandalaId]);
  useEffect(() => {
    if (!mandalaId) return;
    saveSessionPicks(mandalaId, Array.from(localPicks));
  }, [mandalaId, localPicks]);
  const { like } = useLikeCard();
  const queryClient = useQueryClient();

  // Server-truth set of mandala-pre-existing videoIds. Used as a list
  // filter (not an overlay) to cover the localStorage-restored path.
  const { data: allVideoStates } = useAllVideoStates();
  const serverPickedSet = useMemo(() => {
    if (!mandalaId) return new Set<string>();
    const set = new Set<string>();
    for (const s of allVideoStates ?? []) {
      if (s.mandala_id !== mandalaId) continue;
      const yvid = s.video?.youtube_video_id;
      if (yvid) set.add(yvid);
    }
    return set;
  }, [allVideoStates, mandalaId]);

  const pickedSet = localPicks;

  // Filter out mandala-pre-existing cards; keep this session's local
  // picks so they show the green-check overlay until panel close.
  const cards: AddCardCandidate[] = useMemo(() => {
    const raw = mutation.data?.cards ?? restoredCards ?? [];
    return raw.filter((c) => !serverPickedSet.has(c.videoId) || localPicks.has(c.videoId));
  }, [mutation.data, restoredCards, serverPickedSet, localPicks]);
  const visibleCount = useMemo(
    () => cards.filter((c) => !pickedSet.has(c.videoId)).length,
    [cards, pickedSet]
  );
  const hasSearched = mutation.isSuccess || mutation.isError || restoredCards !== null;

  const handlePick = useCallback(
    (videoId: string, title: string) => {
      if (!mandalaId) return;
      if (pickedSet.has(videoId)) return;
      const candidate = (mutation.data?.cards ?? restoredCards ?? []).find(
        (c) => c.videoId === videoId
      );
      const cellIndex = candidate?.cellIndex;
      setLocalPicks((prev) => {
        const next = new Set(prev);
        next.add(videoId);
        return next;
      });
      like.mutate(
        {
          videoId,
          mandalaId,
          title,
          cellIndex,
          // CP467 — Tier 2 (fresh-from-YouTube) candidates have no
          // youtube_videos row yet. Send the metadata we already have
          // so BE can INSERT it and the card actually lands in the
          // mandala grid.
          videoCacheHint: candidate
            ? {
                title: candidate.title,
                channelTitle: candidate.channel,
                thumbnailUrl: candidate.thumbnail,
                durationSec: candidate.durationSec,
                viewCount: candidate.viewCount,
                publishedAt: candidate.publishedAt,
              }
            : undefined,
        },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: localCardsKeys.list() });
            queryClient.invalidateQueries({ queryKey: youtubeSyncKeys.allVideoStates });
            queryClient.invalidateQueries({ queryKey: ['mandala', 'recommendations', mandalaId] });
            // Card stays in the panel list — DO NOT strip from
            // localStorage. `pickedSet` (server picks ∪ local picks)
            // drives the disabled overlay so the user can see what was
            // already added to the mandala.
          },
          onError: () => {
            setLocalPicks((prev) => {
              const next = new Set(prev);
              next.delete(videoId);
              return next;
            });
          },
        }
      );
    },
    [mandalaId, pickedSet, like, mutation.data, restoredCards, queryClient]
  );

  // Seed wizard meta (focus_tags + target_level) as soon as the mandala
  // detail query returns — NOT after the search response. Previously the
  // chip seed was bound to `mutation.data?.mandalaMeta`, so the chips
  // popped in only AFTER the user pressed Search and the response came
  // back (user-reported 2026-05-18 "검색 후 chip 갑자기 추가"). Now the
  // GET /mandalas/:id response (which carries focusTags / targetLevel /
  // language since CP467) is the source — chips appear before any search.
  useEffect(() => {
    if (!mandalaMetaFromQuery) return;
    seedFromWizardMeta(mandalaMetaFromQuery.focusTags, mandalaMetaFromQuery.targetLevel);
  }, [mandalaMetaFromQuery, seedFromWizardMeta]);

  // Keep store count in sync so the external trigger chip badge follows panel state.
  useEffect(() => {
    if (!mandalaId) return;
    setVisibleCount(mandalaId, visibleCount);
  }, [mandalaId, visibleCount, setVisibleCount]);

  // Auto-collapse the input zone once per mandala on first successful search.
  const [inputCollapsed, setInputCollapsed] = useState(false);
  const autoCollapsedFor = useRef<string | null>(null);
  useEffect(() => {
    if (mutation.isSuccess && visibleCount > 0 && mandalaId) {
      if (autoCollapsedFor.current !== mandalaId) {
        autoCollapsedFor.current = mandalaId;
        setInputCollapsed(true);
      }
    }
  }, [mutation.isSuccess, visibleCount, mandalaId]);

  useEffect(() => {
    if (!open) {
      autoCollapsedFor.current = null;
      setInputCollapsed(false);
      // localPicks intentionally NOT reset — picks survive panel close
      // until "초기화" (resetResults) is clicked.
    }
  }, [open]);

  const runSearch = useCallback(() => {
    if (!mandalaId) return;
    const keywords =
      targetLevel && targetLevel !== 'standard' ? [...extraKeywords, targetLevel] : extraKeywords;
    mutation.mutate({
      mandalaId,
      extraKeywords: keywords,
      excludeVideoIds: surfacedVideoIds,
      filters,
    });
  }, [mandalaId, extraKeywords, filters, mutation, targetLevel, surfacedVideoIds]);

  // Toggle: results visible → click clears them; empty → click searches.
  // Surfaced history is preserved across the toggle.
  const resetResults = useCallback(() => {
    mutation.reset();
    setRestoredCards(null);
    setLocalPicks(new Set());
    if (mandalaId) clearSessionPicks(mandalaId);
  }, [mutation, mandalaId]);
  const triggerSearch = useCallback(() => {
    if (cards.length > 0) {
      resetResults();
      return;
    }
    runSearch();
  }, [cards.length, resetResults, runSearch]);

  // Race-free close: keep mount during the 200ms slide-out so the grid never flashes.
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
          'fixed inset-0 z-30 bg-black/30 backdrop-blur-md transition-[opacity,backdrop-filter] duration-200 ease-in-out',
          isClosing ? 'opacity-0' : 'opacity-100'
        )}
        onClick={handleClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t('addCards.panel.title', 'Find more cards')}
        className={cn(
          'fixed top-0 right-0 bottom-0 z-40 flex flex-col bg-background border-l border-border/60 shadow-2xl',
          PANEL_WIDTH_CLASS,
          isClosing
            ? 'animate-out slide-out-to-right duration-200 ease-in fill-mode-forwards'
            : 'animate-in slide-in-from-right duration-200 ease-out'
        )}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border/40 sm:px-6">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-[14px] font-semibold truncate">
              {t('addCards.panel.title', 'Find more cards')}
            </h2>
            {visibleCount > 0 && (
              <span
                className="inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-tight"
                style={{
                  background: 'hsl(var(--primary))',
                  color: 'hsl(var(--primary-foreground))',
                }}
                aria-label={t('addCards.panel.resultCount', '{{count}} matches', {
                  count: visibleCount,
                })}
              >
                {visibleCount}
              </span>
            )}
            {hasSearched && cards.length > 0 && (
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

        <div
          className={cn(
            'border-b border-border/40 overflow-hidden transition-all duration-200 ease-in-out',
            inputCollapsed ? 'max-h-0 opacity-0 border-b-0' : 'max-h-[80vh] opacity-100'
          )}
          aria-hidden={inputCollapsed}
        >
          <div className="px-5 py-3 sm:px-6">
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

          <div className="flex items-center justify-end px-5 py-2.5 sm:px-6">
            <button
              type="button"
              onClick={triggerSearch}
              disabled={mutation.isPending}
              className={cn(
                'inline-flex items-center gap-1.5 h-8 rounded-full text-[12px] font-medium px-3.5 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2',
                cards.length > 0
                  ? // Reset state — secondary tone so it reads as
                    // "clear/return", visually distinct from "search".
                    'bg-secondary text-secondary-foreground hover:bg-secondary/80 focus-visible:ring-foreground/20'
                  : // Search state — primary CTA.
                    'bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary/30'
              )}
            >
              {mutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : cards.length > 0 ? (
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.2} />
              ) : (
                <Search className="h-3.5 w-3.5" strokeWidth={2.2} />
              )}
              <span>
                {cards.length > 0
                  ? t('addCards.panel.resetButton', 'Reset')
                  : t('addCards.panel.searchButton', 'Search')}
              </span>
            </button>
          </div>
        </div>

        {inputCollapsed && (
          <div className="flex items-center gap-2 px-5 py-2 border-b border-border/40 text-[11.5px] text-muted-foreground sm:px-6">
            <Lock className="h-3 w-3 shrink-0" />
            <span className="truncate flex-1 text-foreground/80">{centerGoal || '…'}</span>
            <button
              type="button"
              onClick={triggerSearch}
              disabled={mutation.isPending}
              className={cn(
                'inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] transition-colors',
                cards.length > 0
                  ? 'text-foreground/80 hover:bg-foreground/[0.06]'
                  : 'text-foreground hover:bg-foreground/[0.06]'
              )}
            >
              {mutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : cards.length > 0 ? (
                <RotateCcw className="h-3 w-3" strokeWidth={2.2} />
              ) : (
                <Search className="h-3 w-3" strokeWidth={2.2} />
              )}
              <span>
                {cards.length > 0
                  ? t('addCards.panel.resetButton', 'Reset')
                  : t('addCards.panel.searchButton', 'Search')}
              </span>
            </button>
          </div>
        )}

        {mutation.isSuccess && visibleCount > 0 && (
          <div className="px-5 py-1.5 text-[11px] text-muted-foreground sm:px-6">
            {t('addCards.panel.resultCount', '{{count}} matches', { count: visibleCount })}
          </div>
        )}

        <div className="flex-1 flex flex-col min-h-0">
          <div
            className="flex-1 overflow-y-auto scrollbar-pro min-h-0"
            // Scroll-driven auto-collapse: once the user starts scanning
            // results the input section folds away. Up-scroll does NOT
            // re-expand — the ChevronUp/Down button is the only path
            // back up, so a quick wheel-down doesn't flip the panel
            // open and closed.
            onScroll={(e) => {
              if (!inputCollapsed && e.currentTarget.scrollTop > SCROLL_COLLAPSE_THRESHOLD_PX) {
                setInputCollapsed(true);
              }
            }}
          >
            <AddCardsList
              cards={cards}
              isLoading={mutation.isPending}
              hasSearched={hasSearched}
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
