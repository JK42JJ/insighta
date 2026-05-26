import { describe, it, expect, beforeEach } from 'vitest';
import { useMandalaStore } from '@/stores/mandalaStore';

describe('mandalaStore', () => {
  beforeEach(() => {
    useMandalaStore.setState({
      selectedMandalaId: null,
      navigationByMandala: {},
    });
  });

  it('has correct initial state', () => {
    const state = useMandalaStore.getState();
    expect(state.selectedMandalaId).toBeNull();
    expect(state.navigationByMandala).toEqual({});
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

  it('setNavigation writes per-mandala state', () => {
    useMandalaStore.getState().setNavigation('m1', { currentLevelId: 'level-2' });
    const nav = useMandalaStore.getState().getNavigation('m1');
    expect(nav.currentLevelId).toBe('level-2');
    expect(nav.selectedCellIndex).toBeNull();
    expect(nav.path).toEqual([]);
    expect(nav.entryGridIndex).toBeNull();
  });

  it('setNavigation patches without losing prior fields', () => {
    useMandalaStore.getState().setNavigation('m1', { selectedCellIndex: 5 });
    useMandalaStore.getState().setNavigation('m1', { currentLevelId: 'level-3' });
    const nav = useMandalaStore.getState().getNavigation('m1');
    expect(nav.selectedCellIndex).toBe(5);
    expect(nav.currentLevelId).toBe('level-3');
  });

  it('setNavigation accepts null to deselect a cell', () => {
    useMandalaStore.getState().setNavigation('m1', { selectedCellIndex: 3 });
    useMandalaStore.getState().setNavigation('m1', { selectedCellIndex: null });
    expect(useMandalaStore.getState().getNavigation('m1').selectedCellIndex).toBeNull();
  });

  it('navigation state is isolated per mandala', () => {
    useMandalaStore.getState().setNavigation('m1', { selectedCellIndex: 1 });
    useMandalaStore.getState().setNavigation('m2', { selectedCellIndex: 7 });
    expect(useMandalaStore.getState().getNavigation('m1').selectedCellIndex).toBe(1);
    expect(useMandalaStore.getState().getNavigation('m2').selectedCellIndex).toBe(7);
  });

  it('clearNavigation removes the entry for a single mandala', () => {
    useMandalaStore.getState().setNavigation('m1', { selectedCellIndex: 1 });
    useMandalaStore.getState().setNavigation('m2', { selectedCellIndex: 7 });
    useMandalaStore.getState().clearNavigation('m1');
    expect(useMandalaStore.getState().navigationByMandala['m1']).toBeUndefined();
    expect(useMandalaStore.getState().getNavigation('m2').selectedCellIndex).toBe(7);
  });

  it('getNavigation returns defaults for an unknown mandala', () => {
    const nav = useMandalaStore.getState().getNavigation('unknown');
    expect(nav.currentLevelId).toBe('root');
    expect(nav.selectedCellIndex).toBeNull();
    expect(nav.path).toEqual([]);
    expect(nav.entryGridIndex).toBeNull();
  });

  it('getNavigation returns defaults for null mandalaId', () => {
    const nav = useMandalaStore.getState().getNavigation(null);
    expect(nav.currentLevelId).toBe('root');
    expect(nav.selectedCellIndex).toBeNull();
  });
});
