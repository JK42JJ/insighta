import { create } from 'zustand';

export type CenterTab = 'summary' | 'section';

export type CenterViewMode = 'player' | 'note';

export type ActiveRegion = 'sidebar' | 'player' | 'book-index' | 'notes' | 'chat' | null;

export type PlayerState = 'playing' | 'paused' | 'buffering' | 'ended' | 'unstarted' | 'cued';

export interface ActiveSectionRef {
  chapterIdx: number;
  sectionIdx: number;
}

interface LearningState {
  currentVideoId: string | null;
  activeTab: 'ai-summary' | 'notes';
  selectedCellIndex: number | null;
  centerTab: CenterTab;
  centerViewMode: CenterViewMode;
  activeSectionRef: ActiveSectionRef | null;

  activeRegion: ActiveRegion;
  lastInteractionTs: number;
  playerTimeSec: number;
  playerState: PlayerState;
  playerDurationSec: number;
  noteDraftExcerpt: string;
  noteSelectionText: string | null;
  /** CP445.x — note-mode inline iframe: ProseMirror pos of the currently
   *  expanded VideoBlock (null = none expanded). Single-active enforced. */
  activeNoteVideoKey: number | null;

  setCurrentVideo: (videoId: string) => void;
  setActiveTab: (tab: 'ai-summary' | 'notes') => void;
  setSelectedCell: (cellIndex: number | null) => void;
  setCenterTab: (tab: CenterTab) => void;
  setCenterViewMode: (mode: CenterViewMode) => void;
  setActiveSection: (ref: ActiveSectionRef | null) => void;
  setActiveNoteVideoKey: (key: number | null) => void;

  setActiveRegion: (region: ActiveRegion) => void;
  setPlayerState: (time: number, state: PlayerState, duration: number) => void;
  setNoteContext: (draftExcerpt: string, selectionText: string | null) => void;
}

export const useLearningStore = create<LearningState>((set) => ({
  currentVideoId: null,
  activeTab: 'ai-summary',
  selectedCellIndex: null,
  centerTab: 'summary',
  centerViewMode: 'player',
  activeSectionRef: null,

  activeRegion: null,
  lastInteractionTs: 0,
  playerTimeSec: 0,
  playerState: 'unstarted',
  playerDurationSec: 0,
  noteDraftExcerpt: '',
  noteSelectionText: null,
  activeNoteVideoKey: null,

  setCurrentVideo: (videoId) => set({ currentVideoId: videoId }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedCell: (cellIndex) => set({ selectedCellIndex: cellIndex }),
  setCenterTab: (tab) => set({ centerTab: tab }),
  setCenterViewMode: (mode) => set({ centerViewMode: mode }),
  setActiveSection: (ref) => set({ activeSectionRef: ref }),
  setActiveNoteVideoKey: (key) => set({ activeNoteVideoKey: key }),

  setActiveRegion: (region) => set({ activeRegion: region, lastInteractionTs: Date.now() }),
  setPlayerState: (time, state, duration) =>
    set({ playerTimeSec: time, playerState: state, playerDurationSec: duration }),
  setNoteContext: (draftExcerpt, selectionText) =>
    set({ noteDraftExcerpt: draftExcerpt, noteSelectionText: selectionText }),
}));
