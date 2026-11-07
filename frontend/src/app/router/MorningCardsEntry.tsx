import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';

import { MorningCardsRoute } from '@/features/morning-cards/MorningCardsRoute';
import { ProtectedRoute } from './ProtectedRoute';

const MorningFeedFixture = lazy(() =>
  import('@/features/morning-feed/MorningFeedFixture').then((m) => ({
    default: m.MorningFeedFixture,
  }))
);

/**
 * /morning-cards entry. `?fixture=1` shows the design test-hook screen (fixed cards,
 * no sign-in needed); otherwise the signed-in, flag-gated screen.
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
      <MorningCardsRoute />
    </ProtectedRoute>
  );
}
