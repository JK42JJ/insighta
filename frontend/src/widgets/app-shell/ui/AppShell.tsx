import { useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { AppHeader } from './AppHeader';
import { MobileDrawer } from './MobileDrawer';
import type { MinimapData } from './SidebarMandalaSection';

interface AppShellProps {
  children: React.ReactNode;
  onNavigateHome?: () => void;
  minimapData?: MinimapData;
  selectedMandalaId?: string | null;
  onMandalaSelect?: (id: string) => void;
  searchBarElement?: React.ReactNode;
}

const SIDEBAR_COLLAPSED_KEY = 'insighta-sidebar-collapsed';

function getInitialCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function AppShell({
  children,
  onNavigateHome,
  minimapData,
  selectedMandalaId,
  onMandalaSelect,
  searchBarElement,
}: AppShellProps) {
  const location = useLocation();
  const isSettingsRoute = location.pathname.startsWith('/settings');
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

  return (
    <div className="h-screen flex flex-col bg-surface-base overflow-hidden">
      <AppHeader onMobileMenuOpen={() => setMobileDrawerOpen(true)} searchBarElement={searchBarElement} />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          collapsed={isSettingsRoute ? false : sidebarCollapsed}
          onToggleCollapse={handleToggleCollapse}
          onNavigateHome={onNavigateHome}
          minimapData={minimapData}
          selectedMandalaId={selectedMandalaId}
          onMandalaSelect={onMandalaSelect}
          settingsMode={isSettingsRoute}
        />

        <main id="main-content" className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      <MobileDrawer
        open={mobileDrawerOpen}
        onOpenChange={setMobileDrawerOpen}
        onNavigateHome={onNavigateHome}
      />
    </div>
  );
}
