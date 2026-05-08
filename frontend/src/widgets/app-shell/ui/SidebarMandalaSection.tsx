import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useMandalaList, useSwitchMandala } from '@/features/mandala';
import { useMandalaStore } from '@/stores/mandalaStore';
import type { InsightCard } from '@/entities/card/model/types';

export interface MinimapData {
  cardsByCell: Record<number, InsightCard[]>;
  sectorSubjects: string[];
  /** 2-4 char short labels parallel to sectorSubjects (subject_labels). */
  sectorLabels?: string[];
  centerGoal: string;
  centerLabel?: string | null;
  selectedCellIndex: number | null;
  onCellClick: (cellIndex: number, subject: string) => void;
  mandalaId: string | null;
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

  const sortedMandalas = [...mandalas].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

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
              <button
                key={mandala.id}
                onClick={() => handleMandalaSelect(mandala.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-1.5 py-1.5 rounded-md text-[13px] text-left transition-colors duration-150',
                  'hover:bg-sidebar-accent',
                  isSelected
                    ? 'font-semibold text-sidebar-primary'
                    : 'font-normal text-sidebar-foreground/75'
                )}
              >
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
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
