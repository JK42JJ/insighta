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
  selectMandala: (id: string | null) => void;
  setCurrentLevel: (id: string) => void;
  setSelectedCell: (index: number | null) => void;
}

export const useMandalaStore = create<MandalaUIStore>((set) => ({
  selectedMandalaId: null,
  currentLevelId: ROOT_LEVEL_ID,
  selectedCellIndex: null,
  selectMandala: (id) => set({ selectedMandalaId: id }),
  setCurrentLevel: (id) => set({ currentLevelId: id }),
  setSelectedCell: (index) => set({ selectedCellIndex: index }),
}));
