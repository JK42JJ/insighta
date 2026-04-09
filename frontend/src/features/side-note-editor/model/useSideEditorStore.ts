/**
 * Zustand store for the Notion-style side editor panel.
 *
 * Carries the initial note content + save callback ref so the panel
 * can display instantly (no API call) and save through the existing
 * onSave chain (useCardOrchestrator → both tables supported).
 */
import { create } from 'zustand';

export interface SideEditorContext {
  cardId: string;
  initialNote: string;
  videoTitle: string;
}

export interface SideEditorState {
  isOpen: boolean;
  context: SideEditorContext | null;
  open: (ctx: SideEditorContext) => void;
  close: () => void;
}

/**
 * Module-scope ref for the onSave callback.
 * Set by MemoEditor before calling store.open() so the side editor
 * can save through the same pipeline (handleSaveNote in useCardOrchestrator).
 * This avoids storing functions in Zustand state.
 */
export const sideEditorSaveRef: { current: ((cardId: string, note: string) => void) | null } = {
  current: null,
};

export const useSideEditorStore = create<SideEditorState>((set) => ({
  isOpen: false,
  context: null,
  open: (context) => set({ isOpen: true, context }),
  close: () => set({ isOpen: false }),
}));
