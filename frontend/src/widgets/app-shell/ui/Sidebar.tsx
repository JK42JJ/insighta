import { useLocation, useNavigate, useSearchParams, useMatch } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Settings,
  Palette,
  Bell,
  LayoutGrid,
  Link2,
  CreditCard,
  Shield,
  ArrowLeft,
  User,
  PanelLeftClose,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { SidebarMandalaSection, type MinimapData } from './SidebarMandalaSection';
import { SidebarLearningSection } from './SidebarLearningSection';
import { SidebarTopSection } from './SidebarTopSection';
import { SidebarProfileFooter } from './SidebarProfileFooter';
import { SidebarHeatMinimap } from '@/widgets/sidebar-heat-minimap';
import { useUpdateSectorNames } from '@/features/mandala';
import { toast } from '@/shared/lib/use-toast';
import { ErrorBoundary } from 'react-error-boundary';
import { RefreshCw } from 'lucide-react';

/** Custom "source tray" icon from design spec §2-2 */
function SourceIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v9" />
      <path d="M9 9l3 3 3-3" />
      <path d="M21 15H16l-2 3H10l-2-3H3v4a2 2 0 002 2h14a2 2 0 002-2v-4z" />
    </svg>
  );
}

type SettingsCategory =
  | 'general'
  | 'profile'
  | 'appearance'
  | 'notifications'
  | 'mandalas'
  | 'sources'
  | 'services'
  | 'subscription'
  | 'data';

const SETTINGS_NAV_GROUPS = [
  {
    labelKey: 'settings.navAccount',
    items: [
      { id: 'general' as SettingsCategory, icon: Settings, labelKey: 'settings.general' },
      { id: 'profile' as SettingsCategory, icon: User, labelKey: 'settings.profile' },
      { id: 'appearance' as SettingsCategory, icon: Palette, labelKey: 'settings.appearance' },
      { id: 'notifications' as SettingsCategory, icon: Bell, labelKey: 'settings.notifications' },
    ],
  },
  {
    labelKey: 'settings.navWorkspace',
    items: [
      { id: 'mandalas' as SettingsCategory, icon: LayoutGrid, labelKey: 'settings.mandalas' },
      {
        id: 'sources' as SettingsCategory,
        icon: SourceIcon,
        labelKey: 'settings.sourceManagement',
      },
      { id: 'services' as SettingsCategory, icon: Link2, labelKey: 'settings.connectedServices' },
    ],
  },
  {
    labelKey: 'settings.navBilling',
    items: [
      {
        id: 'subscription' as SettingsCategory,
        icon: CreditCard,
        labelKey: 'settings.subscription',
      },
    ],
  },
  {
    labelKey: '',
    items: [{ id: 'data' as SettingsCategory, icon: Shield, labelKey: 'settings.dataPrivacy' }],
  },
];

const SIDEBAR_WIDTH = 320;

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavigateHome?: () => void;
  minimapData?: MinimapData;
  /** Issue #389: per-mandala "Newly Synced" card count for the sidebar dot+count indicator. */
  newlySyncedCountByMandala?: Record<string, number>;
  settingsMode?: boolean;
  searchBarElement?: React.ReactNode;
}

export function Sidebar({
  collapsed,
  onToggleCollapse,
  onNavigateHome,
  minimapData,
  newlySyncedCountByMandala,
  settingsMode = false,
  searchBarElement,
}: SidebarProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const learningMatch = useMatch('/learning/:mandalaId/:videoId');
  const isLearningRoute = Boolean(learningMatch);

  const updateSectorNames = useUpdateSectorNames();

  const activeSettingsTab = (searchParams.get('tab') as SettingsCategory) || 'general';

  const handleSettingsTabClick = (tab: SettingsCategory) => {
    setSearchParams({ tab });
  };

  const handleBackToApp = () => {
    navigate('/');
  };

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col h-full shrink-0 transition-[width] duration-300 ease-in-out overflow-hidden relative',
        'bg-sidebar border-r border-sidebar-border/40',
        !settingsMode && collapsed && 'w-16'
      )}
      style={{
        width: collapsed && !settingsMode ? undefined : `${SIDEBAR_WIDTH}px`,
      }}
      aria-label={t('sidebar.navigation')}
    >
      {((!isLearningRoute && !settingsMode) || collapsed) && (
        <SidebarTopSection
          collapsed={collapsed}
          searchBarElement={searchBarElement}
          onNavigateHome={onNavigateHome}
          onToggleCollapse={onToggleCollapse}
        />
      )}

      <div className="relative flex-1 min-h-0 overflow-hidden">
        {/* App Panel (dashboard) */}
        <div
          className={cn(
            'absolute inset-0 flex flex-col transition-all duration-300 ease-in-out',
            settingsMode || isLearningRoute
              ? '-translate-x-full opacity-0 pointer-events-none'
              : 'translate-x-0 opacity-100'
          )}
        >
          {/* Minimap — fixed (outside scroll container, CP441 handoff §1) */}
          {!collapsed && minimapData && (
            <div className="shrink-0 px-4 pt-2 pb-3">
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
                            onError: () =>
                              toast({ title: t('common.error'), variant: 'destructive' }),
                          }
                        );
                      }
                    : undefined
                }
              />
            </div>
          )}

          {/* Mandala fold list — scrollable */}
          <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-none px-2 pb-2">
            <ErrorBoundary
              fallbackRender={({ resetErrorBoundary }) => (
                <div className="px-2 space-y-0.5">
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">
                    Mandalas
                  </div>
                  <button
                    onClick={resetErrorBoundary}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-lg transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Load failed. Tap to retry.
                  </button>
                </div>
              )}
            >
              <SidebarMandalaSection
                collapsed={collapsed}
                newlySyncedCountByMandala={newlySyncedCountByMandala}
              />
            </ErrorBoundary>
          </nav>
        </div>

        {/* Learning Panel */}
        <div
          className={cn(
            'absolute inset-0 flex flex-col transition-all duration-300 ease-in-out',
            isLearningRoute && !settingsMode
              ? 'translate-x-0 opacity-100'
              : 'translate-x-full opacity-0 pointer-events-none'
          )}
        >
          <div className={cn('pt-4 pb-2', collapsed ? 'px-2' : 'px-4')}>
            {!collapsed && (
              <div className="flex items-center justify-between gap-2 mb-3">
                <button
                  onClick={handleBackToApp}
                  className="flex items-center gap-2 text-sm font-medium text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors duration-150"
                >
                  <ArrowLeft className="w-4 h-4" />
                  {t('settings.backToApp', 'Back to app')}
                </button>
                <button
                  type="button"
                  onClick={onToggleCollapse}
                  aria-label={t('sidebar.collapse', 'Collapse sidebar')}
                  title={t('sidebar.collapse', 'Collapse sidebar')}
                  className="shrink-0 flex items-center justify-center w-8 h-8 rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                >
                  <PanelLeftClose className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <nav className="flex-1 px-0 pb-4 overflow-y-auto scrollbar-none">
            {learningMatch && (
              <SidebarLearningSection
                mandalaId={learningMatch.params.mandalaId!}
                currentVideoId={learningMatch.params.videoId}
                collapsed={collapsed}
              />
            )}
          </nav>
        </div>

        {/* Settings Panel */}
        <div
          className={cn(
            'absolute inset-0 flex flex-col transition-all duration-300 ease-in-out',
            settingsMode
              ? 'translate-x-0 opacity-100'
              : 'translate-x-full opacity-0 pointer-events-none'
          )}
        >
          <div className="px-4 pt-4 pb-2">
            <button
              onClick={handleBackToApp}
              className="flex items-center gap-2 text-sm font-medium text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors mb-4"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('settings.backToApp', 'Back to app')}
            </button>
            <h2 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-sidebar-foreground to-sidebar-primary bg-clip-text text-transparent px-1 pb-3">
              {t('settings.title', 'Settings')}
            </h2>
          </div>

          <nav className="flex-1 px-3 pb-4 overflow-y-auto scrollbar-none">
            {SETTINGS_NAV_GROUPS.map((group, gIdx) => (
              <div key={gIdx} className="mb-2">
                {group.labelKey && (
                  <div className="px-3 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/35">
                    {t(group.labelKey, group.labelKey.split('.').pop())}
                  </div>
                )}
                {!group.labelKey && gIdx > 0 && (
                  <div className="mx-2 my-2 h-px bg-sidebar-border" />
                )}
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeSettingsTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSettingsTabClick(item.id)}
                      className={cn(
                        'relative flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13.5px] font-medium transition-all duration-150 border border-transparent',
                        active
                          ? 'bg-sidebar-primary/10 text-sidebar-primary border-sidebar-primary/15 font-semibold'
                          : 'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                      )}
                    >
                      {active && (
                        <span className="absolute -left-1 top-1/2 -translate-y-1/2 w-[3px] h-[18px] bg-sidebar-primary rounded-r-sm" />
                      )}
                      <Icon
                        className={cn('w-4 h-4 shrink-0', active ? 'opacity-100' : 'opacity-60')}
                      />
                      {t(item.labelKey)}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>
      </div>

      <SidebarProfileFooter collapsed={collapsed} />
    </aside>
  );
}
