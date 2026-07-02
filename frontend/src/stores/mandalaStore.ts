import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { subscribeAuth } from '@/shared/lib/auth-event-bus';
import type { MandalaPath } from '@/entities/card/model/types';

const ROOT_LEVEL_ID = 'root';
const PERSIST_KEY = 'insighta-mandala-ui';

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

export interface MandalaNavigationState {
  currentLevelId: string;
  selectedCellIndex: number | null;
  path: MandalaPath[];
  entryGridIndex: number | null;
}

const DEFAULT_NAVIGATION: MandalaNavigationState = {
  currentLevelId: ROOT_LEVEL_ID,
  selectedCellIndex: null,
  path: [],
  entryGridIndex: null,
};

interface MandalaUIStore {
  selectedMandalaId: string | null;
  navigationByMandala: Record<string, MandalaNavigationState>;
  justCreatedMandalaId: string | null;
  pendingMandala: PendingMandala | null;
  lastOptimisticTitle: { id: string; title: string } | null;
  /** ⌘K palette → cross-route card highlight handoff (transient — NOT persisted). */
  pendingCardHighlight: { cardId: string; videoId: string | null } | null;
  selectMandala: (id: string | null) => void;
  setPendingCardHighlight: (v: { cardId: string; videoId: string | null } | null) => void;
  setNavigation: (mandalaId: string, patch: Partial<MandalaNavigationState>) => void;
  clearNavigation: (mandalaId: string) => void;
  getNavigation: (mandalaId: string | null | undefined) => MandalaNavigationState;
  setJustCreated: (id: string | null) => void;
  setPendingMandala: (p: PendingMandala | null) => void;
  clearPendingMandala: () => void;
  setLastOptimisticTitle: (v: { id: string; title: string } | null) => void;
  reset: () => void;
}

const INITIAL_STATE = {
  selectedMandalaId: null,
  navigationByMandala: {} as Record<string, MandalaNavigationState>,
  justCreatedMandalaId: null,
  pendingMandala: null,
  lastOptimisticTitle: null,
  pendingCardHighlight: null as { cardId: string; videoId: string | null } | null,
};

export const useMandalaStore = create<MandalaUIStore>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,
      selectMandala: (id) => set({ selectedMandalaId: id }),
      setPendingCardHighlight: (v) => set({ pendingCardHighlight: v }),
      setNavigation: (mandalaId, patch) =>
        set((state) => ({
          navigationByMandala: {
            ...state.navigationByMandala,
            [mandalaId]: {
              ...DEFAULT_NAVIGATION,
              ...state.navigationByMandala[mandalaId],
              ...patch,
            },
          },
        })),
      clearNavigation: (mandalaId) =>
        set((state) => {
          if (!state.navigationByMandala[mandalaId]) return state;
          const next = { ...state.navigationByMandala };
          delete next[mandalaId];
          return { navigationByMandala: next };
        }),
      getNavigation: (mandalaId) => {
        if (!mandalaId) return DEFAULT_NAVIGATION;
        return get().navigationByMandala[mandalaId] ?? DEFAULT_NAVIGATION;
      },
      setJustCreated: (id) => set({ justCreatedMandalaId: id }),
      setPendingMandala: (p) => set({ pendingMandala: p }),
      clearPendingMandala: () => set({ pendingMandala: null }),
      setLastOptimisticTitle: (v) => set({ lastOptimisticTitle: v }),
      reset: () => set({ ...INITIAL_STATE }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        selectedMandalaId: state.selectedMandalaId,
        navigationByMandala: state.navigationByMandala,
      }),
    }
  )
);

let currentUserId: string | null = null;
subscribeAuth((event, session) => {
  const newUserId = session?.user?.id ?? null;
  if (event === 'SIGNED_OUT' || currentUserId !== newUserId) {
    useMandalaStore.getState().reset();
    useMandalaStore.persist.clearStorage();
  }
  currentUserId = newUserId;
});
