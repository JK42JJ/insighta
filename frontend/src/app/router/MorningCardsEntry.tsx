import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';

import { ProtectedRoute } from './ProtectedRoute';

const MorningFeedRoute = lazy(() =>
  import('@/features/morning-feed/MorningFeedRoute').then((m) => ({ default: m.MorningFeedRoute }))
);
const MorningFeedFixture = lazy(() =>
  import('@/features/morning-feed/MorningFeedFixture').then((m) => ({
    default: m.MorningFeedFixture,
  }))
);

/**
 * /morning-cards entry. `?fixture=1` shows the design test-hook screen (fixed cards,
 * no sign-in needed); otherwise the signed-in, flag-gated live feed (오늘의 픽). The earlier
 * judging screen stays at /morning-cards/classic.
 */
export function MorningCardsEntry() {
  const { search } = useLocation();
  if (new URLSearchParams(search).get('fixture') === '1') {
    return (
      <Suspense fallback={null}>
        <MorningFeedFixture />
      </Suspense>
    );
  }
  return (
    <ProtectedRoute>
      <Suspense fallback={null}>
        <MorningFeedRoute />
      </Suspense>
    </ProtectedRoute>
  );
}
