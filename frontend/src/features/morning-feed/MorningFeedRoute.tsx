import { Suspense, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { fetchMorningCardsStatus } from '@/features/morning-cards/api';
import { keepTrying, lazyScreen } from '@/features/morning-feed/first-load';
import { isDeckView } from '@/features/morning-feed/morning-view';
import { MorningFeedLive } from '@/features/morning-feed/MorningFeedLive';
import { prefetchWatchStart } from '@/features/morning-feed/watch-prefetch';
import { WatchBoot } from '@/features/morning-feed/WatchBoot';

const MorningWatchLive = lazyScreen(() =>
  import('@/features/morning-feed/MorningWatchLive').then((m) => ({
    default: m.MorningWatchLive,
  }))
);

/**
 * Shows the live feed only when the server flag is on (same switch as the morning cards).
 * The watch screen, behind the same flag; the swipe deck only at `?view=deck`.
 */
export function MorningFeedRoute() {
  const { search } = useLocation();
  const watchView = !isDeckView(search);
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    // the watch screen's first reads go out together with the flag check, not after it
    if (watchView) prefetchWatchStart();
    // only an answer decides: a request that fails is tried again, it is not "off"
    void keepTrying(fetchMorningCardsStatus, () => alive).then((s) => {
      if (alive) setOn(s.enabled);
    });
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
