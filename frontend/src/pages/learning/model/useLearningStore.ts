import { create } from 'zustand';

const LS_KEY_VIDEO_STRIP_ENABLED = 'insighta.learning.videoStripEnabled';

function readVideoStripEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const v = window.localStorage.getItem(LS_KEY_VIDEO_STRIP_ENABLED);
    return v === null ? true : v === 'true';
  } catch {
    return true;
  }
}

function writeVideoStripEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY_VIDEO_STRIP_ENABLED, enabled ? 'true' : 'false');
  } catch {
    /* localStorage disabled — silently degrade to in-memory only */
  }
}

export type CenterTab = 'chapters' | 'summary' | 'section';

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
  /** CP446.x — auto-follow mode. true = scroll-driven activeKey switching
   *  (visibility-based). false = explicit click required. Toggled true on
   *  first VideoBlock click, false on note-mode exit / edit-mode enter /
   *  mandala change. Spec: "명시적 재생 액티비티 only". */
  noteAutoFollowEnabled: boolean;
  /** Hover-slide video thumbnail strip on player wrapper. User can dismiss
   *  via X on the strip; restore via icon in left sidebar header. Persisted
   *  to localStorage so the choice survives reloads. */
  videoStripEnabled: boolean;

  setCurrentVideo: (videoId: string) => void;
  setActiveTab: (tab: 'ai-summary' | 'notes') => void;
  setSelectedCell: (cellIndex: number | null) => void;
  setCenterTab: (tab: CenterTab) => void;
  setCenterViewMode: (mode: CenterViewMode) => void;
  setActiveSection: (ref: ActiveSectionRef | null) => void;
  setActiveNoteVideoKey: (key: number | null) => void;
  setNoteAutoFollow: (enabled: boolean) => void;
  setVideoStripEnabled: (enabled: boolean) => void;

  setActiveRegion: (region: ActiveRegion) => void;
  setPlayerState: (time: number, state: PlayerState, duration: number) => void;
  setNoteContext: (draftExcerpt: string, selectionText: string | null) => void;
}

export const useLearningStore = create<LearningState>((set) => ({
  currentVideoId: null,
  activeTab: 'ai-summary',
  selectedCellIndex: null,
  centerTab: 'chapters',
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
  noteAutoFollowEnabled: false,
  videoStripEnabled: readVideoStripEnabled(),

  setCurrentVideo: (videoId) => set({ currentVideoId: videoId }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedCell: (cellIndex) => set({ selectedCellIndex: cellIndex }),
  setCenterTab: (tab) => set({ centerTab: tab }),
  setCenterViewMode: (mode) => set({ centerViewMode: mode }),
  setActiveSection: (ref) => set({ activeSectionRef: ref }),
  setActiveNoteVideoKey: (key) => set({ activeNoteVideoKey: key }),
  setNoteAutoFollow: (enabled) => set({ noteAutoFollowEnabled: enabled }),
  setVideoStripEnabled: (enabled) => {
    writeVideoStripEnabled(enabled);
    set({ videoStripEnabled: enabled });
  },

  setActiveRegion: (region) => set({ activeRegion: region, lastInteractionTs: Date.now() }),
  setPlayerState: (time, state, duration) =>
    set({ playerTimeSec: time, playerState: state, playerDurationSec: duration }),
  setNoteContext: (draftExcerpt, selectionText) =>
    set({ noteDraftExcerpt: draftExcerpt, noteSelectionText: selectionText }),
}));
