import { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { fetchMorningCardsStatus } from '@/features/morning-cards/api';
import { MorningFeedLive } from '@/features/morning-feed/MorningFeedLive';

const MorningWatchLive = lazy(() =>
  import('@/features/morning-feed/MorningWatchLive').then((m) => ({
    default: m.MorningWatchLive,
  }))
);

/**
 * Shows the live feed only when the server flag is on (same switch as the morning cards).
 * `?view=watch` shows the watch screen instead of the deck, behind the same flag.
 */
export function MorningFeedRoute() {
  const { search } = useLocation();
  const watchView = new URLSearchParams(search).get('view') === 'watch';
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetchMorningCardsStatus()
      .then((s) => alive && setOn(s.enabled))
      .catch(() => alive && setOn(false));
    return () => {
      alive = false;
    };
  }, []);
  if (!on) return null;
  return watchView ? (
    <Suspense fallback={null}>
      <MorningWatchLive />
    </Suspense>
  ) : (
    <MorningFeedLive />
  );
}
