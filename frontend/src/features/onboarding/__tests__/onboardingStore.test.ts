/** Onboarding store — task checklist / grandfathering / reset rules. */
import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_TASKS, allTasksDone, useOnboardingStore } from '../model/onboardingStore';

describe('onboardingStore', () => {
  beforeEach(() => {
    useOnboardingStore.setState({ completed: [], tasks: [], grandfathered: false });
  });

  it('marks a task once (idempotent)', () => {
    const { markTask } = useOnboardingStore.getState();
    markTask('wizard');
    markTask('wizard');
    expect(useOnboardingStore.getState().tasks).toEqual(['wizard']);
  });

  it('allTasksDone flips only when every task is performed', () => {
    const { markTask } = useOnboardingStore.getState();
    ALL_TASKS.slice(0, -1).forEach(markTask);
    expect(allTasksDone(useOnboardingStore.getState().tasks)).toBe(false);
    markTask(ALL_TASKS[ALL_TASKS.length - 1]);
    expect(allTasksDone(useOnboardingStore.getState().tasks)).toBe(true);
  });

  it('grandfathers existing mandala owners: moments + ALL tasks done', () => {
    useOnboardingStore.getState().applyGrandfathering(true);
    const s = useOnboardingStore.getState();
    expect(s.grandfathered).toBe(true);
    expect(s.completed).toContain('welcome');
    expect(s.completed).toContain('dashboard');
    expect(allTasksDone(s.tasks)).toBe(true);
  });

  it('does NOT grandfather brand-new users (zero mandalas)', () => {
    useOnboardingStore.getState().applyGrandfathering(false);
    const s = useOnboardingStore.getState();
    expect(s.grandfathered).toBe(true);
    expect(s.completed).toEqual([]);
    expect(s.tasks).toEqual([]);
  });

  it('grandfathering runs only once', () => {
    useOnboardingStore.getState().applyGrandfathering(false);
    useOnboardingStore.getState().applyGrandfathering(true);
    expect(useOnboardingStore.getState().tasks).toEqual([]);
  });

  it('resetTours re-arms tasks + dashboard tour but keeps welcome', () => {
    const st = useOnboardingStore.getState();
    st.complete('welcome');
    st.complete('dashboard');
    ALL_TASKS.forEach(st.markTask);
    useOnboardingStore.getState().resetTours();
    const s = useOnboardingStore.getState();
    expect(s.completed).toEqual(['welcome']);
    expect(s.tasks).toEqual([]);
  });
});
