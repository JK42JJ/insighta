/**
 * OnboardingController — decides which onboarding moment (if any) to show.
 *
 * Mounted once in AppShell (logged-in branch). Route + mandala-ownership
 * driven; each moment fires at most once (localStorage-persisted store).
 * Spec: docs/design/onboarding-guide-2026-07-02.md.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMandalaList } from '@/features/mandala';
import { useOnboardingStore } from '../model/onboardingStore';
import { DASHBOARD_STEPS, LEARNING_STEPS } from '../steps';
import { CoachmarkTour } from './CoachmarkTour';
import { WelcomeModal } from './WelcomeModal';

/** Delay before starting a tour — lets the target screen finish painting
 *  (skeleton → cards) so anchors exist and rects are stable. */
const TOUR_START_DELAY_MS = 900;

export function OnboardingController() {
  const location = useLocation();
  const { data: mandalaListData, isSuccess } = useMandalaList();
  const completed = useOnboardingStore((s) => s.completed);
  const grandfathered = useOnboardingStore((s) => s.grandfathered);
  const complete = useOnboardingStore((s) => s.complete);
  const applyGrandfathering = useOnboardingStore((s) => s.applyGrandfathering);

  const mandalaCount = mandalaListData?.mandalas?.length ?? null;

  // One-time grandfathering once the list is known.
  useEffect(() => {
    if (!grandfathered && isSuccess && mandalaCount !== null) {
      applyGrandfathering(mandalaCount > 0);
    }
  }, [grandfathered, isSuccess, mandalaCount, applyGrandfathering]);

  // Which moment applies to the current screen?
  const onDashboard = location.pathname === '/';
  const onLearning = location.pathname.startsWith('/learning/');

  let moment: 'welcome' | 'dashboard' | 'learning' | null = null;
  if (grandfathered && isSuccess) {
    if (onDashboard && mandalaCount === 0 && !completed.includes('welcome')) moment = 'welcome';
    else if (onDashboard && (mandalaCount ?? 0) > 0 && !completed.includes('dashboard'))
      moment = 'dashboard';
    else if (onLearning && !completed.includes('learning')) moment = 'learning';
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

  if (!moment || armed !== moment) return null;

  if (moment === 'welcome') return <WelcomeModal onClose={() => complete('welcome')} />;
  if (moment === 'dashboard')
    return <CoachmarkTour steps={DASHBOARD_STEPS} onDone={() => complete('dashboard')} />;
  return <CoachmarkTour steps={LEARNING_STEPS} onDone={() => complete('learning')} />;
}
