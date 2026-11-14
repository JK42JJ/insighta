import { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { fetchMorningCardsStatus } from '@/features/morning-cards/api';
import { MorningFeedLive } from '@/features/morning-feed/MorningFeedLive';
import { prefetchWatchStart } from '@/features/morning-feed/watch-prefetch';
import { WatchBoot } from '@/features/morning-feed/WatchBoot';

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
    // the watch screen's first reads go out together with the flag check, not after it
    if (watchView) prefetchWatchStart();
    fetchMorningCardsStatus()
      .then((s) => alive && setOn(s.enabled))
      .catch(() => alive && setOn(false));
    return () => {
      alive = false;
    };
    // the first value decides; the URL does not change while this is mounted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (on === null) return watchView ? <WatchBoot /> : null;
  if (!on) return null;
  return watchView ? (
    <Suspense fallback={<WatchBoot />}>
      <MorningWatchLive />
    </Suspense>
  ) : (
    <MorningFeedLive />
  );
}
