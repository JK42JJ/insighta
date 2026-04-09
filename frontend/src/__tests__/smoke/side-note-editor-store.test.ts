/**
 * useSideEditorStore — open/close behavior.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSideEditorStore } from '@/features/side-note-editor/model/useSideEditorStore';

beforeEach(() => {
  useSideEditorStore.setState({ isOpen: false, context: null });
});

describe('useSideEditorStore', () => {
  it('starts closed', () => {
    expect(useSideEditorStore.getState().isOpen).toBe(false);
    expect(useSideEditorStore.getState().context).toBeNull();
  });

  it('open() sets isOpen + context', () => {
    useSideEditorStore.getState().open({
      videoId: 'v-1',
      mandalaId: 'm-1',
          });
    const state = useSideEditorStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.context).toEqual({ videoId: 'v-1', mandalaId: 'm-1' });
  });

  it('close() resets isOpen but keeps context for exit animation', () => {
    useSideEditorStore.getState().open({ videoId: 'v-1', mandalaId: 'm-1', });
    useSideEditorStore.getState().close();
    const state = useSideEditorStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.context).not.toBeNull();
  });
});
