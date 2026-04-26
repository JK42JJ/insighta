import { useState, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { DndContext } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { Sidebar } from './Sidebar';
import { AppHeader } from './AppHeader';
import { MobileDrawer } from './MobileDrawer';
import { useShellStore, dndHandlersRef } from '@/stores/shellStore';
import { useAuth } from '@/features/auth/model/useAuth';
import { useDndSensors, pointerWithinThenClosest } from '@/shared/lib/dnd';
import type { DragData } from '@/shared/lib/dnd';

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
const SIDEBAR_ROUTES = ['/', '/mandalas', '/learning'];

/** Routes where sidebar is explicitly hidden (full-width content) */
const NO_SIDEBAR_ROUTES = ['/mandalas/new'];
const NO_SIDEBAR_PATTERNS = [/^\/mandalas\/[^/]+$/, /^\/mandalas\/[^/]+\/edit$/];

export function AppShell({ children }: AppShellProps) {
  const minimapData = useShellStore((s) => s.minimapData);
  const searchBarElement = useShellStore((s) => s.searchBarElement);
  const onNavigateHome = useShellStore((s) => s.onNavigateHome);
  const newlySyncedCountByMandala = useShellStore((s) => s.newlySyncedCountByMandala);
  const { isLoggedIn } = useAuth();
  const { t } = useTranslation();
  const sensors = useDndSensors();
  const location = useLocation();
  const isSettingsRoute = location.pathname.startsWith('/settings');
  // Sidebar only for authenticated users on app routes — hidden for wizard/dashboard/editor
  const isNoSidebarRoute =
    NO_SIDEBAR_ROUTES.includes(location.pathname) ||
    NO_SIDEBAR_PATTERNS.some((p) => p.test(location.pathname));

  const showSidebar =
    isLoggedIn &&
    !isNoSidebarRoute &&
    (isSettingsRoute ||
      SIDEBAR_ROUTES.some((r) =>
        r === '/' ? location.pathname === '/' : location.pathname.startsWith(r)
      ));

  const announcements = useMemo(
    () => ({
      onDragStart({ active }: { active: { data: { current: unknown } } }) {
        const data = active.data.current as DragData | undefined;
        if (data?.type === 'cell') return t('dnd.dragStartCell', 'Picked up cell');
        if (data?.type === 'card' || data?.type === 'card-reorder')
          return t('dnd.dragStartCard', 'Picked up card');
        return t('dnd.dragStart', 'Dragging');
      },
      onDragOver({ over }: { over: unknown }) {
        if (over) return t('dnd.dragOver', 'Over drop zone');
        return t('dnd.dragOutside', 'Outside drop zone');
      },
      onDragEnd({ over }: { over: unknown }) {
        if (over) return t('dnd.dropped', 'Dropped');
        return t('dnd.dragCancel', 'Drag cancelled');
      },
      onDragCancel() {
        return t('dnd.dragCancel', 'Drag cancelled');
      },
    }),
    [t]
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

  // Public pages (landing, login, etc.) render their own header — skip AppShell chrome
  if (!isLoggedIn) {
    return <>{children}</>;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithinThenClosest}
      accessibility={{ announcements }}
      onDragStart={(e) => dndHandlersRef.current?.onDragStart(e)}
      onDragOver={(e) => dndHandlersRef.current?.onDragOver(e)}
      onDragEnd={(e) => dndHandlersRef.current?.onDragEnd(e)}
      onDragCancel={() => dndHandlersRef.current?.onDragCancel()}
    >
      <div className="h-screen flex flex-col bg-surface-base overflow-hidden">
        <AppHeader
          onMobileMenuOpen={() => setMobileDrawerOpen(true)}
          searchBarElement={searchBarElement}
        />

        <div className="flex-1 flex overflow-hidden">
          {showSidebar && (
            <Sidebar
              collapsed={
                isSettingsRoute || location.pathname.startsWith('/learning')
                  ? false
                  : sidebarCollapsed
              }
              onToggleCollapse={handleToggleCollapse}
              onNavigateHome={onNavigateHome ?? undefined}
              minimapData={minimapData ?? undefined}
              newlySyncedCountByMandala={newlySyncedCountByMandala}
              settingsMode={isSettingsRoute}
            />
          )}

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
    </DndContext>
  );
}
