import { create } from 'zustand';
import type { DragStartEvent, DragOverEvent, DragEndEvent } from '@dnd-kit/core';
import type { MinimapData } from '@/widgets/app-shell/ui/SidebarMandalaSection';

export interface DndHandlers {
  onDragStart: (e: DragStartEvent) => void;
  onDragOver: (e: DragOverEvent) => void;
  onDragEnd: (e: DragEndEvent) => void;
  onDragCancel: () => void;
}

/**
 * Module-level ref for D&D handlers — always holds the latest handler references.
 * Written synchronously by IndexPage during render, read by AppShell via wrapper callbacks.
 * This avoids stale closure issues from useEffect-based store sync.
 */
export const dndHandlersRef: { current: DndHandlers | null } = { current: null };

interface ShellStore {
  minimapData: MinimapData | null;
  searchBarElement: React.ReactNode | null;
  onNavigateHome: (() => void) | null;
  setMinimapData: (data: MinimapData | null) => void;
  setSearchBarElement: (el: React.ReactNode | null) => void;
  setOnNavigateHome: (fn: (() => void) | null) => void;
  clearShell: () => void;
}

export const useShellStore = create<ShellStore>((set) => ({
  minimapData: null,
  searchBarElement: null,
  onNavigateHome: null,
  setMinimapData: (data) => set({ minimapData: data }),
  setSearchBarElement: (el) => set({ searchBarElement: el }),
  setOnNavigateHome: (fn) => set({ onNavigateHome: fn }),
  clearShell: () => set({ minimapData: null, searchBarElement: null, onNavigateHome: null }),
}));
