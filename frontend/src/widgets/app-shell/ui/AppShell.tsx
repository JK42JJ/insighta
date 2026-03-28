import { useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { AppHeader } from './AppHeader';
import { MobileDrawer } from './MobileDrawer';
import { useShellStore } from '@/stores/shellStore';

interface AppShellProps {
  children: React.ReactNode;
}

const SIDEBAR_COLLAPSED_KEY = 'insighta-sidebar-collapsed';

function getInitialCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Routes that render the full sidebar layout */
const SIDEBAR_ROUTES = [
  '/',
  '/mandalas',
  '/profile',
  '/subscription',
  '/help',
  '/privacy',
  '/terms',
];

export function AppShell({ children }: AppShellProps) {
  const minimapData = useShellStore((s) => s.minimapData);
  const searchBarElement = useShellStore((s) => s.searchBarElement);
  const onNavigateHome = useShellStore((s) => s.onNavigateHome);
  const location = useLocation();
  const isSettingsRoute = location.pathname.startsWith('/settings');
  const showSidebar =
    isSettingsRoute ||
    SIDEBAR_ROUTES.some((r) =>
      r === '/' ? location.pathname === '/' : location.pathname.startsWith(r)
    );

  const [sidebarCollapsed, setSidebarCollapsed] = useState(getInitialCollapsed);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const handleToggleCollapse = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // Public routes — no sidebar, no header chrome
  if (!showSidebar) {
    return (
      <main id="main-content" className="h-screen overflow-y-auto">
        {children}
      </main>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-surface-base overflow-hidden">
      <AppHeader
        onMobileMenuOpen={() => setMobileDrawerOpen(true)}
        searchBarElement={searchBarElement}
      />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          collapsed={isSettingsRoute ? false : sidebarCollapsed}
          onToggleCollapse={handleToggleCollapse}
          onNavigateHome={onNavigateHome ?? undefined}
          minimapData={minimapData ?? undefined}
          settingsMode={isSettingsRoute}
        />

        <main id="main-content" className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      <MobileDrawer
        open={mobileDrawerOpen}
        onOpenChange={setMobileDrawerOpen}
        onNavigateHome={onNavigateHome ?? undefined}
      />
    </div>
  );
}
