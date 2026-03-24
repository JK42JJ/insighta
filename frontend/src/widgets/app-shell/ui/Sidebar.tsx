import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Home,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Settings,
  Palette,
  Bell,
  LayoutGrid,
  Link2,
  CreditCard,
  Shield,
  ArrowLeft,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { SidebarMandalaSection, type MinimapData } from './SidebarMandalaSection';
import { ErrorBoundary } from 'react-error-boundary';
import { RefreshCw } from 'lucide-react';

type SettingsCategory =
  | 'general'
  | 'appearance'
  | 'notifications'
  | 'mandalas'
  | 'integrations'
  | 'subscription'
  | 'data';

const SETTINGS_NAV_GROUPS = [
  {
    labelKey: 'settings.navAccount',
    items: [
      { id: 'general' as SettingsCategory, icon: Settings, labelKey: 'settings.general' },
      { id: 'appearance' as SettingsCategory, icon: Palette, labelKey: 'settings.appearance' },
      { id: 'notifications' as SettingsCategory, icon: Bell, labelKey: 'settings.notifications' },
    ],
  },
  {
    labelKey: 'settings.navWorkspace',
    items: [
      { id: 'mandalas' as SettingsCategory, icon: LayoutGrid, labelKey: 'settings.mandalas' },
      { id: 'integrations' as SettingsCategory, icon: Link2, labelKey: 'settings.integrations' },
    ],
  },
  {
    labelKey: 'settings.navBilling',
    items: [
      { id: 'subscription' as SettingsCategory, icon: CreditCard, labelKey: 'settings.subscription' },
    ],
  },
  {
    labelKey: '',
    items: [
      { id: 'data' as SettingsCategory, icon: Shield, labelKey: 'settings.dataPrivacy' },
    ],
  },
];

interface SidebarProps {
  collapsed: boolean;
  sidebarSize: 'compact' | 'wide';
  onToggleCollapse: () => void;
  onToggleSize?: () => void;
  onNavigateHome?: () => void;
  minimapData?: MinimapData;
  selectedMandalaId: string | null;
  onMandalaSelect: (id: string) => void;
  settingsMode?: boolean;
}

interface NavItem {
  to: string;
  icon: typeof Home;
  labelKey: string;
  exact?: boolean;
}

const MAIN_NAV: NavItem[] = [
  { to: '/', icon: Home, labelKey: 'sidebar.home', exact: true },
];

const SIDEBAR_WIDTH = {
  compact: '22rem',   // 352px
  wide: '30rem',      // 480px
} as const;

export function Sidebar({
  collapsed,
  sidebarSize,
  onToggleCollapse,
  onToggleSize,
  onNavigateHome,
  minimapData,
  selectedMandalaId,
  onMandalaSelect,
  settingsMode = false,
}: SidebarProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  const renderNavItem = (item: NavItem) => {
    const active = isActive(item.to, item.exact);
    const Icon = item.icon;

    const handleClick = () => {
      if (item.to === '/' && onNavigateHome) {
        onNavigateHome();
      }
    };

    return (
      <li key={item.to}>
        <Link
          to={item.to}
          onClick={handleClick}
          className={cn(
            'relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
            'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            active
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-sidebar-foreground/70',
            collapsed && 'justify-center px-2'
          )}
          aria-current={active ? 'page' : undefined}
          title={collapsed ? t(item.labelKey) : undefined}
        >
          {active && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[60%] bg-sidebar-primary rounded-r-sm" />
          )}
          <Icon className={cn('shrink-0', collapsed ? 'w-5 h-5' : 'w-4 h-4')} aria-hidden="true" />
          {!collapsed && <span>{t(item.labelKey)}</span>}
        </Link>
      </li>
    );
  };

  const activeSettingsTab = (searchParams.get('tab') as SettingsCategory) || 'general';

  const handleSettingsTabClick = (tab: SettingsCategory) => {
    setSearchParams({ tab });
  };

  const handleBackToApp = () => {
    navigate('/');
  };

  // Settings sidebar width — fixed compact width for clean nav
  const SETTINGS_SIDEBAR_WIDTH = '16rem'; // 256px

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col h-full bg-sidebar border-r border-sidebar-border shrink-0 transition-[width] duration-300 ease-in-out overflow-hidden relative',
        !settingsMode && collapsed && 'w-16',
      )}
      style={{
        width: settingsMode
          ? SETTINGS_SIDEBAR_WIDTH
          : collapsed
            ? undefined
            : SIDEBAR_WIDTH[sidebarSize],
      }}
      aria-label={t('sidebar.navigation')}
    >
      {/* App Panel */}
      <div
        className={cn(
          'absolute inset-0 flex flex-col transition-all duration-300 ease-in-out',
          settingsMode ? '-translate-x-full opacity-0' : 'translate-x-0 opacity-100'
        )}
      >
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto scrollbar-none">
          <ul className="space-y-1" role="list">
            {MAIN_NAV.map(renderNavItem)}
          </ul>

          <div className="my-3 mx-2">
            <div className="h-px bg-sidebar-border" />
          </div>

          {/* Mandala section — error boundary prevents sidebar crash */}
          <ErrorBoundary
            fallbackRender={({ resetErrorBoundary }) => (
              <div className="px-2 space-y-0.5">
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
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
              minimapData={minimapData}
              selectedMandalaId={selectedMandalaId}
              onMandalaSelect={onMandalaSelect}
            />
          </ErrorBoundary>
        </nav>

        {/* Bottom section — collapse/size toggles only */}
        <div className="px-2 py-3 border-t border-sidebar-border">
          <div className={cn('flex items-center', collapsed ? 'justify-center' : 'justify-end gap-1')}>
            {!collapsed && onToggleSize && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggleSize}
                className="text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent px-2"
                aria-label={sidebarSize === 'compact' ? 'Expand sidebar' : 'Shrink sidebar'}
                title={sidebarSize === 'compact' ? 'Expand sidebar' : 'Shrink sidebar'}
              >
                {sidebarSize === 'compact' ? (
                  <Maximize2 className="w-3.5 h-3.5" />
                ) : (
                  <Minimize2 className="w-3.5 h-3.5" />
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleCollapse}
              className={cn(
                'text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent',
                collapsed ? 'justify-center px-2' : 'px-2'
              )}
              aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
            >
              {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Settings Panel */}
      <div
        className={cn(
          'absolute inset-0 flex flex-col transition-all duration-300 ease-in-out',
          settingsMode ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
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
                const isActive = activeSettingsTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSettingsTabClick(item.id)}
                    className={cn(
                      'relative flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13.5px] font-medium transition-all duration-150 border border-transparent',
                      isActive
                        ? 'bg-sidebar-primary/10 text-sidebar-primary border-sidebar-primary/15 font-semibold'
                        : 'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                    )}
                  >
                    {isActive && (
                      <span className="absolute -left-1 top-1/2 -translate-y-1/2 w-[3px] h-[18px] bg-sidebar-primary rounded-r-sm" />
                    )}
                    <Icon className={cn('w-4 h-4 shrink-0', isActive ? 'opacity-100' : 'opacity-60')} />
                    {t(item.labelKey)}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}
