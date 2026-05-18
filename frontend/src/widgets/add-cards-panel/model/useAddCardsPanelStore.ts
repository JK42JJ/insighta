/**
 * Add Cards panel state (CP466).
 *
 * Spec: docs/design/add-cards-2026-05-18.md §6 — State management.
 * Zustand store so the panel state survives close-then-reopen.
 *
 * CP466 amendment 8 — multi-select removed (Bookmark click is the
 * single-card pick action; bulk bar retired). Selection state +
 * pickedSet is panel-local (useState in AddCardsPanel) — not stored
 * here because once a user picks a card, the next search excludes it
 * server-side (via card_interactions.like / user_video_states join).
 */

import { create } from 'zustand';
import type { AddCardsFilters } from './useAddCards';

interface AddCardsPanelState {
  open: boolean;
  mandalaId: string | null;
  extraKeywords: string[];
  filters: AddCardsFilters;
  targetLevel: string;
  mandalaMetaSeeded: boolean;
  /** CP466 amendment 11 — last visible result count per mandala.
   *  Read by `AddCardsTriggerChip` so the chip surfaces the same
   *  count badge the panel header shows, even when the panel is
   *  closed. */
  visibleCountByMandala: Record<string, number>;

  openPanel: (mandalaId: string) => void;
  closePanel: () => void;
  addKeyword: (kw: string) => void;
  removeKeyword: (kw: string) => void;
  setFilters: (next: AddCardsFilters) => void;
  setTargetLevel: (level: string) => void;
  seedFromWizardMeta: (focusTags: string[], targetLevel: string) => void;
  setExtraKeywords: (keywords: string[]) => void;
  setVisibleCount: (mandalaId: string, count: number) => void;
}

export const useAddCardsPanelStore = create<AddCardsPanelState>((set) => ({
  open: false,
  mandalaId: null,
  extraKeywords: [],
  filters: {},
  targetLevel: 'standard',
  mandalaMetaSeeded: false,
  visibleCountByMandala: {},

  openPanel: (mandalaId) =>
    set((s) => ({
      open: true,
      mandalaId,
      extraKeywords: s.mandalaId === mandalaId ? s.extraKeywords : [],
      filters: s.mandalaId === mandalaId ? s.filters : {},
      targetLevel: s.mandalaId === mandalaId ? s.targetLevel : 'standard',
      mandalaMetaSeeded: s.mandalaId === mandalaId ? s.mandalaMetaSeeded : false,
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
    // CP466 amendment 11 — user explicitly removing a chip is a
    // veto of wizard-meta seed: lock further seeding so a subsequent
    // search.onSuccess does not re-add the chip the user just deleted.
    set((s) => ({
      ...s,
      extraKeywords: s.extraKeywords.filter((k) => k !== kw),
      mandalaMetaSeeded: true,
    })),

  setFilters: (next) => set({ filters: next }),
  setTargetLevel: (level) => set({ targetLevel: level }),
  setExtraKeywords: (keywords) => set({ extraKeywords: keywords, mandalaMetaSeeded: true }),
  setVisibleCount: (mandalaId, count) =>
    set((s) => ({
      visibleCountByMandala: { ...s.visibleCountByMandala, [mandalaId]: count },
    })),
  seedFromWizardMeta: (focusTags, targetLevel) =>
    set((s) => {
      if (s.mandalaMetaSeeded) return s;
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
}));
