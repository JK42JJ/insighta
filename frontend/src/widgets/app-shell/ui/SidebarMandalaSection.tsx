import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, Plus, RefreshCw, Loader2, ChevronDown } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { ScrollArea } from '@/shared/ui/scroll-area';
import {
  useMandalaList,
  useCreateMandala,
  useSwitchMandala,
  useUpdateSectorNames,
} from '@/features/mandala';
import { toast } from '@/shared/lib/use-toast';
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
  const SECTION_STORAGE_KEY = 'insighta-mandalas-open';
  const [sectionOpen, setSectionOpen] = useState(() => {
    try {
      return localStorage.getItem(SECTION_STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const toggleSection = () => {
    setSectionOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SECTION_STORAGE_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
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
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
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
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
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

  return (
    <div className="px-2 flex flex-col">
      {/* Section header — clickable to fold/unfold */}
      <button
        onClick={toggleSection}
        className="w-full flex items-center justify-between px-3 py-1.5 group"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40 group-hover:text-sidebar-foreground/60 transition-colors shrink-0">
            {t('sidebar.myMandalas')}
          </span>
          {!sectionOpen &&
            selectedMandalaId &&
            (() => {
              const selected = mandalas.find((m) => m.id === selectedMandalaId);
              return selected ? (
                <span className="text-[11px] text-sidebar-foreground/70 truncate">
                  {selected.title}
                </span>
              ) : null;
            })()}
        </div>
        <ChevronDown
          className={cn(
            'w-3 h-3 text-sidebar-foreground/30 shrink-0 transition-transform duration-200',
            !sectionOpen && '-rotate-90'
          )}
        />
      </button>

      {!sectionOpen ? null : (
        <>
          {/* Mandala list — foldable */}
          <ScrollArea className="max-h-[200px]">
            <ul className="space-y-0.5" role="list">
              {sortedMandalas.map((mandala) => {
                const isSelected = mandala.id === selectedMandalaId;
                return (
                  <li key={mandala.id}>
                    <button
                      onClick={() => handleMandalaSelect(mandala.id)}
                      className={cn(
                        'relative w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                        isSelected
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground/70'
                      )}
                    >
                      {isSelected && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[60%] bg-sidebar-primary rounded-r-sm" />
                      )}
                      <span className="flex-1 text-left truncate">{mandala.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>

          {/* + New mandala / Quick create */}
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
                onBlur={() => {
                  if (!isCreating && !quickCreateTitle.trim()) {
                    setQuickCreateMode(false);
                    setQuickCreateTitle('');
                  }
                }}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-sidebar-foreground/40 text-sidebar-foreground"
                disabled={isCreating}
              />
              {isCreating && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-sidebar-foreground/50" />
              )}
            </div>
          ) : (
            <button
              onClick={() => setQuickCreateMode(true)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-sidebar-primary hover:bg-sidebar-accent transition-colors"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              {t('sidebar.newMandala')}
            </button>
          )}
        </>
      )}

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
