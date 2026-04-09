/**
 * useVideoPanelStore — dual-mode state transitions.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useVideoPanelStore } from '@/features/video-side-panel/model/useVideoPanelStore';
import type { InsightCard } from '@/entities/card/model/types';

const fakeCard: InsightCard = {
  id: 'card-1',
  videoUrl: 'https://youtube.com/watch?v=abc',
  title: 'Test Video',
  thumbnail: '',
  userNote: 'hello',
  createdAt: new Date(),
  cellIndex: 0,
  levelId: 'root',
};

beforeEach(() => {
  useVideoPanelStore.setState({
    mode: 'popup',
    isOpen: false,
    card: null,
    activeTab: 'notes',
  });
});

describe('useVideoPanelStore', () => {
  it('starts in popup mode, closed', () => {
    const s = useVideoPanelStore.getState();
    expect(s.mode).toBe('popup');
    expect(s.isOpen).toBe(false);
    expect(s.card).toBeNull();
  });

  it('expandToSidebar: switches to sidebar mode + opens + sets card', () => {
    useVideoPanelStore.getState().expandToSidebar(fakeCard);
    const s = useVideoPanelStore.getState();
    expect(s.mode).toBe('sidebar');
    expect(s.isOpen).toBe(true);
    expect(s.card?.id).toBe('card-1');
    expect(s.activeTab).toBe('notes');
  });

  it('openInSidebar: swaps card without changing mode/isOpen', () => {
    useVideoPanelStore.getState().expandToSidebar(fakeCard);
    const card2 = { ...fakeCard, id: 'card-2', title: 'Second' };
    useVideoPanelStore.getState().openInSidebar(card2);
    const s = useVideoPanelStore.getState();
    expect(s.mode).toBe('sidebar');
    expect(s.isOpen).toBe(true);
    expect(s.card?.id).toBe('card-2');
  });

  it('closeSidebar: reverts to popup mode', () => {
    useVideoPanelStore.getState().expandToSidebar(fakeCard);
    useVideoPanelStore.getState().closeSidebar();
    const s = useVideoPanelStore.getState();
    expect(s.mode).toBe('popup');
    expect(s.isOpen).toBe(false);
  });

  it('setTab: switches active tab', () => {
    useVideoPanelStore.getState().expandToSidebar(fakeCard);
    useVideoPanelStore.getState().setTab('ai-summary');
    expect(useVideoPanelStore.getState().activeTab).toBe('ai-summary');
  });
});
