import { useEffect, useState } from 'react';

import { fetchMorningCardsStatus } from '@/features/morning-cards/api';
import { MorningCardsPage } from '@/features/morning-cards/MorningCardsPage';

type FlagState = 'loading' | 'on' | 'off';

/**
 * Renders the morning cards page only when the server flag is on.
 * Flag off or status error renders nothing, so the screen stays hidden.
 */
export function MorningCardsRoute() {
  const [state, setState] = useState<FlagState>('loading');

  useEffect(() => {
    let cancelled = false;
    fetchMorningCardsStatus()
      .then((s) => {
        if (!cancelled) setState(s.enabled ? 'on' : 'off');
      })
      .catch(() => {
        if (!cancelled) setState('off');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state !== 'on') return null;
  return <MorningCardsPage />;
}
