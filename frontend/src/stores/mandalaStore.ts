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
/**
 * Inputs captured at wizard submit time. Retained while the background
 * createMandala request is in flight so (a) the optimistic dashboard can
 * render cell labels before the server row exists, and (b) on failure the
 * user is returned to the wizard with their inputs intact instead of a
 * blank form.
 */
export interface PendingMandalaInputs {
  title: string;
  centerGoal: string;
  subjects: string[];
  subDetails?: Record<string, string[]>;
  centerLabel?: string;
  subLabels?: string[];
  skills?: Record<string, boolean>;
  focusTags?: string[];
  targetLevel?: string;
}

export interface PendingMandala {
  tempId: string;
  startedAt: number;
  originalInputs: PendingMandalaInputs;
}

interface MandalaUIStore {
  selectedMandalaId: string | null;
  currentLevelId: string;
  selectedCellIndex: number | null;
  /** Set after wizard creates a mandala — enables card polling until cards appear or timeout */
  justCreatedMandalaId: string | null;
  /**
   * In-flight wizard submission. Non-null from the moment the user clicks
   * "create" until either the server responds or the user cancels. A
   * non-null value also suppresses duplicate submissions (button disable +
   * early return in fireCreateMandala).
   */
  pendingMandala: PendingMandala | null;
  selectMandala: (id: string | null) => void;
  setCurrentLevel: (id: string) => void;
  setSelectedCell: (index: number | null) => void;
  setJustCreated: (id: string | null) => void;
  setPendingMandala: (p: PendingMandala | null) => void;
  clearPendingMandala: () => void;
  /** Reset all state to initial values — called on auth transitions */
  reset: () => void;
}

const INITIAL_STATE = {
  selectedMandalaId: null,
  currentLevelId: ROOT_LEVEL_ID,
  selectedCellIndex: null,
  justCreatedMandalaId: null,
  pendingMandala: null,
} as const;

export const useMandalaStore = create<MandalaUIStore>((set) => ({
  ...INITIAL_STATE,
  selectMandala: (id) => set({ selectedMandalaId: id }),
  setCurrentLevel: (id) => set({ currentLevelId: id }),
  setSelectedCell: (index) => set({ selectedCellIndex: index }),
  setJustCreated: (id) => set({ justCreatedMandalaId: id }),
  setPendingMandala: (p) => set({ pendingMandala: p }),
  clearPendingMandala: () => set({ pendingMandala: null }),
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
