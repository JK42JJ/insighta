import { describe, it, expect, beforeEach } from 'vitest';
import { useMandalaStore } from '@/stores/mandalaStore';

describe('mandalaStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useMandalaStore.setState({
      selectedMandalaId: null,
      currentLevelId: 'root',
      selectedCellIndex: null,
    });
  });

  it('has correct initial state', () => {
    const state = useMandalaStore.getState();
    expect(state.selectedMandalaId).toBeNull();
    expect(state.currentLevelId).toBe('root');
    expect(state.selectedCellIndex).toBeNull();
  });

  it('selectMandala updates selectedMandalaId', () => {
    const testId = 'mandala-abc-123';
    useMandalaStore.getState().selectMandala(testId);
    expect(useMandalaStore.getState().selectedMandalaId).toBe(testId);
  });

  it('selectMandala accepts null', () => {
    useMandalaStore.getState().selectMandala('some-id');
    useMandalaStore.getState().selectMandala(null);
    expect(useMandalaStore.getState().selectedMandalaId).toBeNull();
  });

  it('setCurrentLevel updates currentLevelId', () => {
    useMandalaStore.getState().setCurrentLevel('level-2');
    expect(useMandalaStore.getState().currentLevelId).toBe('level-2');
  });

  it('setSelectedCell updates selectedCellIndex', () => {
    useMandalaStore.getState().setSelectedCell(5);
    expect(useMandalaStore.getState().selectedCellIndex).toBe(5);
  });

  it('setSelectedCell accepts null to deselect', () => {
    useMandalaStore.getState().setSelectedCell(3);
    useMandalaStore.getState().setSelectedCell(null);
    expect(useMandalaStore.getState().selectedCellIndex).toBeNull();
  });

  it('actions are independent — updating one does not affect others', () => {
    useMandalaStore.getState().selectMandala('m1');
    useMandalaStore.getState().setCurrentLevel('lvl-3');
    useMandalaStore.getState().setSelectedCell(7);

    const state = useMandalaStore.getState();
    expect(state.selectedMandalaId).toBe('m1');
    expect(state.currentLevelId).toBe('lvl-3');
    expect(state.selectedCellIndex).toBe(7);
  });
});
