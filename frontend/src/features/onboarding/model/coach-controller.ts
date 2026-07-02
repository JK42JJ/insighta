/**
 * Module-level coachmark request channel (dndHandlersRef pattern) — lets the
 * checklist popover fire a single-step bubble that OnboardingController
 * renders, without prop-drilling across widgets.
 */
import type { CoachStep } from '../steps';

type Listener = (step: CoachStep) => void;
let listener: Listener | null = null;

export function requestCoachmark(step: CoachStep): void {
  listener?.(step);
}

export function subscribeCoachmark(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}
