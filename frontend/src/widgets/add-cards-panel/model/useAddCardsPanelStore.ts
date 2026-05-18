/**
 * Add Cards panel state (CP466).
 *
 * Spec: docs/design/add-cards-2026-05-18.md §6 — State management.
 * Zustand store so the panel state survives close-then-reopen (user
 * directive: "Panel 닫고 다시 열어도 검색어/결과 보존").
 *
 * Not persisted to localStorage — re-open is in-session only. Reload
 * resets state, which matches the spec (no cross-session preserve).
 */

import { create } from 'zustand';

interface AddCardsPanelState {
  /** Whether the slide-in panel is open. */
  open: boolean;
  /** Mandala id the panel is currently scoped to (null when closed). */
  mandalaId: string | null;
  /** Chip keywords appended to the locked center_goal. */
  extraKeywords: string[];
  /** videoIds the user has multi-selected for bulk add. */
  selectedIds: Set<string>;

  openPanel: (mandalaId: string) => void;
  closePanel: () => void;
  addKeyword: (kw: string) => void;
  removeKeyword: (kw: string) => void;
  toggleSelected: (videoId: string) => void;
  clearSelected: () => void;
}

export const useAddCardsPanelStore = create<AddCardsPanelState>((set) => ({
  open: false,
  mandalaId: null,
  extraKeywords: [],
  selectedIds: new Set<string>(),

  openPanel: (mandalaId) =>
    set((s) => ({
      open: true,
      // Reset keywords + selection if switching to a different mandala;
      // preserve them if the same mandala is being reopened.
      mandalaId,
      extraKeywords: s.mandalaId === mandalaId ? s.extraKeywords : [],
      selectedIds: s.mandalaId === mandalaId ? s.selectedIds : new Set<string>(),
    })),

  closePanel: () => set({ open: false }),

  addKeyword: (kw) =>
    set((s) => {
      const trimmed = kw.trim();
      if (trimmed.length === 0) return s;
      if (s.extraKeywords.includes(trimmed)) return s;
      return { ...s, extraKeywords: [...s.extraKeywords, trimmed] };
    }),

  removeKeyword: (kw) =>
    set((s) => ({ ...s, extraKeywords: s.extraKeywords.filter((k) => k !== kw) })),

  toggleSelected: (videoId) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      return { ...s, selectedIds: next };
    }),

  clearSelected: () => set({ selectedIds: new Set<string>() }),
}));
