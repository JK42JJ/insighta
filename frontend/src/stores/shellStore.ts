import { create } from 'zustand';
import type { MinimapData } from '@/widgets/app-shell/ui/SidebarMandalaSection';

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
