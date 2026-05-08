import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/shared/ui/popover';
import { Dialog, DialogContent } from '@/shared/ui/dialog';
import { SidebarSkillPanel } from '@/widgets/sidebar-skill-panel';
import { useMandalaStore } from '@/stores/mandalaStore';

interface SidebarTopSectionProps {
  collapsed: boolean;
  searchBarElement?: React.ReactNode;
  onNavigateHome?: () => void;
  onToggleCollapse?: () => void;
}

export function SidebarTopSection({
  collapsed,
  searchBarElement,
  onNavigateHome,
  onToggleCollapse,
}: SidebarTopSectionProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const selectedMandalaId = useMandalaStore((s) => s.selectedMandalaId);
  // CP441 — collapsed search opens a centered modal (ChatGPT pattern).
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);

  // Collapsed state — ChatGPT-style icon stack:
  // toggle / logo / + new mandala / search (modal) / more (popover) / [profile renders in footer]
  if (collapsed) {
    const iconBtn =
      'flex items-center justify-center w-8 h-8 rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring';

    return (
      <div className="shrink-0 flex flex-col items-center gap-1.5 pt-3 pb-2 px-2">
        {/* CP441 — ChatGPT pattern: logo at rest, swaps to expand toggle on hover. */}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={t('sidebar.expand', 'Expand sidebar')}
          title={t('sidebar.expand', 'Expand sidebar')}
          className="group relative flex items-center justify-center w-8 h-8 rounded-md hover:bg-sidebar-accent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="Insighta"
            className="w-[22px] h-[22px] rounded-md dark:invert transition-opacity duration-150 group-hover:opacity-0"
          />
          <PanelLeftOpen
            className="absolute inset-0 m-auto w-4 h-4 text-sidebar-foreground/70 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            aria-hidden="true"
          />
        </button>

        <button
          type="button"
          onClick={() => navigate('/mandalas/new')}
          aria-label={t('sidebar.newMandalaCta', '새 만다라')}
          title={t('sidebar.newMandalaCta', '새 만다라')}
          className={iconBtn}
        >
          <Plus className="w-4 h-4" />
        </button>

        {searchBarElement && (
          <>
            <button
              type="button"
              onClick={() => setSearchDialogOpen(true)}
              aria-label={t('sidebar.searchPlaceholder', '검색...')}
              title={t('sidebar.searchPlaceholder', '검색...')}
              className={iconBtn}
            >
              <Search className="w-4 h-4" />
            </button>
            <Dialog open={searchDialogOpen} onOpenChange={setSearchDialogOpen}>
              <DialogContent className="max-w-xl p-4">{searchBarElement}</DialogContent>
            </Dialog>
          </>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t('sidebar.more', '더 보기')}
              title={t('sidebar.more', '더 보기')}
              className={iconBtn}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            sideOffset={8}
            className="w-80 p-1.5 max-h-[80vh] overflow-y-auto"
          >
            <SidebarSkillPanel mandalaId={selectedMandalaId ?? null} />
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  return (
    <div className="shrink-0 flex flex-col gap-2 pt-4 pb-2 px-4">
      <div className="flex items-center gap-2.5">
        <Link
          to="/"
          onClick={onNavigateHome}
          className="flex flex-1 min-w-0 items-center gap-2.5 hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-lg"
        >
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="Insighta"
            className="w-[22px] h-[22px] rounded-lg dark:invert"
          />
          <span className="text-lg font-bold text-foreground tracking-tight">Insighta</span>
          {import.meta.env.DEV && (
            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-md">
              DEV
            </span>
          )}
          <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-primary/10 text-primary border border-primary/30 rounded-md">
            {t('common.beta')}
          </span>
        </Link>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={t('sidebar.collapse', 'Collapse sidebar')}
            title={t('sidebar.collapse', 'Collapse sidebar')}
            className="shrink-0 flex items-center justify-center w-8 h-8 rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => navigate('/mandalas/new')}
        className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>{t('sidebar.newMandalaCta', '새 만다라')}</span>
      </button>

      {searchBarElement && <div className="w-full">{searchBarElement}</div>}

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <MoreHorizontal className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{t('sidebar.more', '더 보기')}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          className="w-80 p-1.5 max-h-[80vh] overflow-y-auto"
        >
          <SidebarSkillPanel mandalaId={selectedMandalaId ?? null} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
