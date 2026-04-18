import { create } from 'zustand';
import { subscribeAuth } from '@/shared/lib/auth-event-bus';

const ROOT_LEVEL_ID = 'root';

/**
 * UI-only mandala selection state.
 * Server data (mandalaLevels, list, etc.) stays in TanStack Query.
 *
 * IMPORTANT: This store subscribes to the auth event bus and resets
 * all state on SIGNED_OUT / user change. Without this, a stale
 * selectedMandalaId from User A would leak into User B's session
 * when switching accounts without a full page reload (Issue #369).
 */
interface MandalaUIStore {
  selectedMandalaId: string | null;
  currentLevelId: string;
  selectedCellIndex: number | null;
  /** Set after wizard creates a mandala — enables card polling until cards appear or timeout */
  justCreatedMandalaId: string | null;
  selectMandala: (id: string | null) => void;
  setCurrentLevel: (id: string) => void;
  setSelectedCell: (index: number | null) => void;
  setJustCreated: (id: string | null) => void;
  /** Reset all state to initial values — called on auth transitions */
  reset: () => void;
}

const INITIAL_STATE = {
  selectedMandalaId: null,
  currentLevelId: ROOT_LEVEL_ID,
  selectedCellIndex: null,
  justCreatedMandalaId: null,
} as const;

export const useMandalaStore = create<MandalaUIStore>((set) => ({
  ...INITIAL_STATE,
  selectMandala: (id) => set({ selectedMandalaId: id }),
  setCurrentLevel: (id) => set({ currentLevelId: id }),
  setSelectedCell: (index) => set({ selectedCellIndex: index }),
  setJustCreated: (id) => set({ justCreatedMandalaId: id }),
  reset: () => set({ ...INITIAL_STATE }),
}));

// ─── Auth event bus subscription ───
// Reset store on sign-out or user change to prevent cross-user
// state leakage. Mirrors QueryProvider.tsx's per-session client swap.
let currentUserId: string | null = null;
subscribeAuth((event, session) => {
  const newUserId = session?.user?.id ?? null;
  if (event === 'SIGNED_OUT' || currentUserId !== newUserId) {
    useMandalaStore.getState().reset();
  }
  currentUserId = newUserId;
});
