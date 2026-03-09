import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, LayoutGrid, Plus } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';
import { useMandalaList, useSwitchMandala } from '@/features/mandala';
import { useToast } from '@/shared/lib/use-toast';

interface SidebarMandalaSectionProps {
  collapsed: boolean;
  expandedMandalaId: string | null;
  onExpandedChange: (id: string | null) => void;
  mandalaGridElement?: React.ReactNode;
}

export function SidebarMandalaSection({
  collapsed,
  expandedMandalaId,
  onExpandedChange,
  mandalaGridElement,
}: SidebarMandalaSectionProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: listData, isLoading } = useMandalaList();
  const switchMutation = useSwitchMandala();

  const mandalas = listData?.mandalas ?? [];

  const handleToggle = async (mandala: { id: string; isDefault: boolean }) => {
    if (expandedMandalaId === mandala.id) {
      onExpandedChange(null);
      return;
    }

    // Switch to this mandala if it's not the current one
    if (!mandala.isDefault) {
      try {
        await switchMutation.mutateAsync(mandala.id);
        toast({ title: t('mandalaSettings.switched') });
      } catch {
        toast({ title: t('common.error'), variant: 'destructive' });
        return;
      }
    }

    onExpandedChange(mandala.id);
  };

  // When sidebar is collapsed, show only the grid icon
  if (collapsed) {
    return (
      <div className="px-2 py-1">
        <button
          className="w-full flex items-center justify-center px-2 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          title={t('sidebar.mandalas')}
          onClick={() => {
            const current = mandalas.find((m) => m.isDefault);
            if (current) {
              onExpandedChange(expandedMandalaId ? null : current.id);
            }
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
          <Collapsible
            key={mandala.id}
            open={isExpanded}
            onOpenChange={() => handleToggle(mandala)}
          >
            <CollapsibleTrigger className="w-full">
              <div
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer',
                  'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  isExpanded
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/70',
                )}
              >
                <LayoutGrid className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left truncate">{mandala.title}</span>
                {mandala.isDefault && (
                  <span className="text-[9px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full shrink-0">
                    {t('mandalaSettings.current')}
                  </span>
                )}
                <ChevronDown
                  className={cn(
                    'w-3.5 h-3.5 shrink-0 text-sidebar-foreground/50 transition-transform duration-200',
                    isExpanded && 'rotate-180',
                  )}
                />
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div
                className="mt-1 mx-1 rounded-lg overflow-hidden bg-surface-base/50 border border-border/20"
                style={{ containerType: 'inline-size' }}
              >
                <div className="w-full aspect-square flex items-center justify-center p-2">
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
