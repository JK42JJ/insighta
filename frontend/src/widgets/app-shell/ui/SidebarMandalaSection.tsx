import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, Plus, RefreshCw, Loader2, ChevronRight, Check } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import {
  useMandalaList,
  useCreateMandala,
  useSwitchMandala,
  useUpdateSectorNames,
} from '@/features/mandala';
import { toast } from '@/shared/lib/use-toast';
import { Popover, PopoverTrigger, PopoverContent } from '@/shared/ui/popover';
import { SidebarHeatMinimap } from '@/widgets/sidebar-heat-minimap';
import { SidebarSkillPanel } from '@/widgets/sidebar-skill-panel';
import { useMandalaStore } from '@/stores/mandalaStore';
import type { InsightCard } from '@/entities/card/model/types';

export interface MinimapData {
  cardsByCell: Record<number, InsightCard[]>;
  sectorSubjects: string[];
  centerGoal: string;
  selectedCellIndex: number | null;
  onCellClick: (cellIndex: number, subject: string) => void;
  mandalaId: string | null;
}

const SWITCH_DEBOUNCE_MS = 300;

interface SidebarMandalaSectionProps {
  collapsed: boolean;
  minimapData?: MinimapData;
}

export function SidebarMandalaSection({ collapsed, minimapData }: SidebarMandalaSectionProps) {
  const selectedMandalaId = useMandalaStore((s) => s.selectedMandalaId);
  const selectMandala = useMandalaStore((s) => s.selectMandala);
  const { t } = useTranslation();
  const { data: listData, isLoading, isError, error, refetch } = useMandalaList();

  const createMandala = useCreateMandala();
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
  const [quickCreateMode, setQuickCreateMode] = useState(false);
  const [quickCreateTitle, setQuickCreateTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const quickCreateRef = useRef<HTMLInputElement>(null);

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

  const handleQuickCreate = async () => {
    const title = quickCreateTitle.trim();
    if (!title || isCreating) return;
    setIsCreating(true);
    try {
      const result = await createMandala.mutateAsync(title);
      const newId = result?.mandala?.id;
      if (newId) {
        await switchMandala.mutateAsync(newId);
        handleMandalaSelect(newId);
      }
      toast({ title: t('mandalaSettings.created') });
      setQuickCreateMode(false);
      setQuickCreateTitle('');
      setPopoverOpen(false);
    } catch {
      toast({ title: t('mandalaSettings.quotaExceeded'), variant: 'destructive' });
    } finally {
      setIsCreating(false);
    }
  };

  // Auto-focus quick create input
  useEffect(() => {
    if (quickCreateMode) setTimeout(() => quickCreateRef.current?.focus(), 0);
  }, [quickCreateMode]);

  // Reset quick create when popover closes
  useEffect(() => {
    if (!popoverOpen) {
      setQuickCreateMode(false);
      setQuickCreateTitle('');
    }
  }, [popoverOpen]);

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
  const currentTitle = currentMandala?.title ?? mandalas[0]?.title ?? '—';

  return (
    <div className="px-2 flex flex-col">
      {/* Header row: "MY MANDALAS 투자 ▸" — 전체가 popover trigger */}
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-sidebar-accent rounded-lg transition-colors">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/60 shrink-0">
              {t('sidebar.myMandalas')}
            </span>
            <span className="text-[11px] text-sidebar-foreground/70 truncate">{currentTitle}</span>
            <ChevronRight
              className={cn(
                'w-3 h-3 shrink-0 ml-auto text-sidebar-foreground/30 transition-transform duration-200',
                popoverOpen && 'rotate-90'
              )}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={4}
          className="w-64 p-1"
          onInteractOutside={(e) => {
            if (quickCreateMode) e.preventDefault();
          }}
        >
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
                  <span className="truncate">{mandala.title}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-primary shrink-0 ml-2" />}
                </button>
              );
            })}
          </div>

          {/* Divider + New mandala */}
          <div className="border-t border-border mt-1 pt-1">
            {quickCreateMode ? (
              <div className="flex items-center gap-1.5 px-3 py-2">
                <input
                  ref={quickCreateRef}
                  type="text"
                  placeholder={t('mandalas.quickCreatePlaceholder')}
                  value={quickCreateTitle}
                  onChange={(e) => setQuickCreateTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === 'Enter') handleQuickCreate();
                    if (e.key === 'Escape') {
                      setQuickCreateMode(false);
                      setQuickCreateTitle('');
                    }
                  }}
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground text-foreground"
                  disabled={isCreating}
                />
                {isCreating && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                )}
              </div>
            ) : (
              <button
                onClick={() => setQuickCreateMode(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-primary hover:bg-accent transition-colors"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                {t('sidebar.newMandala')}
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Divider */}
      <div className="my-2 mx-2">
        <div className="h-px bg-sidebar-border" />
      </div>

      {/* Minimap — always visible (sector navigator) */}
      {minimapData && (
        <SidebarHeatMinimap
          cardsByCell={minimapData.cardsByCell}
          sectorSubjects={minimapData.sectorSubjects}
          centerGoal={minimapData.centerGoal}
          selectedCellIndex={minimapData.selectedCellIndex}
          onCellClick={minimapData.onCellClick}
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
