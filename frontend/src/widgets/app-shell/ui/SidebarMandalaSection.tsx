import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, RefreshCw, ChevronRight, Check, Wand2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useMandalaList, useSwitchMandala, useUpdateSectorNames } from '@/features/mandala';
import { toast } from '@/shared/lib/use-toast';
import { Popover, PopoverTrigger, PopoverContent } from '@/shared/ui/popover';
import { SidebarHeatMinimap } from '@/widgets/sidebar-heat-minimap';
import { SidebarSkillPanel } from '@/widgets/sidebar-skill-panel';
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
  minimapData?: MinimapData;
}

export function SidebarMandalaSection({ collapsed, minimapData }: SidebarMandalaSectionProps) {
  const selectedMandalaId = useMandalaStore((s) => s.selectedMandalaId);
  const selectMandala = useMandalaStore((s) => s.selectMandala);
  const pendingMandala = useMandalaStore((s) => s.pendingMandala);
  const lastOptimisticTitle = useMandalaStore((s) => s.lastOptimisticTitle);
  const setLastOptimisticTitle = useMandalaStore((s) => s.setLastOptimisticTitle);
  const { t } = useTranslation();
  const { data: listData, isLoading, isError, error, refetch } = useMandalaList();

  const navigate = useNavigate();
  const switchMandala = useSwitchMandala();
  const updateSectorNames = useUpdateSectorNames();

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
  const [popoverOpen, setPopoverOpen] = useState(false);

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

  // Defensive refetch: when selectedMandalaId is set (e.g. the wizard's
  // optimistic stub was overwritten by a stale server list response) but
  // the mandala isn't in the cached list, retry with linear backoff. The
  // old single-shot `hasRefetchedRef` version locked us into '…' forever
  // when the first retry also returned stale data (DB propagation lag
  // between wizard POST and list endpoint). Now we retry up to 5 times
  // spaced 0.5s/1s/1.5s/2s/2.5s apart — covers the common propagation
  // window seen in prod without looping indefinitely.
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
  // MUST live above every early-return below — React requires consistent hook order.
  useEffect(() => {
    if (!lastOptimisticTitle) return;
    if (mandalas.some((m) => m.id === lastOptimisticTitle.id)) {
      setLastOptimisticTitle(null);
    }
  }, [mandalas, lastOptimisticTitle, setLastOptimisticTitle]);

  // Collapsed sidebar: icon button only
  if (collapsed) {
    return (
      <div className="px-2 py-1">
        <button
          className="w-full flex items-center justify-center px-2 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          title={t('sidebar.mandalas')}
          onClick={() => {
            const first = mandalas[0];
            if (first) handleMandalaSelect(first.id);
          }}
        >
          <LayoutGrid className="w-5 h-5" />
        </button>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="px-2 space-y-0.5">
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">
          {t('sidebar.myMandalas')}
        </div>
        {loadingTooLong ? (
          <button
            onClick={() => refetch()}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t('common.loadFailed')}
          </button>
        ) : (
          <div className="px-3 py-2 animate-pulse">
            <div className="h-4 bg-sidebar-accent/30 rounded w-3/4" />
          </div>
        )}
      </div>
    );
  }

  // Error state
  if (isError) {
    if (error) console.warn('[SidebarMandalaSection] Failed to load mandalas:', error);

    return (
      <div className="px-2 space-y-0.5">
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">
          {t('sidebar.myMandalas')}
        </div>
        <button
          onClick={() => refetch()}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-lg transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t('common.loadFailed')}
        </button>
      </div>
    );
  }

  // Sort by createdAt desc (most recent first)
  const sortedMandalas = [...mandalas].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const currentMandala = mandalas.find((m) => m.id === selectedMandalaId);
  // Sidebar uses centerLabel (short) for readability — long titles get truncated with "..."
  const getCenterLabel = (m: (typeof mandalas)[0] | undefined) => {
    const rootLevel = m?.levels?.find((l: { depth: number }) => l.depth === 0);
    const label = (rootLevel as { centerLabel?: string | null } | undefined)?.centerLabel;
    return label || m?.title || '—';
  };
  // Fallback chain while the list cache catches up with the server write.
  // pendingMandala covers the AI-custom path; lastOptimisticTitle covers the
  // DB-template path where no pendingMandala is set.
  const pendingTitle =
    pendingMandala?.originalInputs?.centerLabel?.trim() ||
    pendingMandala?.originalInputs?.title?.trim() ||
    pendingMandala?.originalInputs?.centerGoal?.trim() ||
    (lastOptimisticTitle?.id === selectedMandalaId
      ? lastOptimisticTitle.title.trim() || null
      : null);
  const currentTitle = selectedMandalaId
    ? currentMandala
      ? getCenterLabel(currentMandala)
      : (pendingTitle ?? t('sidebar.mandalaLoading', 'Finishing setup…'))
    : getCenterLabel(mandalas[0]);

  return (
    <div className="px-2 flex flex-col">
      {/* Header row: "MY MANDALAS 투자 ▸" — 전체가 popover trigger */}
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-sidebar-accent rounded-lg transition-colors text-sm font-medium text-sidebar-foreground/70">
            <LayoutGrid className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="shrink-0">{t('sidebar.myMandalas')}</span>
            <span className="text-xs text-sidebar-foreground/50 truncate font-normal">
              {currentTitle}
            </span>
            <ChevronRight
              className={cn(
                'w-3 h-3 shrink-0 ml-auto text-sidebar-foreground/30 transition-transform duration-200',
                popoverOpen && 'rotate-90'
              )}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" sideOffset={4} className="w-64 p-1">
          {/* Mandala list */}
          <div className="max-h-[240px] overflow-y-auto">
            {sortedMandalas.map((mandala) => {
              const isSelected = mandala.id === selectedMandalaId;
              return (
                <button
                  key={mandala.id}
                  onClick={() => {
                    handleMandalaSelect(mandala.id);
                    setPopoverOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors',
                    'hover:bg-accent',
                    isSelected && 'bg-accent font-medium'
                  )}
                >
                  <span className="truncate">{getCenterLabel(mandala)}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-primary shrink-0 ml-2" />}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {/* Create Mandala button — moved out of popover, placed below MY MANDALAS header */}
      <button
        onClick={() => navigate('/mandalas/new')}
        className="w-full flex items-center gap-2 px-3 py-2.5 mt-0.5 rounded-lg text-sm font-medium text-primary hover:bg-sidebar-accent transition-colors"
      >
        <Wand2 className="w-4 h-4 shrink-0" aria-hidden="true" />
        {t('sidebar.createMandala', 'Create Mandala')}
      </button>

      {/* Divider */}
      <div className="my-2 mx-2">
        <div className="h-px bg-sidebar-border" />
      </div>

      {/* Minimap — always visible (sector navigator) */}
      {minimapData && (
        <SidebarHeatMinimap
          cardsByCell={minimapData.cardsByCell}
          sectorSubjects={minimapData.sectorSubjects}
          sectorLabels={minimapData.sectorLabels}
          centerGoal={minimapData.centerGoal}
          centerLabel={minimapData.centerLabel}
          selectedCellIndex={minimapData.selectedCellIndex}
          onCellClick={minimapData.onCellClick}
          onExternalUrlDrop={minimapData.onExternalUrlDrop}
          onSectorNamesChange={
            minimapData.mandalaId
              ? (newGoal, newSubjects) => {
                  updateSectorNames.mutate(
                    {
                      mandalaId: minimapData.mandalaId!,
                      centerGoal: newGoal,
                      subjects: newSubjects,
                    },
                    {
                      onSuccess: () => toast({ title: t('minimap.saved') }),
                      onError: () => toast({ title: t('common.error'), variant: 'destructive' }),
                    }
                  );
                }
              : undefined
          }
        />
      )}

      {/* Divider */}
      <div className="my-2 mx-2">
        <div className="h-px bg-sidebar-border" />
      </div>

      {/* Skills panel */}
      <SidebarSkillPanel mandalaId={minimapData?.mandalaId ?? null} />
    </div>
  );
}
