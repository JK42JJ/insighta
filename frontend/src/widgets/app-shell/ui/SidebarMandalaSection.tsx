import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, RefreshCw, NotebookText, AlignLeft } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/shared/ui/tooltip';
import {
  useMandalaList,
  useSwitchMandala,
  useDeleteMandala,
  useGenerateSlideDeck,
} from '@/features/mandala';
import { useMandalaStore } from '@/stores/mandalaStore';
import { queryKeys } from '@/shared/config/query-client';
import type { InsightCard } from '@/entities/card/model/types';
import { MandalaRowMenu } from './MandalaRowMenu';

type AssetStatus = {
  deck: string | null;
  note: 'fresh' | 'stale' | 'none';
  v2Done: number | null;
  v2GatePassed: number | null;
};

// 요약(v2) coverage ring geometry — a 14px ring inside a 16px slot.
const V2_RING_R = 7;
const V2_RING_C = 2 * Math.PI * V2_RING_R;

/**
 * Icon intensity is DATA-ONLY — selection has NO effect (clicking a mandala must NOT
 * change any icon). Present = dark (a note exists / a 요약 is complete); absent = a faint
 * trace. Inline opacity because the sidebar-foreground token has no alpha slot, so Tailwind
 * text-token/NN modifiers are no-ops here. level: on / mid(stale·partial) / off.
 */
function assetIconOpacity(level: 'on' | 'mid' | 'off'): number {
  return level === 'on' ? 0.9 : level === 'mid' ? 0.55 : 0.09;
}

/**
 * P2 — per-mandala asset status icons, right-aligned. TWO icons only (요약, 노트).
 * 요약(v2) is quantitative (done/gate), so a determinate coverage ring shows progress:
 *   in-progress (0 < % < 100) = dim icon + arc ring (angle = done/gate),
 *   complete (100%) = lit icon (no ring), absent = faint ghost.
 * 노트 is atomic (fresh/stale/none) → lit / dim(stale) / ghost(absent).
 * Data from the list response (assetStatus, P1) — no per-mandala fetch.
 */
function MandalaAssetIcons({ status }: { status?: AssetStatus }) {
  const { t } = useTranslation();
  const note = status?.note ?? 'none';
  const gate = status?.v2GatePassed ?? 0;
  const done = status?.v2Done ?? 0;
  const v2Pct = gate > 0 ? Math.round((done / gate) * 100) : null;

  const noteLevel = note === 'fresh' ? 'on' : note === 'stale' ? 'mid' : 'off';
  const noteOpacity = assetIconOpacity(noteLevel);
  const noteTip = t('sidebar.asset.note', '노트');

  // 요약 — ring only while in progress; dark when complete; trace when absent.
  const v2InProgress = v2Pct != null && v2Pct > 0 && v2Pct < 100;
  const v2Level = v2Pct === 100 ? 'on' : v2InProgress ? 'mid' : 'off';
  const v2IconOpacity = assetIconOpacity(v2Level);
  const ringProgressOpacity = 0.9;
  const v2Tip = v2InProgress
    ? t('sidebar.asset.v2Progress', '요약 {{done}}/{{gate}}', { done, gate })
    : t('sidebar.asset.v2', '요약');

  return (
    <TooltipProvider delayDuration={150}>
      <span className="shrink-0 flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="relative inline-flex items-center justify-center w-4 h-4"
              aria-label={v2Tip}
            >
              {v2InProgress && (
                <svg
                  className="absolute inset-0 text-sidebar-foreground"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    cx="8"
                    cy="8"
                    r={V2_RING_R}
                    stroke="currentColor"
                    strokeWidth="1.5"
                    style={{ opacity: 0.12 }}
                  />
                  <circle
                    cx="8"
                    cy="8"
                    r={V2_RING_R}
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    style={{ opacity: ringProgressOpacity }}
                    strokeDasharray={V2_RING_C}
                    strokeDashoffset={V2_RING_C * (1 - (v2Pct ?? 0) / 100)}
                    transform="rotate(-90 8 8)"
                  />
                </svg>
              )}
              <AlignLeft
                className="w-3 h-3 text-sidebar-foreground"
                strokeWidth={1.9}
                style={{ opacity: v2IconOpacity }}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">{v2Tip}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center justify-center w-4 h-4" aria-label={noteTip}>
              <NotebookText
                className="w-3.5 h-3.5 text-sidebar-foreground"
                strokeWidth={1.9}
                style={{ opacity: noteOpacity }}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">{noteTip}</TooltipContent>
        </Tooltip>
      </span>
    </TooltipProvider>
  );
}

export interface MinimapData {
  cardsByCell: Record<number, InsightCard[]>;
  sectorSubjects: string[];
  /** 2-4 char short labels parallel to sectorSubjects (subject_labels). */
  sectorLabels?: string[];
  centerGoal: string;
  centerLabel?: string | null;
  selectedCellIndex: number | null;
  /** Mandala domain — sidebar minimap center cell color matches DOMAIN_STYLES (wizard/explore look&feel parity). */
  domain?: import('@/shared/config/domain-colors').MandalaDomain | null;
  onCellClick: (cellIndex: number, subject: string) => void;
  mandalaId: string | null;
  /** True while mandala detail query is loading and labels are empty —
   * SidebarHeatMinimap renders shimmer placeholders instead of "Sector N". */
  isLoading?: boolean;
  onExternalUrlDrop?: (cellIndex: number, url: string) => void;
}

const SWITCH_DEBOUNCE_MS = 300;

interface SidebarMandalaSectionProps {
  collapsed: boolean;
  /**
   * Issue #389: per-mandala "Newly Synced" card count rendered as `● N`
   * next to each row. Entries with count 0 are omitted.
   */
  newlySyncedCountByMandala?: Record<string, number>;
}

export function SidebarMandalaSection({
  collapsed,
  newlySyncedCountByMandala,
}: SidebarMandalaSectionProps) {
  const selectedMandalaId = useMandalaStore((s) => s.selectedMandalaId);
  const selectMandala = useMandalaStore((s) => s.selectMandala);
  const lastOptimisticTitle = useMandalaStore((s) => s.lastOptimisticTitle);
  const setLastOptimisticTitle = useMandalaStore((s) => s.setLastOptimisticTitle);
  const { t } = useTranslation();
  const { data: listData, isLoading, isError, error, refetch } = useMandalaList();

  // Local optimistic mask — rows added here are hidden regardless of cache.
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  // Mutation lives in the parent (not in MandalaRowMenu) because the row
  // unmounts the instant we add its id to deletingIds — if useDeleteMandala
  // is hosted inside the row, its useMutation observer is torn down before
  // the inline { onSuccess } callback can fire, swallowing the toast.
  const queryClient = useQueryClient();
  const deleteMandala = useDeleteMandala();
  const generateDeck = useGenerateSlideDeck();
  // Mandalas whose deck data-prep is in flight (drives the menu "준비중" label).
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());

  // Slide-deck data prep (③): fire the verified book + segment-relevance fills.
  // HONEST: this readies data; the deck render (slidegen) is not wired here yet.
  const handleGenerateDeck = useCallback(
    (mandalaId: string) => {
      setGeneratingIds((prev) => new Set(prev).add(mandalaId));
      generateDeck.mutate(mandalaId, {
        onSuccess: () => {
          toast.success(t('sidebar.mandalaActions.deckPrepStarted', '북인덱스 생성을 시작했어요'));
        },
        onError: () => {
          toast.error(
            t(
              'sidebar.mandalaActions.deckPrepError',
              '생성을 시작하지 못했어요. 잠시 후 다시 시도해주세요.'
            )
          );
        },
        onSettled: () => {
          setGeneratingIds((prev) => {
            const next = new Set(prev);
            next.delete(mandalaId);
            return next;
          });
        },
      });
    },
    [generateDeck, t]
  );

  const switchMandala = useSwitchMandala();

  const switchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const handleMandalaSelect = useCallback(
    (id: string) => {
      selectMandala(id);
      clearTimeout(switchTimerRef.current);
      switchTimerRef.current = setTimeout(() => {
        switchMandala.mutate(id);
      }, SWITCH_DEBOUNCE_MS);
    },
    [selectMandala, switchMandala]
  );

  const [loadingTooLong, setLoadingTooLong] = useState(false);
  // CP441 — fold open by default (handoff Q5: no localStorage persist)
  const [open, setOpen] = useState(true);

  // 16s loading timeout — harmonized: DB 12s < HTTP 14s < UI 16s
  const LOADING_TIMEOUT_MS = 16_000;
  useEffect(() => {
    if (!isLoading) {
      setLoadingTooLong(false);
      return;
    }
    const timer = setTimeout(() => setLoadingTooLong(true), LOADING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isLoading]);

  const mandalas = listData?.mandalas ?? [];

  // Defensive refetch with linear backoff (covers the wizard POST → list
  // endpoint propagation lag without infinite loop).
  const retryAttemptsRef = useRef(0);
  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 500;
  useEffect(() => {
    if (!selectedMandalaId || mandalas.length === 0) return;
    if (mandalas.some((m) => m.id === selectedMandalaId)) {
      retryAttemptsRef.current = 0;
      return;
    }
    if (retryAttemptsRef.current >= MAX_RETRIES) return;
    const handle = setTimeout(
      () => {
        retryAttemptsRef.current += 1;
        refetch();
      },
      RETRY_DELAY_MS * (retryAttemptsRef.current + 1)
    );
    return () => clearTimeout(handle);
  }, [selectedMandalaId, mandalas, refetch]);

  // Clear lastOptimisticTitle once the real mandala appears in the list cache.
  useEffect(() => {
    if (!lastOptimisticTitle) return;
    if (mandalas.some((m) => m.id === lastOptimisticTitle.id)) {
      setLastOptimisticTitle(null);
    }
  }, [mandalas, lastOptimisticTitle, setLastOptimisticTitle]);

  // Safety net: if the currently selected mandala is in the deletingIds mask
  // (i.e. user just deleted it), force-select the next visible mandala. This
  // guards against any path where the immediate selectMandala call inside
  // handleConfirmDelete didn't land (closure race / store-sync timing) — the
  // main view + minimap would otherwise stay stuck on the deleted detail.
  useEffect(() => {
    if (!selectedMandalaId || !deletingIds.has(selectedMandalaId)) return;
    const sorted = [...mandalas].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const deletedIdx = sorted.findIndex((m) => m.id === selectedMandalaId);
    const next = sorted
      .slice(deletedIdx + 1)
      .concat([...sorted.slice(0, deletedIdx)].reverse())
      .find((m) => !deletingIds.has(m.id));
    if (next) selectMandala(next.id);
  }, [selectedMandalaId, deletingIds, mandalas, selectMandala]);

  // Confirm-delete handler hosted in the parent so the useDeleteMandala
  // observer + its inline { onSuccess/onError } callbacks survive the row
  // unmount. Defined BEFORE the early returns below so hook order is stable.
  const handleConfirmDelete = useCallback(
    (deletedId: string) => {
      // 1) Optimistic local hide — independent of cache.
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.add(deletedId);
        return next;
      });
      // 2) Auto-select the row immediately following the deleted one in the
      //    visible (createdAt-desc) order. Falls back to the previous row when
      //    the deleted item was at the tail. Reads the store directly so the
      //    comparison can't go stale through any closure/render race.
      const currentSelected = useMandalaStore.getState().selectedMandalaId;
      if (currentSelected === deletedId) {
        const sorted = [...mandalas].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        const deletedIdx = sorted.findIndex((m) => m.id === deletedId);
        const next = sorted[deletedIdx + 1] ?? sorted[deletedIdx - 1] ?? null;
        if (next) selectMandala(next.id);
      }
      // 3) Fire the BE delete + feedback from a stable host.
      deleteMandala.mutate(deletedId, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.mandala.list() });
          toast.success(t('sidebar.mandalaActions.deleteSuccess', '만다라가 삭제됐어요'));
        },
        onError: () => {
          // Roll the optimistic mask back so the user can retry.
          setDeletingIds((prev) => {
            const next = new Set(prev);
            next.delete(deletedId);
            return next;
          });
          toast.error(
            t(
              'sidebar.mandalaActions.deleteError',
              '삭제가 완료되지 않았어요. 잠시 후 다시 시도해주세요.'
            )
          );
        },
      });
    },
    [mandalas, selectMandala, deleteMandala, queryClient, t]
  );

  if (collapsed) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="px-1">
        <div className="px-1.5 py-2 text-[13px] font-medium text-sidebar-foreground/60">
          {t('sidebar.myMandalas')}
        </div>
        {loadingTooLong ? (
          <button
            onClick={() => refetch()}
            className="w-full flex items-center gap-2 px-1.5 py-2 text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-lg transition-colors duration-150"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t('common.loadFailed')}
          </button>
        ) : (
          <div className="px-1.5 py-2 animate-pulse">
            <div className="h-4 bg-sidebar-accent/30 rounded w-3/4" />
          </div>
        )}
      </div>
    );
  }

  if (isError) {
    if (error) console.warn('[SidebarMandalaSection] Failed to load mandalas:', error);
    return (
      <div className="px-1">
        <div className="px-1.5 py-2 text-[13px] font-medium text-sidebar-foreground/60">
          {t('sidebar.myMandalas')}
        </div>
        <button
          onClick={() => refetch()}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-lg transition-colors duration-150"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t('common.loadFailed')}
        </button>
      </div>
    );
  }

  const sortedMandalas = [...mandalas]
    .filter((m) => !deletingIds.has(m.id))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const getCenterLabel = (m: (typeof mandalas)[0]) => {
    const rootLevel = m.levels?.find((l: { depth: number }) => l.depth === 0);
    const label = (rootLevel as { centerLabel?: string | null } | undefined)?.centerLabel;
    return label || m.title || '—';
  };

  return (
    <div className="px-1 flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-1.5 py-2 rounded-lg text-[13px] font-bold text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors duration-150"
        aria-expanded={open}
      >
        <span className="flex-1 text-left">{t('sidebar.myMandalas')}</span>
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 shrink-0 text-sidebar-foreground/50 transition-transform duration-150',
            !open && '-rotate-90'
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="mt-0.5 max-h-[40vh] overflow-y-auto scrollbar-sidebar">
          {sortedMandalas.map((mandala) => {
            const isSelected = mandala.id === selectedMandalaId;
            const newlySyncedCount = newlySyncedCountByMandala?.[mandala.id] ?? 0;
            return (
              <div
                key={mandala.id}
                role="button"
                tabIndex={0}
                onClick={() => handleMandalaSelect(mandala.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleMandalaSelect(mandala.id);
                  }
                }}
                className={cn(
                  'group flex items-center gap-1 pl-1.5 pr-1 py-1.5 text-[13px] cursor-pointer transition-colors duration-150',
                  isSelected
                    ? 'font-semibold text-sidebar-primary'
                    : 'font-normal text-sidebar-foreground/55 hover:text-sidebar-foreground'
                )}
              >
                <span className="flex flex-1 min-w-0 items-center gap-2 text-left">
                  {/* List bullet — marks each mandala as a list item (user request). */}
                  <span
                    className="w-1 h-1 shrink-0 rounded-full bg-current opacity-40"
                    aria-hidden="true"
                  />
                  {/* Single-line label (short center_label; DATA is full — display-only
                      ellipsis for the rare overflow, full title on hover). */}
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex-1 truncate leading-snug">
                          {getCenterLabel(mandala)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">{getCenterLabel(mandala)}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {newlySyncedCount > 0 && (
                    <span
                      className="shrink-0 flex items-center gap-1 text-[11px] text-primary font-medium"
                      aria-label={t('sidebar.newlySyncedAria', '{{count}} newly synced', {
                        count: newlySyncedCount,
                      })}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" />
                      {newlySyncedCount}
                    </span>
                  )}
                </span>
                <MandalaAssetIcons status={mandala.assetStatus} />
                <MandalaRowMenu
                  mandalaId={mandala.id}
                  isLastMandala={sortedMandalas.length <= 1}
                  onConfirmDelete={handleConfirmDelete}
                  onGenerateDeck={handleGenerateDeck}
                  isGeneratingDeck={generatingIds.has(mandala.id)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
