import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Home,
  Compass,
  LayoutTemplate,
  Settings,
  HelpCircle,
  LogOut,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useAuth } from '@/features/auth/model/useAuth';
import { Button } from '@/shared/ui/button';
import { SidebarMandalaSection } from './SidebarMandalaSection';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavigateHome?: () => void;
  mandalaGridElement?: React.ReactNode;
  expandedMandalaId: string | null;
  onExpandedMandalaChange: (id: string | null) => void;
}

interface NavItem {
  to: string;
  icon: typeof Home;
  labelKey: string;
  exact?: boolean;
}

const MAIN_NAV: NavItem[] = [
  { to: '/', icon: Home, labelKey: 'sidebar.home', exact: true },
  { to: '/explore', icon: Compass, labelKey: 'sidebar.explore' },
];

const SECONDARY_NAV: NavItem[] = [
  { to: '/templates', icon: LayoutTemplate, labelKey: 'sidebar.templates' },
];

const BOTTOM_NAV: NavItem[] = [
  { to: '/settings', icon: Settings, labelKey: 'sidebar.settings' },
];

export function Sidebar({ collapsed, onToggleCollapse, onNavigateHome, mandalaGridElement, expandedMandalaId, onExpandedMandalaChange }: SidebarProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const { signOut } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleLogout = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  };

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
            collapsed && 'justify-center px-2',
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

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-16' : expandedMandalaId ? 'w-80' : 'w-56',
      )}
      aria-label={t('sidebar.navigation')}
    >
      {/* Main navigation */}
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto scrollbar-none">
        <ul className="space-y-1" role="list">
          {MAIN_NAV.map(renderNavItem)}
        </ul>

        <div className="my-3 mx-2">
          <div className="h-px bg-sidebar-border" />
        </div>

        {/* Mandala accordion section */}
        <SidebarMandalaSection
          collapsed={collapsed}
          expandedMandalaId={expandedMandalaId}
          onExpandedChange={onExpandedMandalaChange}
          mandalaGridElement={mandalaGridElement}
        />

        <div className="my-3 mx-2">
          <div className="h-px bg-sidebar-border" />
        </div>

        <ul className="space-y-1" role="list">
          {SECONDARY_NAV.map(renderNavItem)}
        </ul>
      </nav>

      {/* Bottom section */}
      <div className="px-2 py-3 space-y-1 border-t border-sidebar-border">
        <ul className="space-y-1" role="list">
          {BOTTOM_NAV.map(renderNavItem)}
        </ul>

        {/* Help */}
        <button
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
            'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            collapsed && 'justify-center px-2',
          )}
          title={collapsed ? t('sidebar.help') : undefined}
        >
          <HelpCircle className={cn('shrink-0', collapsed ? 'w-5 h-5' : 'w-4 h-4')} aria-hidden="true" />
          {!collapsed && <span>{t('sidebar.help')}</span>}
        </button>

        {/* Logout */}
        <button
          onClick={handleLogout}
          disabled={isSigningOut}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
            'text-destructive/80 hover:bg-destructive/10 hover:text-destructive',
            collapsed && 'justify-center px-2',
          )}
          title={collapsed ? t('common.logout') : undefined}
        >
          {isSigningOut ? (
            <Loader2 className={cn('shrink-0 animate-spin', collapsed ? 'w-5 h-5' : 'w-4 h-4')} />
          ) : (
            <LogOut className={cn('shrink-0', collapsed ? 'w-5 h-5' : 'w-4 h-4')} aria-hidden="true" />
          )}
          {!collapsed && <span>{t('common.logout')}</span>}
        </button>

        {/* Collapse toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleCollapse}
          className={cn(
            'w-full mt-1 text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent',
            collapsed ? 'justify-center px-2' : 'justify-end',
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
    </aside>
  );
}
