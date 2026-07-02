/**
 * Onboarding progress store (moment-level, localStorage persisted).
 *
 * Spec: docs/design/onboarding-guide-2026-07-02.md — three moments:
 *   'welcome'   — first login with zero mandalas (modal)
 *   'dashboard' — first dashboard render after owning a mandala (4-step tour)
 *   'learning'  — first learning-page visit (2-step tour)
 *
 * Grandfathering: users who already own mandalas when the feature first
 * loads get 'welcome' + 'dashboard' auto-completed — the tour is for the
 * concepts a NEW user meets, not a retro-announcement. 'learning' still
 * shows once (its panel features are newer). Re-run via /help reset.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type OnboardingMoment = 'welcome' | 'dashboard' | 'learning';

interface OnboardingState {
  completed: OnboardingMoment[];
  /** True once grandfathering has been evaluated (prevents re-runs). */
  grandfathered: boolean;
  complete: (moment: OnboardingMoment) => void;
  /** Mark pre-existing users as done with welcome+dashboard. */
  applyGrandfathering: (ownsMandala: boolean) => void;
  /** /help "가이드 다시 보기" — re-arm the tours. */
  resetTours: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      completed: [],
      grandfathered: false,
      complete: (moment) => {
        if (get().completed.includes(moment)) return;
        set({ completed: [...get().completed, moment] });
      },
      applyGrandfathering: (ownsMandala) => {
        if (get().grandfathered) return;
        set({
          grandfathered: true,
          completed: ownsMandala
            ? Array.from(
                new Set([...get().completed, 'welcome', 'dashboard'] as OnboardingMoment[])
              )
            : get().completed,
        });
      },
      resetTours: () =>
        set({
          completed: get().completed.filter((m) => m === 'welcome'),
        }),
    }),
    { name: 'insighta-onboarding-v1' }
  )
);

export function isMomentDone(state: Pick<OnboardingState, 'completed'>, moment: OnboardingMoment) {
  return state.completed.includes(moment);
}
