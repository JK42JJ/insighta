import { useEffect, useState } from 'react';

import { fetchTestClock, type TestClockDto } from '@/features/morning-cards/api';

/**
 * The virtual-today controls of this account: undefined while asking, null for an account without
 * them (the server refuses: 404 without the list, 403 for an account that is not a test user).
 */
export function useTestClock(): TestClockDto | null | undefined {
  const [clock, setClock] = useState<TestClockDto | null | undefined>(undefined);
  useEffect(() => {
    let on = true;
    fetchTestClock()
      .then((c) => on && setClock(c))
      .catch(() => on && setClock(null));
    return () => {
      on = false;
    };
  }, []);
  return clock;
}
