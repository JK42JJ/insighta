/**
 * Zustand store for the dual-mode video side panel.
 *
 * Mode A (popup): card click → VideoPlayerModal (managed by useVideoModal, NOT this store)
 * Mode B (sidebar): ↗ expand → VideoSidePanel (managed by THIS store)
 *
 * Persisted to localStorage so the sidebar survives page refresh.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { InsightCard } from '@/entities/card/model/types';

export interface VideoPanelState {
  /** Current mode — determines how the next card click behaves. */
  mode: 'popup' | 'sidebar';
  /** Whether the sidebar panel is visible. */
  isOpen: boolean;
  /** The card currently displayed in the sidebar (null when closed). */
  card: InsightCard | null;
  /** Active tab in the sidebar. */
  activeTab: 'notes' | 'ai-summary';
  /** Video playback position to resume from (seconds). */
  startTime: number;

  /** ↗ expand button in MemoEditor: close modal, open sidebar. */
  expandToSidebar: (card: InsightCard, startTime?: number) => void;
  /** Card click while sidebar is open: swap content without closing. */
  openInSidebar: (card: InsightCard) => void;
  /** ✕ close sidebar → revert to popup mode. */
  closeSidebar: () => void;
  /** Switch between notes and AI summary tabs. */
  setTab: (tab: 'notes' | 'ai-summary') => void;
}

export const useVideoPanelStore = create<VideoPanelState>()(
  persist(
    (set) => ({
      mode: 'popup',
      isOpen: false,
      card: null,
      activeTab: 'notes',
      startTime: 0,

      expandToSidebar: (card, startTime = 0) =>
        set({ mode: 'sidebar', isOpen: true, card, activeTab: 'notes', startTime }),

      openInSidebar: (card) => set({ card, activeTab: 'notes' }),

      closeSidebar: () => set({ mode: 'popup', isOpen: false }),

      setTab: (tab) => set({ activeTab: tab }),
    }),
    {
      name: 'insighta-video-panel',
      partialize: (state) => ({
        mode: state.mode,
        isOpen: state.isOpen,
        card: state.card,
        activeTab: state.activeTab,
        // startTime intentionally excluded — don't resume playback on refresh
      }),
    }
  )
);
