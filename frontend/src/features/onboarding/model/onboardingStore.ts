/**
 * Onboarding store — checklist-driven (James redesign 2026-07-02).
 *
 * Core = 5 first-run TASKS the user must each perform once; a header chip
 * ("시작 가이드 N/5") stays visible until ALL are done, then disappears.
 * Task completion is detected from real actions (wizard finish, learning
 * visit, summary render, note view, add-cards open) — never manual.
 *
 * Coachmark bubbles are the SECONDARY layer: fired when a checklist item
 * is clicked, plus one auto dashboard tour right after the user's first
 * mandala is created (0→1 transition). Spec: docs/design/onboarding-guide-2026-07-02.md.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type OnboardingMoment = 'welcome' | 'dashboard';
export type OnboardingTask = 'wizard' | 'watch' | 'summary' | 'note' | 'addcards';

export const ALL_TASKS: OnboardingTask[] = ['wizard', 'watch', 'summary', 'note', 'addcards'];

interface OnboardingState {
  completed: OnboardingMoment[];
  tasks: OnboardingTask[];
  /** True once grandfathering has been evaluated (prevents re-runs). */
  grandfathered: boolean;
  complete: (moment: OnboardingMoment) => void;
  markTask: (task: OnboardingTask) => void;
  /** Pre-existing mandala owners: everything done — no chip, no auto tour. */
  applyGrandfathering: (ownsMandala: boolean) => void;
  /** /help "가이드 다시 보기" — re-arm checklist + auto tour. */
  resetTours: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      completed: [],
      tasks: [],
      grandfathered: false,
      complete: (moment) => {
        if (get().completed.includes(moment)) return;
        set({ completed: [...get().completed, moment] });
      },
      markTask: (task) => {
        if (get().tasks.includes(task)) return;
        set({ tasks: [...get().tasks, task] });
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
          tasks: ownsMandala ? [...ALL_TASKS] : get().tasks,
        });
      },
      resetTours: () =>
        set({
          completed: get().completed.filter((m) => m === 'welcome'),
          tasks: [],
        }),
    }),
    { name: 'insighta-onboarding-v1' }
  )
);

/** Convenience for non-React wiring points (event handlers, controllers). */
export function markOnboardingTask(task: OnboardingTask): void {
  useOnboardingStore.getState().markTask(task);
}

export function allTasksDone(tasks: OnboardingTask[]): boolean {
  return ALL_TASKS.every((t) => tasks.includes(t));
}
