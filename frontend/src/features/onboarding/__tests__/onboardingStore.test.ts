/** Onboarding store — moment completion / grandfathering / reset rules. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useOnboardingStore } from '../model/onboardingStore';

describe('onboardingStore', () => {
  beforeEach(() => {
    useOnboardingStore.setState({ completed: [], grandfathered: false });
  });

  it('completes a moment once (idempotent)', () => {
    const { complete } = useOnboardingStore.getState();
    complete('dashboard');
    complete('dashboard');
    expect(useOnboardingStore.getState().completed).toEqual(['dashboard']);
  });

  it('grandfathers welcome+dashboard for users who already own mandalas', () => {
    useOnboardingStore.getState().applyGrandfathering(true);
    const s = useOnboardingStore.getState();
    expect(s.grandfathered).toBe(true);
    expect(s.completed).toContain('welcome');
    expect(s.completed).toContain('dashboard');
    expect(s.completed).not.toContain('learning');
  });

  it('does NOT grandfather brand-new users (zero mandalas)', () => {
    useOnboardingStore.getState().applyGrandfathering(false);
    const s = useOnboardingStore.getState();
    expect(s.grandfathered).toBe(true);
    expect(s.completed).toEqual([]);
  });

  it('grandfathering runs only once', () => {
    useOnboardingStore.getState().applyGrandfathering(false);
    useOnboardingStore.getState().applyGrandfathering(true);
    expect(useOnboardingStore.getState().completed).toEqual([]);
  });

  it('resetTours re-arms dashboard+learning but keeps welcome', () => {
    const { complete } = useOnboardingStore.getState();
    complete('welcome');
    complete('dashboard');
    complete('learning');
    useOnboardingStore.getState().resetTours();
    expect(useOnboardingStore.getState().completed).toEqual(['welcome']);
  });
});
