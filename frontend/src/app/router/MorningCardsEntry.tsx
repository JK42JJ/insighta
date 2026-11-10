import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';

import { parseFixtureScreen } from '@/features/morning-feed/fixture-screen';

import { ProtectedRoute } from './ProtectedRoute';

const MorningFeedRoute = lazy(() =>
  import('@/features/morning-feed/MorningFeedRoute').then((m) => ({ default: m.MorningFeedRoute }))
);
const MorningWatchFixture = lazy(() =>
  import('@/features/morning-feed/MorningWatchFixture').then((m) => ({
    default: m.MorningWatchFixture,
  }))
);
const MorningFeedFixture = lazy(() =>
  import('@/features/morning-feed/MorningFeedFixture').then((m) => ({
    default: m.MorningFeedFixture,
  }))
);

/**
 * /morning-cards entry. `?fixture=1` shows the design test-hook screen (fixed cards,
 * no sign-in needed); with `&view=watch` the watch flow's test-hook screen (the mobile design
 * handoff's example data, `&screen=onb|input|watch|insight`). Otherwise the signed-in,
 * flag-gated live feed (오늘의 픽). The earlier judging screen stays at /morning-cards/classic.
 */
export function MorningCardsEntry() {
  const { search } = useLocation();
  const q = new URLSearchParams(search);
  if (q.get('fixture') === '1' && q.get('view') === 'watch') {
    return (
      <Suspense fallback={null}>
        <MorningWatchFixture screen={parseFixtureScreen(q.get('screen'))} />
      </Suspense>
    );
  }
  if (q.get('fixture') === '1') {
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
