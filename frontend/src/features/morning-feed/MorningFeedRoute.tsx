import { useEffect, useState } from 'react';

import { fetchMorningCardsStatus } from '@/features/morning-cards/api';
import { MorningFeedLive } from '@/features/morning-feed/MorningFeedLive';

/** Shows the live feed only when the server flag is on (same switch as the morning cards). */
export function MorningFeedRoute() {
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
  return on ? <MorningFeedLive /> : null;
}
