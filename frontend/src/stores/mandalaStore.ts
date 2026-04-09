import { create } from 'zustand';

const ROOT_LEVEL_ID = 'root';

/**
 * UI-only mandala selection state.
 * Server data (mandalaLevels, list, etc.) stays in TanStack Query.
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
}

export const useMandalaStore = create<MandalaUIStore>((set) => ({
  selectedMandalaId: null,
  currentLevelId: ROOT_LEVEL_ID,
  selectedCellIndex: null,
  justCreatedMandalaId: null,
  selectMandala: (id) => set({ selectedMandalaId: id }),
  setCurrentLevel: (id) => set({ currentLevelId: id }),
  setSelectedCell: (index) => set({ selectedCellIndex: index }),
  setJustCreated: (id) => set({ justCreatedMandalaId: id }),
}));
