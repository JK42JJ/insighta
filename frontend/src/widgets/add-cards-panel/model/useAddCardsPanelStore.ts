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
import type { AddCardsFilters } from './useAddCards';

interface AddCardsPanelState {
  /** Whether the slide-in panel is open. */
  open: boolean;
  /** Mandala id the panel is currently scoped to (null when closed). */
  mandalaId: string | null;
  /** Chip keywords appended to the locked center_goal. */
  extraKeywords: string[];
  /** videoIds the user has multi-selected for bulk add. */
  selectedIds: Set<string>;
  /** CP466 amendment — request filters (조회수/길이/기간). */
  filters: AddCardsFilters;
  /** CP466 amendment 2 — editable target level (난이도) from wizard. */
  targetLevel: string;
  /** True once the wizard-meta seed has run for this mandala open. */
  mandalaMetaSeeded: boolean;

  openPanel: (mandalaId: string) => void;
  closePanel: () => void;
  addKeyword: (kw: string) => void;
  removeKeyword: (kw: string) => void;
  toggleSelected: (videoId: string) => void;
  clearSelected: () => void;
  setFilters: (next: AddCardsFilters) => void;
  setTargetLevel: (level: string) => void;
  seedFromWizardMeta: (focusTags: string[], targetLevel: string) => void;
  setExtraKeywords: (keywords: string[]) => void;
}

export const useAddCardsPanelStore = create<AddCardsPanelState>((set) => ({
  open: false,
  mandalaId: null,
  extraKeywords: [],
  selectedIds: new Set<string>(),
  filters: {},
  targetLevel: 'standard',
  mandalaMetaSeeded: false,

  openPanel: (mandalaId) =>
    set((s) => ({
      open: true,
      // Reset keywords + selection + filters + level if switching to a
      // different mandala; preserve them if the same mandala is being
      // reopened.
      mandalaId,
      extraKeywords: s.mandalaId === mandalaId ? s.extraKeywords : [],
      selectedIds: s.mandalaId === mandalaId ? s.selectedIds : new Set<string>(),
      filters: s.mandalaId === mandalaId ? s.filters : {},
      targetLevel: s.mandalaId === mandalaId ? s.targetLevel : 'standard',
      // Force re-seed when switching mandalas so the wizard meta loads fresh.
      mandalaMetaSeeded: s.mandalaId === mandalaId ? s.mandalaMetaSeeded : false,
    })),

  setFilters: (next) => set({ filters: next }),
  setTargetLevel: (level) => set({ targetLevel: level }),
  setExtraKeywords: (keywords) => set({ extraKeywords: keywords }),
  seedFromWizardMeta: (focusTags, targetLevel) =>
    set((s) => {
      if (s.mandalaMetaSeeded) return s;
      // Merge focus tags into extraKeywords (dedup, no auto-overwrite of
      // user-typed chips). Adopt the wizard target level only when the
      // user has not yet changed it.
      const merged = [...s.extraKeywords];
      for (const t of focusTags) {
        const trimmed = (t ?? '').trim();
        if (trimmed && !merged.includes(trimmed)) merged.push(trimmed);
      }
      return {
        ...s,
        extraKeywords: merged,
        targetLevel: s.targetLevel === 'standard' ? targetLevel : s.targetLevel,
        mandalaMetaSeeded: true,
      };
    }),

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
