import { create } from 'zustand';

export type CenterTab = 'summary' | 'section';

export interface ActiveSectionRef {
  chapterIdx: number;
  sectionIdx: number;
}

interface LearningState {
  currentVideoId: string | null;
  activeTab: 'ai-summary' | 'notes';
  selectedCellIndex: number | null;
  centerTab: CenterTab;
  activeSectionRef: ActiveSectionRef | null;

  setCurrentVideo: (videoId: string) => void;
  setActiveTab: (tab: 'ai-summary' | 'notes') => void;
  setSelectedCell: (cellIndex: number | null) => void;
  setCenterTab: (tab: CenterTab) => void;
  setActiveSection: (ref: ActiveSectionRef | null) => void;
}

export const useLearningStore = create<LearningState>((set) => ({
  currentVideoId: null,
  activeTab: 'ai-summary',
  selectedCellIndex: null,
  centerTab: 'summary',
  activeSectionRef: null,

  setCurrentVideo: (videoId) => set({ currentVideoId: videoId }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedCell: (cellIndex) => set({ selectedCellIndex: cellIndex }),
  setCenterTab: (tab) => set({ centerTab: tab }),
  setActiveSection: (ref) => set({ activeSectionRef: ref }),
}));
