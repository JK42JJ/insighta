/**
 * Zustand store for the Notion-style side editor panel.
 *
 * The URL is the source of truth — `SideEditorRouteAdapter` calls `open()` on
 * mount and `close()` on unmount. The store only drives Sheet render state
 * and carries context (videoId + mandala cell info) to the panel.
 */
import { create } from 'zustand';

export interface SideEditorContext {
  videoId: string;
  /** null for scratchpad cards with no mandala. */
  mandalaId: string | null;
}

export interface SideEditorState {
  isOpen: boolean;
  context: SideEditorContext | null;
  open: (ctx: SideEditorContext) => void;
  close: () => void;
}

export const useSideEditorStore = create<SideEditorState>((set) => ({
  isOpen: false,
  context: null,
  open: (context) => set({ isOpen: true, context }),
  // Keep `context` on close so the Sheet exit animation doesn't flash empty.
  close: () => set({ isOpen: false }),
}));
