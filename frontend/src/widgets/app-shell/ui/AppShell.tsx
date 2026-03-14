import { useState, useCallback } from 'react';
import { Sidebar } from './Sidebar';
import { AppHeader } from './AppHeader';
import { MobileDrawer } from './MobileDrawer';

interface AppShellProps {
  children: React.ReactNode;
  onNavigateHome?: () => void;
  mandalaGridElement?: React.ReactNode;
  expandedMandalaId?: string | null;
  onExpandedMandalaChange?: (id: string | null) => void;
  selectedMandalaId: string | null;
  onMandalaSelect: (id: string) => void;
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
  mandalaGridElement,
  expandedMandalaId,
  onExpandedMandalaChange,
  selectedMandalaId,
  onMandalaSelect,
}: AppShellProps) {
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
      <AppHeader onMobileMenuOpen={() => setMobileDrawerOpen(true)} />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={handleToggleCollapse}
          onNavigateHome={onNavigateHome}
          mandalaGridElement={mandalaGridElement}
          expandedMandalaId={expandedMandalaId ?? null}
          onExpandedMandalaChange={onExpandedMandalaChange ?? (() => {})}
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
