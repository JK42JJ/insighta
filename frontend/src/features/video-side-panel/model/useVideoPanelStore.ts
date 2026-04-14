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
  /** Whether the video should auto-play. True only on explicit user actions
   *  (expand/openInSidebar). Reset to false on persist rehydration so refresh
   *  doesn't trigger autoplay. */
  shouldAutoplay: boolean;
  /** Whether the user has ever clicked play inside the iframe in this session.
   *  Once true, subsequent card switches autoplay. Reset on refresh. */
  hasUserPlayedOnce: boolean;

  /** ↗ expand button in MemoEditor: close modal, open sidebar. */
  expandToSidebar: (card: InsightCard, startTime?: number) => void;
  /** Card click while sidebar is open: swap content without closing. */
  openInSidebar: (card: InsightCard) => void;
  /** Programmatic card swap (e.g. on mandala change) — autoplay defaults to false
   *  so the new card loads in stopped state. */
  swapCard: (card: InsightCard, autoplay?: boolean) => void;
  /** ✕ close sidebar → revert to popup mode. */
  closeSidebar: () => void;
  /** Switch between notes and AI summary tabs. */
  setTab: (tab: 'notes' | 'ai-summary') => void;
  /** Mark autoplay consumed — call after the iframe loads to prevent
   *  re-trigger on subsequent re-renders. */
  consumeAutoplay: () => void;
  /** Mark that user has clicked play in the iframe (gesture confirmed).
   *  Subsequent card switches will autoplay. */
  markUserPlayed: () => void;
}

export const useVideoPanelStore = create<VideoPanelState>()(
  persist(
    (set) => ({
      mode: 'popup',
      isOpen: false,
      card: null,
      activeTab: 'notes',
      startTime: 0,
      shouldAutoplay: false,
      hasUserPlayedOnce: false,

      expandToSidebar: (card, startTime = 0) =>
        set({
          mode: 'sidebar',
          isOpen: true,
          card,
          activeTab: 'notes',
          startTime,
          // Modal was already playing → user gesture established → autoplay safe
          shouldAutoplay: true,
          hasUserPlayedOnce: true,
        }),

      // Card click while sidebar open: autoplay only if user has played before
      // (Option C: respect browser autoplay policy — first play needs user gesture)
      openInSidebar: (card) =>
        set((state) => ({
          card,
          activeTab: 'notes',
          shouldAutoplay: state.hasUserPlayedOnce,
        })),

      swapCard: (card, autoplay = false) =>
        set({ card, activeTab: 'notes', shouldAutoplay: autoplay }),

      closeSidebar: () => set({ mode: 'popup', isOpen: false, shouldAutoplay: false }),

      setTab: (tab) => set({ activeTab: tab }),

      consumeAutoplay: () => set({ shouldAutoplay: false }),

      markUserPlayed: () => set({ hasUserPlayedOnce: true }),
    }),
    {
      name: 'insighta-video-panel',
      partialize: (state) => ({
        mode: state.mode,
        isOpen: state.isOpen,
        card: state.card,
        activeTab: state.activeTab,
        // startTime intentionally excluded — don't resume playback on refresh
        // shouldAutoplay intentionally excluded — refresh must NOT autoplay
      }),
    }
  )
);
