import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useMandalaList, useSwitchMandala, useDeleteMandala } from '@/features/mandala';
import { useMandalaStore } from '@/stores/mandalaStore';
import { queryKeys } from '@/shared/config/query-client';
import type { InsightCard } from '@/entities/card/model/types';
import { MandalaRowMenu } from './MandalaRowMenu';

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
                  <span className="truncate flex-1">{getCenterLabel(mandala)}</span>
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
                <MandalaRowMenu
                  mandalaId={mandala.id}
                  isLastMandala={sortedMandalas.length <= 1}
                  onConfirmDelete={handleConfirmDelete}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
