import { useEffect, useState } from 'react';

import { fetchMorningCardsStatus } from '@/features/morning-cards/api';
import { MorningCardsReviewPage } from '@/features/morning-cards/MorningCardsReviewPage';

/** Renders the PC review list only when the server flag is on. */
export function MorningCardsReviewRoute() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMorningCardsStatus()
      .then((s) => {
        if (!cancelled) setEnabled(s.enabled);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return enabled ? <MorningCardsReviewPage /> : null;
}
