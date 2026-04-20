import { useState, useCallback, useRef } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Home,
  ChevronLeft,
  ChevronRight,
  Settings,
  Palette,
  Bell,
  LayoutGrid,
  Link2,
  CreditCard,
  Shield,
  ArrowLeft,
  User,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { SidebarMandalaSection, type MinimapData } from './SidebarMandalaSection';
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

const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_SIDEBAR_WIDTH = 320;
const SIDEBAR_WIDTH_KEY = 'insighta-sidebar-width';

function getInitialWidth(): number {
  try {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed)) return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, parsed));
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SIDEBAR_WIDTH;
}

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavigateHome?: () => void;
  minimapData?: MinimapData;
  /** Issue #389: per-mandala "Newly Synced" card count for the sidebar dot+count indicator. */
  newlySyncedCountByMandala?: Record<string, number>;
  settingsMode?: boolean;
}

interface NavItem {
  to: string;
  icon: typeof Home;
  labelKey: string;
  exact?: boolean;
}

const MAIN_NAV: NavItem[] = [{ to: '/', icon: Home, labelKey: 'sidebar.home', exact: true }];

export function Sidebar({
  collapsed,
  onToggleCollapse,
  onNavigateHome,
  minimapData,
  newlySyncedCountByMandala,
  settingsMode = false,
}: SidebarProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sidebarWidth, setSidebarWidth] = useState(getInitialWidth);
  const widthRef = useRef(sidebarWidth);
  widthRef.current = sidebarWidth;

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const sidebar = e.currentTarget.parentElement as HTMLElement;
    const startWidth = sidebar.getBoundingClientRect().width;

    // Disable transition during drag for instant feedback
    sidebar.style.transition = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      // DOM direct manipulation — no React rerender, 60fps
      const newWidth = Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(MAX_SIDEBAR_WIDTH, startWidth + (ev.clientX - startX))
      );
      sidebar.style.width = `${newWidth}px`;
    };

    const onMouseUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      sidebar.style.transition = '';

      // Sync React state + persist once on mouseup
      const finalWidth = Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(MAX_SIDEBAR_WIDTH, startWidth + (ev.clientX - startX))
      );
      setSidebarWidth(finalWidth);
      widthRef.current = finalWidth;
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(finalWidth));
      } catch {
        /* ignore */
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleResizeDoubleClick = useCallback(() => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    widthRef.current = DEFAULT_SIDEBAR_WIDTH;
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(DEFAULT_SIDEBAR_WIDTH));
    } catch {
      /* ignore */
    }
  }, []);

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
            'relative flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
            'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            collapsed && 'justify-center px-2'
          )}
          aria-current={active ? 'page' : undefined}
          title={collapsed ? t(item.labelKey) : undefined}
        >
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

  const showResizeHandle = !collapsed;

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col h-full bg-sidebar border-r border-sidebar-border shrink-0 transition-[width] duration-300 ease-in-out overflow-hidden relative',
        !settingsMode && collapsed && 'w-16'
      )}
      style={{
        width: collapsed && !settingsMode ? undefined : `${sidebarWidth}px`,
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
          {location.pathname === '/' && (
            <>
              <ul className="space-y-1" role="list">
                {MAIN_NAV.map(renderNavItem)}
              </ul>
              <div className="my-3 mx-2">
                <div className="h-px bg-sidebar-border" />
              </div>
            </>
          )}

          {/* Mandala section — error boundary prevents sidebar crash */}
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
              minimapData={minimapData}
              newlySyncedCountByMandala={newlySyncedCountByMandala}
            />
          </ErrorBoundary>
        </nav>

        {/* Bottom section — collapse toggle only */}
        <div className="px-2 py-3 border-t border-sidebar-border">
          <div
            className={cn('flex items-center', collapsed ? 'justify-center' : 'justify-end gap-1')}
          >
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
              {collapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronLeft className="w-4 h-4" />
              )}
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
              {!group.labelKey && gIdx > 0 && <div className="mx-2 my-2 h-px bg-sidebar-border" />}
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

      {/* Resize handle */}
      {showResizeHandle && (
        <div
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize z-50"
          onMouseDown={handleResizeStart}
          onDoubleClick={handleResizeDoubleClick}
        />
      )}
    </aside>
  );
}
