/**
 * OnboardingController — orchestrates first-run guidance.
 *
 * Mounted once in AppShell (logged-in branch). Responsibilities:
 *  - grandfathering evaluation (existing mandala owners → all done)
 *  - welcome modal (zero mandalas)
 *  - ONE auto dashboard tour right after the first mandala lands (0→1)
 *  - task auto-detection that needs list data (wizard = 0→1 transition)
 *  - rendering ad-hoc single-step coachmarks requested by the checklist
 * Spec: docs/design/onboarding-guide-2026-07-02.md (checklist redesign).
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMandalaList } from '@/features/mandala';
import { useOnboardingStore } from '../model/onboardingStore';
import { subscribeCoachmark } from '../model/coach-controller';
import { DASHBOARD_STEPS, type CoachStep } from '../steps';
import { CoachmarkTour } from './CoachmarkTour';
import { WelcomeModal } from './WelcomeModal';

/** Delay before the auto tour — lets the fresh dashboard finish painting. */
const TOUR_START_DELAY_MS = 900;

export function OnboardingController() {
  const location = useLocation();
  const { data: mandalaListData, isSuccess } = useMandalaList();
  const completed = useOnboardingStore((s) => s.completed);
  const grandfathered = useOnboardingStore((s) => s.grandfathered);
  const complete = useOnboardingStore((s) => s.complete);
  const markTask = useOnboardingStore((s) => s.markTask);
  const applyGrandfathering = useOnboardingStore((s) => s.applyGrandfathering);

  const mandalaCount = mandalaListData?.mandalas?.length ?? null;

  // One-time grandfathering once the list is known.
  useEffect(() => {
    if (!grandfathered && isSuccess && mandalaCount !== null) {
      applyGrandfathering(mandalaCount > 0);
    }
  }, [grandfathered, isSuccess, mandalaCount, applyGrandfathering]);

  // Wizard task = the user's mandala count crossed 0 → 1 while onboarding
  // is armed (grandfathered existing users already have every task done).
  const prevCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (mandalaCount === null) return;
    const prev = prevCountRef.current;
    prevCountRef.current = mandalaCount;
    if (grandfathered && prev === 0 && mandalaCount > 0) markTask('wizard');
  }, [mandalaCount, grandfathered, markTask]);

  // Ad-hoc single-step bubble requested by the checklist popover.
  const [adhocStep, setAdhocStep] = useState<CoachStep | null>(null);
  useEffect(() => subscribeCoachmark((step) => setAdhocStep(step)), []);

  // Auto moments (welcome / one dashboard tour after first mandala).
  const onDashboard = location.pathname === '/';
  let moment: 'welcome' | 'dashboard' | null = null;
  if (grandfathered && isSuccess && !adhocStep) {
    if (onDashboard && mandalaCount === 0 && !completed.includes('welcome')) moment = 'welcome';
    else if (onDashboard && (mandalaCount ?? 0) > 0 && !completed.includes('dashboard'))
      moment = 'dashboard';
  }

  // Debounced arming — screen must hold the same moment for the delay window.
  const [armed, setArmed] = useState<typeof moment>(null);
  useEffect(() => {
    if (!moment) {
      setArmed(null);
      return;
    }
    const id = setTimeout(() => setArmed(moment), TOUR_START_DELAY_MS);
    return () => clearTimeout(id);
  }, [moment]);

  if (adhocStep) return <CoachmarkTour steps={[adhocStep]} onDone={() => setAdhocStep(null)} />;
  if (!moment || armed !== moment) return null;
  if (moment === 'welcome') return <WelcomeModal onClose={() => complete('welcome')} />;
  return <CoachmarkTour steps={DASHBOARD_STEPS} onDone={() => complete('dashboard')} />;
}
