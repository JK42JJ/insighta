import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';

import { parseFixtureScreen } from '@/features/morning-feed/fixture-screen';
import { WatchBoot } from '@/features/morning-feed/WatchBoot';

import { ProtectedRoute } from './ProtectedRoute';

const MorningFeedRoute = lazy(() =>
  import('@/features/morning-feed/MorningFeedRoute').then((m) => ({ default: m.MorningFeedRoute }))
);
const MorningWatchFixture = lazy(() =>
  import('@/features/morning-feed/MorningWatchFixture').then((m) => ({
    default: m.MorningWatchFixture,
  }))
);
const MorningWatchR3Fixture = lazy(() =>
  import('@/features/morning-feed/MorningWatchR3Fixture').then((m) => ({
    default: m.MorningWatchR3Fixture,
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
 * handoff's example data, `&screen=onb|input|watch|insight`; with `&preset=` the 수정 3 handoff's
 * presets, `&safe=47,34` and `&thumbs=` optional). Otherwise the signed-in,
 * flag-gated live feed (오늘의 픽). The earlier judging screen stays at /morning-cards/classic.
 */
export function MorningCardsEntry() {
  const { search } = useLocation();
  const q = new URLSearchParams(search);
  if (q.get('fixture') === '1' && q.get('view') === 'watch' && q.get('preset') !== null) {
    // 수정 3 design: the handoff's presets on the real screens (side-by-side captures)
    return (
      <Suspense fallback={null}>
        <MorningWatchR3Fixture
          preset={q.get('preset')}
          safe={q.get('safe')}
          thumbs={q.get('thumbs')}
          real={q.get('real') === '1'}
        />
      </Suspense>
    );
  }
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
  // the watch screen shows its first-open screen instead of a blank page while it starts
  const boot = q.get('view') === 'watch' ? <WatchBoot /> : null;
  return (
    <ProtectedRoute fallback={boot}>
      <Suspense fallback={boot}>
        <MorningFeedRoute />
      </Suspense>
    </ProtectedRoute>
  );
}
