import { useState, useCallback } from 'react';
import { Sidebar } from './Sidebar';
import { AppHeader } from './AppHeader';
import { MobileDrawer } from './MobileDrawer';

interface AppShellProps {
  children: React.ReactNode;
  onNavigateHome?: () => void;
  mandalaGridElement?: React.ReactNode;
  selectedMandalaId: string | null;
  onMandalaSelect: (id: string) => void;
  searchBarElement?: React.ReactNode;
}

const SIDEBAR_COLLAPSED_KEY = 'insighta-sidebar-collapsed';
const SIDEBAR_SIZE_KEY = 'insighta-sidebar-size';

function getInitialCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function getInitialSize(): 'compact' | 'wide' {
  try {
    const stored = localStorage.getItem(SIDEBAR_SIZE_KEY);
    if (stored === 'wide') return 'wide';
  } catch {
    // ignore
  }
  return 'compact';
}

export function AppShell({
  children,
  onNavigateHome,
  mandalaGridElement,
  selectedMandalaId,
  onMandalaSelect,
  searchBarElement,
}: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getInitialCollapsed);
  const [sidebarSize, setSidebarSize] = useState<'compact' | 'wide'>(getInitialSize);
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

  const handleToggleSize = useCallback(() => {
    setSidebarSize((prev) => {
      const next = prev === 'compact' ? 'wide' : 'compact';
      try {
        localStorage.setItem(SIDEBAR_SIZE_KEY, next);
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
          collapsed={sidebarCollapsed}
          sidebarSize={sidebarCollapsed ? 'compact' : sidebarSize}
          onToggleCollapse={handleToggleCollapse}
          onToggleSize={sidebarCollapsed ? undefined : handleToggleSize}
          onNavigateHome={onNavigateHome}
          mandalaGridElement={mandalaGridElement}
          selectedMandalaId={selectedMandalaId}
          onMandalaSelect={onMandalaSelect}
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
