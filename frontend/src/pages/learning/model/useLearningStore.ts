import { create } from 'zustand';

interface LearningState {
  currentVideoId: string | null;
  activeTab: 'ai-summary' | 'notes';
  selectedCellIndex: number | null;

  setCurrentVideo: (videoId: string) => void;
  setActiveTab: (tab: 'ai-summary' | 'notes') => void;
  setSelectedCell: (cellIndex: number | null) => void;
}

export const useLearningStore = create<LearningState>((set) => ({
  currentVideoId: null,
  activeTab: 'ai-summary',
  selectedCellIndex: null,

  setCurrentVideo: (videoId) => set({ currentVideoId: videoId }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedCell: (cellIndex) => set({ selectedCellIndex: cellIndex }),
}));
