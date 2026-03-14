import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, LayoutGrid, Plus, RefreshCw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { Collapsible, CollapsibleContent } from '@/shared/ui/collapsible';
import { useMandalaList } from '@/features/mandala';

interface SidebarMandalaSectionProps {
  collapsed: boolean;
  expandedMandalaId: string | null;
  onExpandedChange: (id: string | null) => void;
  mandalaGridElement?: React.ReactNode;
  selectedMandalaId: string | null;
  onMandalaSelect: (id: string) => void;
}

export function SidebarMandalaSection({
  collapsed,
  expandedMandalaId,
  onExpandedChange,
  mandalaGridElement,
  selectedMandalaId,
  onMandalaSelect,
}: SidebarMandalaSectionProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: listData, isLoading, isError, error, refetch } = useMandalaList();

  const mandalas = listData?.mandalas ?? [];

  const handleClick = (mandala: { id: string }) => {
    onMandalaSelect(mandala.id);
    navigate('/');
  };

  const handleChevronToggle = (e: React.MouseEvent, mandalaId: string) => {
    e.stopPropagation();
    if (expandedMandalaId === mandalaId) {
      onExpandedChange(null);
    } else {
      onExpandedChange(mandalaId);
      onMandalaSelect(mandalaId);
    }
  };

  // When sidebar is collapsed, show only the grid icon — navigate to home
  if (collapsed) {
    return (
      <div className="px-2 py-1">
        <button
          className="w-full flex items-center justify-center px-2 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          title={t('sidebar.mandalas')}
          onClick={() => {
            navigate('/');
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
          {t('sidebar.mandalas')}
        </div>
        <div className="px-3 py-2 animate-pulse">
          <div className="h-4 bg-sidebar-accent/30 rounded w-3/4" />
        </div>
      </div>
    );
  }

  // Error state — user-friendly message with retry (technical details go to console)
  if (isError) {
    if (error) console.warn('[SidebarMandalaSection] Failed to load mandalas:', error);

    return (
      <div className="px-2 space-y-0.5">
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
          {t('sidebar.mandalas')}
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

  // Empty state — actionable link to create mandala
  if (mandalas.length === 0) {
    return (
      <div className="px-2 space-y-0.5">
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
          {t('sidebar.mandalas')}
        </div>
        <button
          onClick={() => navigate('/mandala-settings')}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-lg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('mandalaSettings.createNew')}
        </button>
      </div>
    );
  }

  return (
    <div className="px-2 space-y-0.5">
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
        {t('sidebar.mandalas')}
      </div>
      {mandalas.map((mandala) => {
        const isExpanded = expandedMandalaId === mandala.id;

        return (
          <Collapsible key={mandala.id} open={isExpanded}>
            <div
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer',
                'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                isExpanded
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70'
              )}
              onClick={() => handleClick(mandala)}
            >
              <LayoutGrid className="w-4 h-4 shrink-0" />
              <span className="flex-1 text-left truncate">{mandala.title}</span>
              {mandala.id === selectedMandalaId && (
                <span className="text-[9px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full shrink-0">
                  {t('mandalaSettings.current')}
                </span>
              )}
              <button
                onClick={(e) => handleChevronToggle(e, mandala.id)}
                className="p-0.5 rounded hover:bg-sidebar-foreground/10 transition-colors"
              >
                <ChevronDown
                  className={cn(
                    'w-3.5 h-3.5 shrink-0 text-sidebar-foreground/50 transition-transform duration-200',
                    isExpanded && 'rotate-180'
                  )}
                />
              </button>
            </div>
            <CollapsibleContent>
              <div
                className="mt-1 rounded-lg overflow-hidden bg-surface-base/50 border border-border/20"
                style={{ containerType: 'inline-size' }}
              >
                <div className="w-full aspect-square flex items-center justify-center p-1">
                  {mandalaGridElement}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
